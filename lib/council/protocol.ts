import type {
  AgentIdentity,
  CouncilProtocol,
  CouncilStage,
  RiskTier,
} from "./types";

export const DEFAULT_STAGES: CouncilStage[] = [
  "context",
  "propose",
  "critique",
  "revise",
  "judge",
  "verify",
  "complete",
];

export function createDefaultProtocol(
  participants: AgentIdentity[],
): CouncilProtocol {
  const vendors = new Set(participants.map((participant) => participant.vendor));
  if (participants.length < 2 || vendors.size < 2) {
    throw new Error(
      "A council needs at least two participants from different vendors.",
    );
  }

  return {
    id: "codex-claude-evidence-loop",
    name: "Codex × Claude evidence loop",
    stages: DEFAULT_STAGES,
    participants,
    maxCritiqueRounds: 1,
    requireExecutableEvidence: true,
    adaptiveEscalation: true,
    targetConfidence: 0.82,
  };
}

export function nextStage(
  protocol: CouncilProtocol,
  current: CouncilStage,
): CouncilStage {
  const position = protocol.stages.indexOf(current);
  if (position < 0) {
    throw new Error(`Unknown council stage: ${current}`);
  }
  return protocol.stages[Math.min(position + 1, protocol.stages.length - 1)];
}

export function confidenceTargetForRisk(risk: RiskTier) {
  return {
    routine: 0.78,
    elevated: 0.84,
    high: 0.9,
    critical: 0.95,
  }[risk];
}

