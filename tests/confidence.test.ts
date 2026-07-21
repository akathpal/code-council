import assert from "node:assert/strict";
import test from "node:test";
import {
  computeConfidence,
  decideEscalation,
} from "../lib/council/confidence.ts";
import type { ConfidenceSignals } from "../lib/council/types.ts";

const strongSignals: ConfidenceSignals = {
  testsPassRate: 1,
  requiredTestsPassing: true,
  staticChecksPassRate: 1,
  patchApplies: true,
  proposalAgreement: 0.9,
  unresolvedCriticalDissent: false,
  judgeStability: 0.9,
  historicalSuccessRate: 0.88,
  memoryCoverage: 0.92,
  memoryFreshness: 1,
  patchScopePrior: 0.9,
  riskTier: "elevated",
};

test("strong deterministic evidence clears the default target", () => {
  const confidence = computeConfidence(strongSignals);
  const decision = decideEscalation(strongSignals, 0.82);

  assert.ok(confidence.confidence >= 0.82);
  assert.equal(decision.escalate, false);
  assert.equal(decision.next, "accept");
});

test("a failing required test caps confidence and triggers peer critique", () => {
  const signals: ConfidenceSignals = {
    ...strongSignals,
    testsPassRate: 0.9,
    requiredTestsPassing: false,
  };
  const confidence = computeConfidence(signals);
  const decision = decideEscalation(signals, 0.82);

  assert.equal(confidence.confidence, 0.35);
  assert.equal(decision.escalate, true);
  assert.equal(decision.next, "peer_critique");
});

test("critical dissent escalates a full council to a human", () => {
  const decision = decideEscalation(
    { ...strongSignals, unresolvedCriticalDissent: true, riskTier: "critical" },
    0.95,
    "full_council",
  );

  assert.equal(decision.next, "human_input");
});

