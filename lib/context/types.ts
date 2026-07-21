export type MemoryArtifactKind =
  | "repo_overview"
  | "module_summary"
  | "symbol"
  | "convention"
  | "decision"
  | "failure_pattern"
  | "task_outcome";

export interface ContextCandidate {
  id: string;
  kind: MemoryArtifactKind;
  label: string;
  contentHash: string;
  estimatedTokens: number;
  relevance: number;
  graphProximity: number;
  freshness: number;
  confidence: number;
  historicalUtility: number;
  required?: boolean;
}

export interface ContextPack {
  selected: ContextCandidate[];
  rejected: Array<ContextCandidate & { reason: "duplicate" | "budget" }>;
  budgetTokens: number;
  selectedTokens: number;
  rawCandidateTokens: number;
  baselineTokens: number;
  savedTokens: number;
  savingsRate: number;
  coverageRate: number;
}

export interface RepositoryManifest {
  sha: string;
  files: Record<string, string>;
}

export interface IncrementalIndexPlan {
  fromSha: string | null;
  toSha: string;
  added: string[];
  modified: string[];
  removed: string[];
  reused: string[];
}

export type AgentContextArtifactKind =
  | "repository"
  | "module"
  | "symbol"
  | "decision"
  | "convention"
  | "failure";

export interface RepositorySymbol {
  filePath: string;
  name: string;
  kind: "function" | "class" | "method" | "type" | "constant";
  signature?: string;
  contentHash: string;
}

export interface AgentContextArtifactPlan {
  kind: AgentContextArtifactKind;
  outputPath: string;
  sourcePaths: string[];
  sourceHashes: string[];
  regenerate: boolean;
}
