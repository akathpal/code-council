import type {
  ConfidenceResult,
  ConfidenceSignals,
  EscalationDecision,
} from "./types";

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

function optionalSignal(value: number | null, fallback: number) {
  return value === null ? fallback : clamp(value);
}

export function computeConfidence(
  signals: ConfidenceSignals,
): ConfidenceResult {
  const deterministic =
    optionalSignal(signals.testsPassRate, 0.45) * 0.72 +
    optionalSignal(signals.staticChecksPassRate, 0.6) * 0.28;
  const memory =
    clamp(signals.memoryCoverage) * 0.6 + clamp(signals.memoryFreshness) * 0.4;

  const evidence = [
    { label: "Deterministic evidence", contribution: deterministic * 0.35 },
    {
      label: "Proposal agreement",
      contribution: clamp(signals.proposalAgreement) * 0.2,
    },
    {
      label: "Judge stability",
      contribution: clamp(signals.judgeStability) * 0.15,
    },
    {
      label: "Historical success",
      contribution: clamp(signals.historicalSuccessRate) * 0.15,
    },
    { label: "Memory coverage", contribution: memory * 0.1 },
    {
      label: "Patch scope prior",
      contribution: clamp(signals.patchScopePrior) * 0.05,
    },
  ];
  const raw = evidence.reduce((sum, item) => sum + item.contribution, 0);
  const reasons: string[] = [];
  let cap = 1;

  if (signals.patchApplies === false) {
    cap = Math.min(cap, 0.2);
    reasons.push("The patch does not apply cleanly.");
  }
  if (signals.requiredTestsPassing === false) {
    cap = Math.min(cap, 0.35);
    reasons.push("At least one required test is failing.");
  }
  if (signals.unresolvedCriticalDissent) {
    cap = Math.min(cap, 0.45);
    reasons.push("A critical critique remains unresolved.");
  }
  if (
    (signals.riskTier === "high" || signals.riskTier === "critical") &&
    signals.testsPassRate === null
  ) {
    cap = Math.min(cap, 0.55);
    reasons.push("High-risk work has no executable test evidence.");
  }

  const capped = Math.min(raw, cap);

  return {
    raw,
    capped,
    confidence: capped,
    evidence,
    reasons,
  };
}

export function decideEscalation(
  signals: ConfidenceSignals,
  targetConfidence: number,
  currentTier: "single_agent" | "peer_critique" | "full_council" = "single_agent",
): EscalationDecision {
  const result = computeConfidence(signals);
  const reasons = [...result.reasons];

  if (signals.unresolvedCriticalDissent) {
    return {
      escalate: true,
      next: currentTier === "full_council" ? "human_input" : "full_council",
      reasons,
    };
  }

  if (result.confidence >= clamp(targetConfidence)) {
    return { escalate: false, next: "accept", reasons };
  }

  reasons.push(
    `Calibrated confidence ${Math.round(result.confidence * 100)}% is below the ${Math.round(clamp(targetConfidence) * 100)}% target.`,
  );

  if (currentTier === "single_agent") {
    return { escalate: true, next: "peer_critique", reasons };
  }
  if (currentTier === "peer_critique") {
    return { escalate: true, next: "full_council", reasons };
  }

  return {
    escalate: true,
    next:
      signals.riskTier === "critical" || signals.requiredTestsPassing === false
        ? "human_input"
        : "stronger_judge",
    reasons,
  };
}

