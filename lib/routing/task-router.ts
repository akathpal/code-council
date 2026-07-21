import type { RiskTier } from "../council/types";

export interface TaskRoutingInput {
  prompt: string;
  estimatedFiles?: number;
  riskTier?: RiskTier;
  memoryCoverage?: number;
  historicalSingleAgentSuccess?: number;
}

export interface TaskRoutingDecision {
  strategy: "codex_only" | "council_plan_codex_execute";
  contextAgent: "claude-opus-4-8-high";
  executionAgent: "codex";
  reasons: string[];
}

const HIGH_RISK_TERMS =
  /\b(auth|payment|refund|security|permission|migration|schema|concurrency|race|breaking|production)\b/i;
const SMALL_TASK_TERMS =
  /\b(typo|rename|copy|comment|format|lint|single test|one line|small)\b/i;

export function routeCodingTask(
  input: TaskRoutingInput,
): TaskRoutingDecision {
  const prompt = input.prompt.trim();
  const estimatedFiles = input.estimatedFiles ?? 1;
  const riskTier = input.riskTier ?? "routine";
  const memoryCoverage = input.memoryCoverage ?? 1;
  const historicalSuccess = input.historicalSingleAgentSuccess ?? 1;
  const reasons: string[] = [];

  const routine = riskTier === "routine";
  const clearlySmall =
    prompt.length <= 180 &&
    estimatedFiles <= 1 &&
    !HIGH_RISK_TERMS.test(prompt) &&
    (SMALL_TASK_TERMS.test(prompt) || prompt.split(/\s+/).length <= 18);
  if (routine && clearlySmall) {
    reasons.push("Routine task with an estimated one-file patch.");
    reasons.push(
      memoryCoverage >= 0.85 && historicalSuccess >= 0.75
        ? "Repository memory supports a fast single-agent route."
        : "Codex can inspect the narrow source scope directly.",
    );
    return {
      strategy: "codex_only",
      contextAgent: "claude-opus-4-8-high",
      executionAgent: "codex",
      reasons,
    };
  }

  if (!routine) reasons.push(`Risk tier is ${riskTier}.`);
  if (estimatedFiles > 1) {
    reasons.push(`The patch is estimated to touch ${estimatedFiles} files.`);
  }
  if (HIGH_RISK_TERMS.test(prompt)) {
    reasons.push("The task contains a high-impact domain signal.");
  }
  if (memoryCoverage < 0.85) {
    reasons.push("Repository memory coverage is below the single-agent floor.");
  }
  reasons.push("Codex and Claude should independently plan before execution.");

  return {
    strategy: "council_plan_codex_execute",
    contextAgent: "claude-opus-4-8-high",
    executionAgent: "codex",
    reasons,
  };
}
