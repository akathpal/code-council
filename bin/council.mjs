#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, readlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";
import { detectLocalTools } from "../local/core.mjs";
import {
  buildSetupDoctorReport,
  formatSetupDoctorReport,
} from "../local/doctor.mjs";
import { processAncestorIds } from "../local/launcher-processes.mjs";
import { resolveWebRuntime } from "../local/web-runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);
const stateDirectory = path.resolve(
  process.env.COUNCIL_STATE_DIR ?? path.join(os.homedir(), ".council"),
);
const pidFile = path.join(stateDirectory, "council.pid");
const children = [];
let stopping = false;

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function processWorkingDirectory(pid) {
  if (process.platform === "linux") {
    return readlink(`/proc/${pid}/cwd`).catch(() => null);
  }
  const result = await execFileAsync(
    "lsof",
    ["-a", "-p", String(pid), "-d", "cwd", "-Fn"],
    { timeout: 2_000 },
  ).catch(() => null);
  return (
    result?.stdout
      .split(/\r?\n/)
      .find((line) => line.startsWith("n"))
      ?.slice(1) ?? null
  );
}

async function runningCouncilLaunchers() {
  const candidates = new Set();
  const ancestorPids = await processAncestorIds();
  const storedPid = Number(
    await readFile(pidFile, "utf8").catch(() => ""),
  );
  if (Number.isInteger(storedPid) && storedPid > 0) candidates.add(storedPid);

  const discovered = await execFileAsync(
    "pgrep",
    ["-f", "bin/council.mjs"],
    { timeout: 2_000 },
  ).catch(() => ({ stdout: "" }));
  for (const value of discovered.stdout.split(/\s+/).filter(Boolean)) {
    candidates.add(Number(value));
  }

  // A terminal or app crash can orphan the web/local children after the
  // launcher PID disappears. Recover those listeners as part of the same
  // project-scoped restart instead of silently moving the UI to another port.
  for (const port of [3000, 4781]) {
    const listeners = await execFileAsync(
      "lsof",
      ["-nP", `-tiTCP:${port}`, "-sTCP:LISTEN"],
      { timeout: 2_000 },
    ).catch(() => ({ stdout: "" }));
    for (const value of listeners.stdout.split(/\s+/).filter(Boolean)) {
      candidates.add(Number(value));
    }
  }

  const matching = [];
  for (const pid of candidates) {
    if (
      !Number.isInteger(pid) ||
      pid <= 0 ||
      pid === process.pid ||
      ancestorPids.has(pid)
    ) {
      continue;
    }
    if (!processExists(pid)) continue;
    const cwd = await processWorkingDirectory(pid);
    if (cwd && path.resolve(cwd) === root) matching.push(pid);
  }
  return matching;
}

async function stopProcess(pid) {
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
    return;
  }
  const deadline = Date.now() + 10_000;
  while (processExists(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (processExists(pid)) process.kill(pid, "SIGKILL");
}

async function clearPidFile() {
  const storedPid = Number(
    await readFile(pidFile, "utf8").catch(() => ""),
  );
  if (storedPid === process.pid) await unlink(pidFile).catch(() => {});
}

if (process.argv[2] === "doctor") {
  const openHandsUrl =
    process.env.COUNCIL_OPENHANDS_URL ?? "http://127.0.0.1:8001";
  const [tools, openHandsReady] = await Promise.all([
    detectLocalTools(),
    fetch(`${openHandsUrl}/ready`, { signal: AbortSignal.timeout(1_500) })
      .then((response) => response.ok)
      .catch(() => false),
  ]);
  const report = buildSetupDoctorReport({
    tools,
    openHands: {
      ready: openHandsReady,
      version: "agent-canvas@1.5.0 / agent-server@1.36.1",
    },
  });
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatSetupDoctorReport(report));
  }
  process.exit(report.ready ? 0 : 1);
}

const existingLaunchers = await runningCouncilLaunchers();
if (process.argv[2] === "stop") {
  if (!existingLaunchers.length) {
    console.log("code-council is not running.");
    await unlink(pidFile).catch(() => {});
    process.exit(0);
  }
  console.log(
    `Stopping code-council (PID${existingLaunchers.length === 1 ? "" : "s"} ${existingLaunchers.join(", ")})…`,
  );
  await Promise.all(existingLaunchers.map(stopProcess));
  await unlink(pidFile).catch(() => {});
  console.log("code-council stopped.");
  process.exit(0);
}

if (process.argv.includes("--restart")) {
  if (existingLaunchers.length) {
    console.log(
      `Restarting code-council (stopping PID${existingLaunchers.length === 1 ? "" : "s"} ${existingLaunchers.join(", ")})…`,
    );
    await Promise.all(existingLaunchers.map(stopProcess));
  }
} else if (existingLaunchers.length) {
  console.error(
    `code-council is already running (PID ${existingLaunchers[0]}). Use "npm run restart" to restart it.`,
  );
  process.exit(1);
}

const webRuntime = await resolveWebRuntime({
  override: process.env.COUNCIL_WEB_RUNTIME,
  execFile: execFileAsync,
});

await mkdir(stateDirectory, { recursive: true });
await writeFile(pidFile, `${process.pid}\n`, "utf8");

async function reachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(800) });
    return response.ok;
  } catch {
    return false;
  }
}

async function containerWebRunning() {
  const result = await execFileAsync(
    "docker",
    [
      "compose",
      "-f",
      "compose.ubuntu20.yml",
      "ps",
      "--status",
      "running",
      "--quiet",
      "web",
    ],
    { cwd: root, timeout: 5_000 },
  ).catch(() => null);
  return Boolean(result?.stdout.trim());
}

function launch(label, executable, args, env = {}) {
  const child = spawn(executable, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);

  for (const [stream, writer] of [
    [child.stdout, process.stdout],
    [child.stderr, process.stderr],
  ]) {
    stream?.on("data", (chunk) => {
      const lines = chunk.toString().split(/\r?\n/);
      for (const line of lines) {
        if (line) writer.write(`[${label}] ${line}\n`);
      }
    });
  }

  child.on("exit", (code, signal) => {
    if (!stopping && code !== 0) {
      console.error(
        `[${label}] stopped unexpectedly (${signal ?? `exit ${code}`})`,
      );
    }
  });
  return child;
}

async function shutdown(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  await Promise.all(
    children.map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null) return resolve();
          child.once("exit", resolve);
          child.kill(signal);
          setTimeout(() => {
            if (child.exitCode === null) child.kill("SIGKILL");
            resolve();
          }, 4_000).unref();
        }),
    ),
  );
}

process.on("SIGINT", async () => {
  await shutdown("SIGINT");
  await clearPidFile();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await shutdown("SIGTERM");
  await clearPidFile();
  process.exit(0);
});

console.log("\nCouncil — local coding-agent council");
console.log("Starting on this machine; repository paths and CLI logins stay local.\n");

const openHandsReady = await reachable("http://127.0.0.1:8001/ready");
if (!openHandsReady && process.env.COUNCIL_SKIP_OPENHANDS !== "1") {
  launch(
    "openhands",
    path.join(root, "node_modules", ".bin", "agent-canvas"),
    ["--backend-only", "--port", "8001"],
  );
} else if (openHandsReady) {
  console.log("[openhands] Reusing the backend already running on port 8001.");
}

launch("local", process.execPath, [path.join(root, "local", "server.mjs")]);
if (webRuntime.kind === "container") {
  console.log(
    `[web] Using the containerized runtime (${webRuntime.reason}).`,
  );
  if (await containerWebRunning()) {
    console.log("[web] Reusing the container already running on port 3000.");
  } else {
    launch("web", "docker", [
      "compose",
      "-f",
      "compose.ubuntu20.yml",
      "up",
      "--build",
      "--remove-orphans",
    ]);
  }
} else {
  launch("web", "npm", ["run", "web:dev"]);
}

console.log("\nCouncil UI:       http://localhost:3000");
console.log("OpenHands API:    http://localhost:8001");
console.log("Local companion:  http://127.0.0.1:4781");
console.log("Press Ctrl+C to stop all code-council services.\n");

await new Promise(() => {});
