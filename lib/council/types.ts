export type CouncilStage =
  | "context"
  | "propose"
  | "critique"
  | "revise"
  | "judge"
  | "verify"
  | "complete";

export type CouncilRunStatus =
  | "queued"
  | "running"
  | "needs_input"
  | "accepted"
  | "needs_revision"
  | "failed"
  | "cancelled";

export type RiskTier = "routine" | "elevated" | "high" | "critical";

export interface AgentIdentity {
  id: string;
  displayName: string;
  vendor: string;
  model?: string;
  kind: "native_cli" | "acp" | "openhands";
}

export interface CouncilProtocol {
  id: string;
  name: string;
  stages: CouncilStage[];
  participants: AgentIdentity[];
  maxCritiqueRounds: number;
  requireExecutableEvidence: boolean;
  adaptiveEscalation: boolean;
  targetConfidence: number;
}

export interface ConfidenceSignals {
  testsPassRate: number | null;
  requiredTestsPassing: boolean | null;
  staticChecksPassRate: number | null;
  patchApplies: boolean | null;
  proposalAgreement: number;
  unresolvedCriticalDissent: boolean;
  judgeStability: number;
  historicalSuccessRate: number;
  memoryCoverage: number;
  memoryFreshness: number;
  patchScopePrior: number;
  riskTier: RiskTier;
}

export interface ConfidenceResult {
  raw: number;
  capped: number;
  confidence: number;
  evidence: Array<{ label: string; contribution: number }>;
  reasons: string[];
}

export interface EscalationDecision {
  escalate: boolean;
  next:
    | "accept"
    | "peer_critique"
    | "full_council"
    | "stronger_judge"
    | "human_input";
  reasons: string[];
}

