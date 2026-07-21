import { access } from "node:fs/promises";
import path from "node:path";

const OPERATIONS = new Set(["query", "path", "explain", "affected"]);
const SAFE_RELATION = /^[a-z][a-z0-9_-]{0,63}$/i;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 2_000;

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}

function boundedText(value, label, maximum = 4_000) {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) throw new Error(`Graphify ${label} cannot be empty.`);
  if (normalized.includes("\0")) {
    throw new Error(`Graphify ${label} contains an invalid character.`);
  }
  return normalized.slice(0, maximum);
}

export function graphifyGraphPath(repositoryPath, requestedPath) {
  const repositoryRoot = path.resolve(repositoryPath);
  const graphRoot = path.resolve(repositoryRoot, "graphify-out");
  const graphPath = path.resolve(
    repositoryRoot,
    requestedPath ?? path.join("graphify-out", "graph.json"),
  );
  if (
    graphPath !== path.join(graphRoot, "graph.json") &&
    !graphPath.startsWith(`${graphRoot}${path.sep}`)
  ) {
    throw new Error("Graphify graph paths must stay inside graphify-out/.");
  }
  return graphPath;
}

export function graphifyOperationArgs(repositoryPath, request = {}) {
  const operation = String(request.operation ?? "").toLowerCase();
  if (!OPERATIONS.has(operation)) {
    throw new Error(`Unsupported Graphify operation: ${operation || "missing"}.`);
  }
  const graphPath = graphifyGraphPath(repositoryPath, request.graphPath);
  const args = [operation];

  if (operation === "query") {
    args.push(boundedText(request.question, "query"));
    for (const relation of request.contextFilters ?? []) {
      const normalized = boundedText(relation, "context relation", 64);
      if (!SAFE_RELATION.test(normalized)) {
        throw new Error(`Invalid Graphify context relation: ${normalized}.`);
      }
      args.push("--context", normalized);
    }
    args.push(
      "--budget",
      String(boundedInteger(request.budget, 2_000, 64, 8_000)),
    );
  } else if (operation === "path") {
    args.push(
      boundedText(request.from, "path source", 500),
      boundedText(request.to, "path target", 500),
    );
  } else {
    args.push(boundedText(request.target, `${operation} target`, 500));
    if (operation === "affected") {
      for (const relation of request.relations ?? []) {
        const normalized = boundedText(relation, "affected relation", 64);
        if (!SAFE_RELATION.test(normalized)) {
          throw new Error(`Invalid Graphify affected relation: ${normalized}.`);
        }
        args.push("--relation", normalized);
      }
      args.push(
        "--depth",
        String(boundedInteger(request.depth, 2, 1, 4)),
      );
    }
  }
  args.push("--graph", graphPath);
  return { operation, args, graphPath };
}

export async function runGraphifyOperation(
  repositoryPath,
  request,
  options = {},
) {
  const { operation, args, graphPath } = graphifyOperationArgs(
    repositoryPath,
    request,
  );
  await access(graphPath);
  if (typeof options.runner !== "function") {
    throw new Error("Graphify gateway requires a process runner.");
  }
  const timeout = boundedInteger(
    options.timeout,
    DEFAULT_TIMEOUT_MS,
    1_000,
    120_000,
  );
  const maxOutputTokens = boundedInteger(
    options.maxOutputTokens ?? request.budget,
    DEFAULT_MAX_OUTPUT_TOKENS,
    64,
    8_000,
  );
  const result = await options.runner("graphify", args, {
    cwd: path.resolve(repositoryPath),
    timeout,
    maxBuffer: Math.min(8 * 1024 * 1024, maxOutputTokens * 16),
    ...options.runtime,
  });
  const rawOutput = String(result?.stdout ?? "").trim();
  const output = rawOutput.slice(0, maxOutputTokens * 4);
  return {
    operation,
    status: output ? "used" : "empty",
    output,
    truncated: output.length < rawOutput.length,
    estimatedTokens: Math.ceil(output.length / 4),
    durationMs: Math.max(0, Math.round(Number(result?.durationMs ?? 0))),
    graphPath,
    args,
  };
}

export function scoreGraphifyConfidence({
  status,
  nodeCount = 0,
  referencedPaths = [],
  symbols = [],
  queryCount = 0,
  successfulQueries = 0,
  repositoryStatus = "missing",
  memoryMatchCount = 0,
  relevanceScore = 0.5,
} = {}) {
  if (status === "disabled") {
    return {
      score: 0,
      level: "disabled",
      threshold: 0.68,
      shouldEscalate: false,
      reasons: ["Graphify is disabled for this task."],
      signals: {
        relevance: 0,
        nodeCoverage: 0,
        pathCoverage: 0,
        memoryMatches: 0,
        fresh: repositoryStatus === "fresh",
      },
    };
  }

  const reasons = [];
  const boundedRelevance = Math.max(0, Math.min(1, relevanceScore));
  let score = status === "used" ? 0.1 : 0;
  score += Math.min(1, nodeCount / 6) * 0.15;
  score += Math.min(1, referencedPaths.length / 4) * 0.15;
  score += Math.min(1, symbols.length / 5) * 0.05;
  score +=
    queryCount > 0
      ? Math.min(1, successfulQueries / Math.max(1, queryCount)) * 0.05
      : 0;
  score += repositoryStatus === "fresh" ? 0.1 : 0;
  score += Math.min(1, memoryMatchCount / 3) * 0.1;
  score += boundedRelevance * 0.3;
  score = Math.round(Math.min(1, score) * 100) / 100;

  if (status !== "used") reasons.push("The initial graph query returned no usable nodes.");
  if (referencedPaths.length < 2) reasons.push("Few source paths matched the task.");
  if (nodeCount < 3) reasons.push("The structural result has limited node coverage.");
  if (boundedRelevance < 0.5) {
    reasons.push("Graph symbols and paths have weak overlap with the task terms.");
  }
  if (repositoryStatus !== "fresh") reasons.push("Repository memory is stale or missing.");
  if (memoryMatchCount > 0) {
    reasons.push(`${memoryMatchCount} generated context document${memoryMatchCount === 1 ? "" : "s"} matched graph evidence.`);
  }
  if (!reasons.length) reasons.push("Graph paths and generated memory provide broad task coverage.");

  const threshold = 0.68;
  return {
    score,
    level: score >= 0.78 ? "high" : score >= 0.5 ? "medium" : "low",
    threshold,
    shouldEscalate: score < threshold,
    reasons,
    signals: {
      relevance: Math.round(boundedRelevance * 100) / 100,
      nodeCoverage: Math.round(Math.min(1, nodeCount / 6) * 100) / 100,
      pathCoverage:
        Math.round(Math.min(1, referencedPaths.length / 4) * 100) / 100,
      memoryMatches: memoryMatchCount,
      fresh: repositoryStatus === "fresh",
    },
  };
}
