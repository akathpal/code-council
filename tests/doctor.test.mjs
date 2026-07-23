import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSetupDoctorReport,
  formatSetupDoctorReport,
} from "../local/doctor.mjs";

function tool(id, options = {}) {
  return {
    id,
    available: true,
    version: `${id} 1.0.0`,
    authenticated: null,
    loginCommand: null,
    ...options,
  };
}

test("setup doctor separates required failures from optional recommendations", () => {
  const report = buildSetupDoctorReport({
    nodeVersion: "22.13.0",
    platform: "linux",
    tools: {
      git: tool("git"),
      uv: tool("uv"),
      graphify: tool("graphify"),
      codex: tool("codex", { authenticated: true }),
      claude: {
        id: "claude",
        available: false,
        authenticated: false,
      },
      gh: tool("gh"),
    },
    openHands: { ready: false, version: "agent-server@test" },
  });

  assert.equal(report.ready, true);
  assert.equal(report.counts.fail, 0);
  assert.equal(report.counts.warn, 2);
  assert.match(report.summary, /Ready with 2 optional recommendations/);
});

test("setup doctor reports actionable blocking checks", () => {
  const report = buildSetupDoctorReport({
    nodeVersion: "20.0.0",
    platform: "darwin",
    tools: {
      git: { available: false },
      uv: tool("uv"),
      graphify: tool("graphify"),
      codex: tool("codex", {
        authenticated: false,
        loginCommand: "codex login",
      }),
      claude: tool("claude", { authenticated: true }),
      gh: tool("gh"),
    },
  });

  assert.equal(report.ready, false);
  assert.equal(report.counts.fail, 3);
  assert.equal(
    report.checks.find((check) => check.id === "codex-auth").fix,
    "codex login",
  );
  assert.match(formatSetupDoctorReport(report), /Fix: codex login/);
});
