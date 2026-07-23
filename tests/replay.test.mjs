import assert from "node:assert/strict";
import test from "node:test";

import {
  createReplayPlan,
  replayMetadata,
  summarizeReplayJobs,
} from "../local/replay.mjs";

test("replay plans normalize bounded variants and preserve one shared baseline", () => {
  const plan = createReplayPlan(
    {
      prompt: "Add a regression test for the settings parser",
      variants: [
        { strategy: "codex_only", contextEnabled: false },
        {
          strategy: "council_plan_codex_execute",
          contextEnabled: true,
          tokenBudget: 8_000,
        },
      ],
    },
    { tokenBudget: 4_000, graphify: true },
  );
  const repository = { sha: "a".repeat(40), fingerprint: "fingerprint" };
  const first = replayMetadata(plan, plan.variants[0], 0, repository);
  const second = replayMetadata(plan, plan.variants[1], 1, repository);

  assert.equal(plan.intent, "code");
  assert.equal(plan.variants[0].contextPolicy.enabled, false);
  assert.equal(plan.variants[1].contextPolicy.tokenBudget, 8_000);
  assert.equal(first.id, second.id);
  assert.equal(first.baseSha, repository.sha);
  assert.equal(first.intent, "code");
  assert.equal(second.totalVariants, 2);
});

test("read-only replay intent automatically compares Codex and Claude chats", () => {
  const plan = createReplayPlan({
    prompt: "Explain how request routing works in this repository",
    intent: "chat",
    variants: [
      { label: "Codex only", strategy: "codex_only", contextEnabled: true },
      {
        label: "Codex + Claude council",
        strategy: "council_plan_codex_execute",
        contextEnabled: true,
      },
    ],
  });

  assert.equal(plan.intent, "chat");
  assert.deepEqual(
    plan.variants.map((variant) => variant.strategy),
    ["codex_only", "claude_only"],
  );
  assert.deepEqual(
    plan.variants.map((variant) => variant.label),
    ["Codex only", "Claude only · context on"],
  );
});

test("replay plans reject duplicate comparison arms", () => {
  assert.throws(
    () =>
      createReplayPlan({
        prompt: "Fix the parser",
        variants: [
          { strategy: "codex_only", contextEnabled: true },
          { strategy: "codex_only", contextEnabled: true },
        ],
      }),
    /must differ/,
  );
});

test("replay variants can compare models with the same strategy", () => {
  const plan = createReplayPlan({
    prompt: "Explain the request router",
    intent: "chat",
    variants: [
      {
        strategy: "codex_only",
        contextEnabled: true,
        codexModel: "gpt-5.6-sol",
      },
      {
        strategy: "codex_only",
        contextEnabled: true,
        codexModel: "gpt-5.6-terra",
      },
    ],
  });

  assert.deepEqual(
    plan.variants.map((variant) => variant.models.codex),
    ["gpt-5.6-sol", "gpt-5.6-terra"],
  );
});

test("replay variants can compare intelligence with the same model", () => {
  const plan = createReplayPlan({
    prompt: "Explain the request router",
    intent: "chat",
    variants: [
      {
        strategy: "codex_only",
        contextEnabled: true,
        codexModel: "gpt-5.6-sol",
        codexReasoning: "medium",
      },
      {
        strategy: "codex_only",
        contextEnabled: true,
        codexModel: "gpt-5.6-sol",
        codexReasoning: "high",
      },
    ],
  });

  assert.deepEqual(
    plan.variants.map((variant) => variant.reasoning.codex),
    ["medium", "high"],
  );
});

test("replay summaries compare tokens, latency, patch scope, and completion", () => {
  const replay = {
    id: "replay-1",
    baseSha: "b".repeat(40),
    startedAt: "2026-07-22T12:00:00.000Z",
    totalVariants: 2,
  };
  const summary = summarizeReplayJobs([
    {
      id: "task-council",
      replay: { ...replay, label: "Council", variantIndex: 1 },
      prompt: "Fix the parser",
      repository: "/repo",
      repositoryName: "repo",
      decision: { strategy: "council_plan_codex_execute" },
      contextPolicy: { enabled: true },
      status: "awaiting_review",
      stage: "awaiting_review",
      createdAt: replay.startedAt,
      updatedAt: "2026-07-22T12:03:00.000Z",
      usage: {
        totals: {
          calls: 4,
          totalTokens: 12_000,
          contextTokens: 2_000,
          durationMs: 180_000,
          costUsd: 0.4,
        },
      },
      review: {
        files: ["parser.ts", "parser.test.ts"],
        stat: "2 files changed",
        checks: "tests passed",
      },
    },
    {
      id: "task-codex",
      replay: { ...replay, label: "Codex", variantIndex: 0 },
      prompt: "Fix the parser",
      repository: "/repo",
      repositoryName: "repo",
      decision: { strategy: "codex_only" },
      contextPolicy: { enabled: false },
      status: "running",
      stage: "execute",
      createdAt: replay.startedAt,
      updatedAt: "2026-07-22T12:01:00.000Z",
      usage: { totals: { calls: 1, totalTokens: 3_000 } },
      review: null,
    },
  ]);

  assert.equal(summary.length, 1);
  assert.equal(summary[0].finished, false);
  assert.deepEqual(
    summary[0].variants.map((variant) => variant.taskId),
    ["task-codex", "task-council"],
  );
  assert.equal(summary[0].variants[1].changedFiles, 2);
  assert.equal(summary[0].variants[1].totalTokens, 12_000);
  assert.equal(summary[0].variants[1].successful, true);
});
