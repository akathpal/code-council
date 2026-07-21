import assert from "node:assert/strict";
import test from "node:test";

import {
  agentActivityFromLine,
  mergeAgentActivity,
} from "../local/agent-activity.mjs";

test("Codex command events become a bounded readable activity record", () => {
  const started = agentActivityFromLine(
    "codex",
    JSON.stringify({
      method: "item/started",
      params: {
        item: {
          id: "exec-1",
          type: "commandExecution",
          command: "npm test",
          status: "inProgress",
        },
      },
    }),
  );
  const completed = agentActivityFromLine(
    "codex",
    JSON.stringify({
      method: "item/completed",
      params: {
        item: {
          id: "exec-1",
          type: "commandExecution",
          command: "npm test",
          status: "completed",
          aggregatedOutput: "69 tests passed",
          exitCode: 0,
        },
      },
    }),
  );
  const activity = mergeAgentActivity(
    mergeAgentActivity([], started, "2026-01-01T00:00:00.000Z"),
    completed,
    "2026-01-01T00:00:02.000Z",
  );

  assert.equal(activity.length, 1);
  assert.equal(activity[0].detail, "npm test");
  assert.equal(activity[0].output, "69 tests passed");
  assert.equal(activity[0].status, "complete");
  assert.equal(activity[0].exitCode, 0);
  assert.equal(activity[0].startedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(activity[0].endedAt, "2026-01-01T00:00:02.000Z");
});

test("Claude tool use becomes the same cross-agent activity shape", () => {
  const activity = agentActivityFromLine(
    "claude",
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Read",
            input: { file_path: "src/auth.ts" },
          },
          {
            type: "tool_use",
            id: "tool-2",
            name: "Bash",
            input: { command: "npm test" },
          },
        ],
      },
    }),
  );

  assert.deepEqual(
    activity.map(({ kind, label, detail, status }) => ({
      kind,
      label,
      detail,
      status,
    })),
    [
      {
        kind: "read",
        label: "Reading file",
        detail: "src/auth.ts",
        status: "running",
      },
      {
        kind: "command",
        label: "Running command",
        detail: "npm test",
        status: "running",
      },
    ],
  );
});

test("agent activity ignores malformed lines and hidden reasoning content", () => {
  assert.deepEqual(agentActivityFromLine("codex", "not json"), []);
  const activity = agentActivityFromLine(
    "codex",
    JSON.stringify({
      method: "item/completed",
      params: {
        item: {
          id: "reason-1",
          type: "reasoning",
          summary: ["private chain of thought"],
          content: ["private chain of thought"],
        },
      },
    }),
  );
  assert.equal(activity[0].label, "Analysis complete");
  assert.equal(activity[0].detail, "");
});
