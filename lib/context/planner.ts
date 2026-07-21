import type {
  ContextCandidate,
  ContextPack,
  IncrementalIndexPlan,
  RepositoryManifest,
} from "./types";

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function contextCandidateScore(candidate: ContextCandidate) {
  return (
    clamp(candidate.relevance) * 0.38 +
    clamp(candidate.graphProximity) * 0.2 +
    clamp(candidate.freshness) * 0.15 +
    clamp(candidate.confidence) * 0.15 +
    clamp(candidate.historicalUtility) * 0.12
  );
}

export function buildContextPack(
  candidates: ContextCandidate[],
  budgetTokens: number,
  baselineTokens = candidates.reduce(
    (sum, candidate) => sum + candidate.estimatedTokens,
    0,
  ),
): ContextPack {
  if (!Number.isFinite(budgetTokens) || budgetTokens <= 0) {
    throw new Error("budgetTokens must be a positive number");
  }

  const ordered = [...candidates].sort((left, right) => {
    if (Boolean(left.required) !== Boolean(right.required)) {
      return left.required ? -1 : 1;
    }
    return contextCandidateScore(right) - contextCandidateScore(left);
  });

  const selected: ContextCandidate[] = [];
  const rejected: ContextPack["rejected"] = [];
  const hashes = new Set<string>();
  let selectedTokens = 0;

  for (const candidate of ordered) {
    if (hashes.has(candidate.contentHash)) {
      rejected.push({ ...candidate, reason: "duplicate" });
      continue;
    }

    if (selectedTokens + candidate.estimatedTokens > budgetTokens) {
      rejected.push({ ...candidate, reason: "budget" });
      continue;
    }

    selected.push(candidate);
    hashes.add(candidate.contentHash);
    selectedTokens += candidate.estimatedTokens;
  }

  const rawCandidateTokens = candidates.reduce(
    (sum, candidate) => sum + candidate.estimatedTokens,
    0,
  );
  const safeBaseline = Math.max(baselineTokens, selectedTokens);
  const savedTokens = Math.max(0, safeBaseline - selectedTokens);

  return {
    selected,
    rejected,
    budgetTokens,
    selectedTokens,
    rawCandidateTokens,
    baselineTokens: safeBaseline,
    savedTokens,
    savingsRate: safeBaseline === 0 ? 0 : savedTokens / safeBaseline,
    coverageRate:
      candidates.length === 0 ? 1 : selected.length / candidates.length,
  };
}

export function planIncrementalIndex(
  previous: RepositoryManifest | null,
  current: RepositoryManifest,
): IncrementalIndexPlan {
  const previousFiles = previous?.files ?? {};
  const currentFiles = current.files;
  const added: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];
  const reused: string[] = [];

  for (const [path, hash] of Object.entries(currentFiles)) {
    if (!(path in previousFiles)) {
      added.push(path);
    } else if (previousFiles[path] !== hash) {
      modified.push(path);
    } else {
      reused.push(path);
    }
  }

  for (const path of Object.keys(previousFiles)) {
    if (!(path in currentFiles)) {
      removed.push(path);
    }
  }

  return {
    fromSha: previous?.sha ?? null,
    toSha: current.sha,
    added: added.sort(),
    modified: modified.sort(),
    removed: removed.sort(),
    reused: reused.sort(),
  };
}

