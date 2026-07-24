import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import test from "node:test";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_SETTINGS,
  loadCouncilState,
  saveCouncilState,
} from "../local/store.mjs";

test("Council persists repositories, settings, tasks, and context jobs together", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "council-store-"));
  const previous = process.env.COUNCIL_STATE_DIR;
  process.env.COUNCIL_STATE_DIR = directory;
  try {
    await saveCouncilState({
      repositories: [
        {
          id: "repo-1",
          name: "sample",
          path: "/tmp/sample",
          source: "local",
          sourceUrl: null,
          addedAt: "2026-01-01T00:00:00.000Z",
          lastOpenedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      settings: {
        ...DEFAULT_SETTINGS,
        codex: { model: "gpt-5.6-terra", reasoning: "medium" },
      },
      tasks: [{ id: "task-1" }],
      contextJobs: [{ id: "context-1" }],
    });

    const restored = await loadCouncilState();
    assert.equal(restored.schemaVersion, 3);
    assert.equal(restored.repositories[0].id, "repo-1");
    assert.equal(restored.settings.codex.model, "gpt-5.6-terra");
    assert.equal(restored.settings.claude.model, "claude-opus-4-8");
    assert.equal(restored.settings.context.provider, "claude");
    assert.equal(restored.tasks[0].id, "task-1");
    assert.equal(restored.contextJobs[0].id, "context-1");

    const raw = JSON.parse(
      await readFile(path.join(directory, "state.json"), "utf8"),
    );
    assert.equal(raw.schemaVersion, 3);
  } finally {
    if (previous == null) delete process.env.COUNCIL_STATE_DIR;
    else process.env.COUNCIL_STATE_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("older state files receive current local defaults", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "council-store-"));
  const previous = process.env.COUNCIL_STATE_DIR;
  process.env.COUNCIL_STATE_DIR = directory;
  try {
    const empty = await loadCouncilState();
    assert.equal(empty.settings.routingMode, "manual");
    assert.equal(empty.settings.codex.reasoning, "high");
    assert.equal(empty.settings.claude.model, "claude-opus-4-8");
    assert.deepEqual(empty.settings.context, {
      provider: "claude",
      model: "claude-opus-4-8",
      reasoning: "high",
      tokenBudget: 4_000,
      enabledByDefault: true,
      graphify: true,
    });
    assert.deepEqual(empty.repositories, []);
  } finally {
    if (previous == null) delete process.env.COUNCIL_STATE_DIR;
    else process.env.COUNCIL_STATE_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
