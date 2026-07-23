import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function systemParentPid(pid) {
  const result = await execFileAsync(
    "ps",
    ["-o", "ppid=", "-p", String(pid)],
    { timeout: 2_000 },
  ).catch(() => null);
  const parentPid = Number(result?.stdout.trim());
  return Number.isInteger(parentPid) && parentPid > 0 ? parentPid : null;
}

export async function processAncestorIds(
  startPid = process.pid,
  parentPid = systemParentPid,
) {
  const ancestors = new Set();
  let currentPid = startPid;

  for (let depth = 0; depth < 64; depth += 1) {
    const nextPid = await parentPid(currentPid);
    if (nextPid == null || nextPid === currentPid || ancestors.has(nextPid)) {
      break;
    }
    ancestors.add(nextPid);
    currentPid = nextPid;
  }

  return ancestors;
}
