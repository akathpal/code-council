import assert from "node:assert/strict";
import test from "node:test";
import { routeCodingTask } from "../lib/routing/task-router.ts";

test("routes a routine one-file edit directly to Codex", () => {
  const decision = routeCodingTask({
    prompt: "Fix the typo in the settings label",
    estimatedFiles: 1,
    riskTier: "routine",
    memoryCoverage: 0.95,
    historicalSingleAgentSuccess: 0.83,
  });

  assert.equal(decision.strategy, "codex_only");
  assert.equal(decision.executionAgent, "codex");
});

test("keeps clearly small tasks single-agent when memory is missing", () => {
  const decision = routeCodingTask({
    prompt: "Fix a typo in README",
    memoryCoverage: 0,
    historicalSingleAgentSuccess: 0,
  });

  assert.equal(decision.strategy, "codex_only");
});

test("routes risky or multi-file work through council planning", () => {
  const decision = routeCodingTask({
    prompt: "Change refund concurrency and migrate the payment schema",
    estimatedFiles: 6,
    riskTier: "high",
    memoryCoverage: 0.92,
    historicalSingleAgentSuccess: 0.86,
  });

  assert.equal(decision.strategy, "council_plan_codex_execute");
  assert.match(decision.reasons.join(" "), /high|impact/i);
});
