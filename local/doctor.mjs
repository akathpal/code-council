const MINIMUM_NODE = [22, 13, 0];

function versionParts(value) {
  const match = String(value ?? "").match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  return match
    ? [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)]
    : [0, 0, 0];
}

function versionAtLeast(value, minimum) {
  const current = versionParts(value);
  for (let index = 0; index < minimum.length; index += 1) {
    if (current[index] > minimum[index]) return true;
    if (current[index] < minimum[index]) return false;
  }
  return true;
}

function toolCheck(tools, definition) {
  const tool = tools?.[definition.id];
  if (!tool?.available) {
    return {
      id: definition.id,
      label: definition.label,
      status: definition.required ? "fail" : "warn",
      required: definition.required,
      detail: definition.missing,
      version: null,
      fix: definition.install,
    };
  }
  if (definition.authentication && tool.authenticated === false) {
    return {
      id: `${definition.id}-auth`,
      label: `${definition.label} authentication`,
      status: definition.required ? "fail" : "warn",
      required: definition.required,
      detail: `${definition.label} is installed but is not authenticated.`,
      version: tool.version,
      fix: tool.loginCommand ?? definition.authentication,
    };
  }
  return {
    id: definition.id,
    label: definition.label,
    status: "pass",
    required: definition.required,
    detail: definition.ready,
    version: tool.version,
    fix: null,
  };
}

function platformCommands(platform) {
  if (platform === "darwin") {
    return {
      node: "brew install node@22",
      git: "xcode-select --install",
      gh: "brew install gh",
    };
  }
  if (platform === "win32") {
    return {
      node: "winget install OpenJS.NodeJS.LTS",
      git: "winget install Git.Git",
      gh: "winget install GitHub.cli",
    };
  }
  return {
    node: "Install Node.js 22.13 or newer from https://nodejs.org/",
    git: "Install Git using your system package manager.",
    gh: "Install GitHub CLI from https://cli.github.com/",
  };
}

export function buildSetupDoctorReport(options = {}) {
  const platform = options.platform ?? process.platform;
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const commands = platformCommands(platform);
  const checks = [
    {
      id: "node",
      label: "Node.js",
      status: versionAtLeast(nodeVersion, MINIMUM_NODE) ? "pass" : "fail",
      required: true,
      detail: versionAtLeast(nodeVersion, MINIMUM_NODE)
        ? "Node.js meets the code-council runtime requirement."
        : "code-council requires Node.js 22.13 or newer.",
      version: nodeVersion,
      fix: versionAtLeast(nodeVersion, MINIMUM_NODE) ? null : commands.node,
    },
    toolCheck(options.tools, {
      id: "git",
      label: "Git",
      required: true,
      missing: "Git is required for repositories, worktrees, and patch review.",
      ready: "Git is ready for repository and worktree operations.",
      install: commands.git,
    }),
    toolCheck(options.tools, {
      id: "uv",
      label: "uv",
      required: true,
      missing: "uv is required to install and launch the pinned Graphify tool.",
      ready: "uv is available for local Python tools.",
      install: "Install uv from https://docs.astral.sh/uv/getting-started/installation/",
    }),
    toolCheck(options.tools, {
      id: "graphify",
      label: "Graphify",
      required: true,
      missing: "Graphify is required for structural repository retrieval.",
      ready: "Graphify is available for structural repository retrieval.",
      install: "uv tool install 'graphifyy>=0.8.22,<1'",
    }),
    toolCheck(options.tools, {
      id: "codex",
      label: "Codex CLI",
      required: true,
      missing: "Codex is required for the default execution path.",
      ready: "Codex is installed and authenticated.",
      install: "npm install -g @openai/codex",
      authentication: "codex login",
    }),
    toolCheck(options.tools, {
      id: "claude",
      label: "Claude Code",
      required: false,
      missing: "Claude Code is optional for direct Codex tasks but required for council mode.",
      ready: "Claude Code is installed and authenticated for council mode.",
      install: "npm install -g @anthropic-ai/claude-code",
      authentication: "claude auth login",
    }),
    toolCheck(options.tools, {
      id: "gh",
      label: "GitHub CLI",
      required: false,
      missing: "GitHub CLI is optional; install it to push branches and create draft PRs.",
      ready: "GitHub CLI is available for push and draft PR workflows.",
      install: commands.gh,
    }),
  ];

  if (options.openHands != null) {
    checks.push({
      id: "openhands",
      label: "OpenHands Agent Server",
      status: options.openHands.ready ? "pass" : "warn",
      required: false,
      detail: options.openHands.ready
        ? "The pinned local Agent Server is reachable."
        : "Agent Server is not reachable. The launcher normally starts it automatically.",
      version: options.openHands.version ?? null,
      fix: options.openHands.ready ? null : "Start code-council normally or run npm run openhands.",
    });
  }

  const counts = checks.reduce(
    (result, check) => {
      result[check.status] += 1;
      return result;
    },
    { pass: 0, warn: 0, fail: 0 },
  );
  const blocking = checks.filter(
    (check) => check.required && check.status === "fail",
  );
  return {
    ready: blocking.length === 0,
    generatedAt: new Date().toISOString(),
    platform,
    nodeVersion,
    counts,
    summary:
      blocking.length === 0
        ? counts.warn
          ? `Ready with ${counts.warn} optional recommendation${counts.warn === 1 ? "" : "s"}.`
          : "All required and optional checks passed."
        : `${blocking.length} required setup check${blocking.length === 1 ? "" : "s"} need attention.`,
    checks,
  };
}

export function formatSetupDoctorReport(report) {
  const symbol = { pass: "✓", warn: "!", fail: "×" };
  const lines = [
    `code-council doctor — ${report.summary}`,
    "",
    ...report.checks.flatMap((check) => [
      `${symbol[check.status]} ${check.label}${check.version ? ` (${check.version})` : ""}: ${check.detail}`,
      ...(check.fix ? [`  Fix: ${check.fix}`] : []),
    ]),
  ];
  return `${lines.join("\n")}\n`;
}
