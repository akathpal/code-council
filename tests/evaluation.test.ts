import assert from "node:assert/strict";
import test from "node:test";
import { summarizeEvaluations } from "../lib/evaluation/metrics.ts";

test("summarizeEvaluations reports outcome, efficiency, and calibration", () => {
  const summary = summarizeEvaluations([
    {
      strategy: "single",
      success: true,
      testsPassed: 10,
      testsTotal: 10,
      humanApproved: true,
      reviewComments: 1,
      costUsd: 1,
      latencyMs: 1_000,
      confidence: 0.8,
    },
    {
      strategy: "council",
      success: false,
      testsPassed: 8,
      testsTotal: 10,
      humanApproved: false,
      reviewComments: 3,
      costUsd: 3,
      latencyMs: 3_000,
      confidence: 0.6,
    },
  ]);

  assert.equal(summary.successRate, 0.5);
  assert.equal(summary.testPassRate, 0.9);
  assert.equal(summary.humanApprovalRate, 0.5);
  assert.equal(summary.averageCostUsd, 2);
  assert.equal(summary.costPerSuccessUsd, 4);
  assert.equal(summary.medianLatencyMs, 2_000);
  assert.ok(summary.brierScore > 0);
});

