const MINIMUM_NATIVE_GLIBC = [2, 35];

function versionParts(value) {
  const match = String(value ?? "").match(/(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

function versionLessThan(value, minimum) {
  const current = versionParts(value);
  if (!current) return false;
  for (let index = 0; index < minimum.length; index += 1) {
    if (current[index] < minimum[index]) return true;
    if (current[index] > minimum[index]) return false;
  }
  return false;
}

export function runtimeGlibcVersion(report = process.report?.getReport?.()) {
  return report?.header?.glibcVersionRuntime ?? null;
}

export function selectWebRuntime(options = {}) {
  const override = options.override?.trim().toLowerCase();
  if (override && !["auto", "native", "container"].includes(override)) {
    throw new Error(
      `Invalid COUNCIL_WEB_RUNTIME=${options.override}. Use auto, native, or container.`,
    );
  }
  if (override === "native") {
    return { kind: "native", reason: "explicitly requested" };
  }
  if (override === "container") {
    return { kind: "container", reason: "explicitly requested" };
  }

  if (
    options.platform === "linux" &&
    versionLessThan(options.glibcVersion, MINIMUM_NATIVE_GLIBC)
  ) {
    return {
      kind: "container",
      reason: `glibc ${options.glibcVersion} is older than 2.35`,
    };
  }
  return { kind: "native", reason: "native runtime is compatible" };
}

async function dockerComposeAvailable(execFile) {
  if (!execFile) return false;
  const result = await execFile("docker", ["compose", "version"], {
    timeout: 5_000,
  }).catch(() => null);
  return Boolean(result);
}

export async function resolveWebRuntime(options = {}) {
  const selected = selectWebRuntime({
    override: options.override,
    platform: options.platform ?? process.platform,
    glibcVersion: options.glibcVersion ?? runtimeGlibcVersion(),
  });
  if (selected.kind !== "container") return selected;
  if (await dockerComposeAvailable(options.execFile)) return selected;
  throw new Error(
    `${selected.reason}, so code-council needs Docker Compose for its web runtime. ` +
      "Install Docker with the Compose plugin, or set COUNCIL_WEB_RUNTIME=native only on a compatible system.",
  );
}
