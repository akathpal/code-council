export const GRAPHIFY_PACKAGE = "graphifyy";
export const GRAPHIFY_MINIMUM_VERSION = "0.8.22";

export type GraphifyUpdateMode = "initial" | "incremental" | "manual";

export interface GraphifyInvocation {
  executable: "graphify";
  args: string[];
  workingDirectory: string;
  expectedOutputs: string[];
  networkRequired: false;
}

export interface GraphifyEdge {
  source: string;
  target: string;
  relation: string;
  provenance: "EXTRACTED" | "INFERRED" | "AMBIGUOUS";
}

export function graphifyExtraction(
  repositoryPath: string,
  mode: GraphifyUpdateMode,
): GraphifyInvocation {
  void mode;
  return {
    executable: "graphify",
    args: ["update", repositoryPath, "--no-cluster"],
    workingDirectory: repositoryPath,
    expectedOutputs: ["graphify-out/graph.json"],
    networkRequired: false,
  };
}

export function graphifyTaskQuery(
  question: string,
  graphPath = "graphify-out/graph.json",
  budget = 2_000,
) {
  const normalized = question.trim().replace(/\s+/g, " ");
  if (!normalized) throw new Error("Graphify query cannot be empty.");
  if (!Number.isFinite(budget) || budget < 1) {
    throw new Error("Graphify query budget must be positive.");
  }
  return {
    executable: "graphify" as const,
    args: [
      "query",
      normalized,
      "--context",
      "call",
      "--context",
      "import",
      "--budget",
      String(Math.round(budget)),
      "--graph",
      graphPath,
    ],
  };
}

export function graphifyInstallCommand() {
  return {
    executable: "uv" as const,
    args: [
      "tool",
      "install",
      `${GRAPHIFY_PACKAGE}>=${GRAPHIFY_MINIMUM_VERSION},<1`,
    ],
    requiresExplicitConfirmation: true,
  };
}
