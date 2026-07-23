import { randomUUID } from "node:crypto";

const STRATEGIES = new Set([
  "codex_only",
  "claude_only",
  "council_plan_codex_execute",
]);
const SAFE_MODEL = /^[a-zA-Z0-9][a-zA-Z0-9._:/[\]-]{0,99}$/;
const CODEX_REASONING = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);
const CLAUDE_REASONING = new Set(["low", "medium", "high", "xhigh", "max"]);
const FINISHED_STATUSES = new Set([
  "accepted",
  "awaiting_review",
  "canceled",
  "completed",
  "conflict",
  "failed",
  "rejected",
]);

function defaultLabel(strategy, contextEnabled) {
  const strategyLabel = {
    codex_only: "Codex only",
    claude_only: "Claude only",
    council_plan_codex_execute: "Codex + Claude council",
  }[strategy];
  return `${strategyLabel} · context ${contextEnabled ? "on" : "off"}`;
}

function normalizedModel(value, agent) {
  const model = String(value ?? "").trim();
  if (!model) return null;
  if (!SAFE_MODEL.test(model) || (agent === "claude" && /\bfable\b/i.test(model))) {
    throw new Error(`Replay variant has an invalid ${agent === "claude" ? "Claude" : "Codex"} model.`);
  }
  return model;
}

function normalizedReasoning(value, agent) {
  const reasoning = String(value ?? "").trim();
  if (!reasoning) return null;
  const supported = agent === "claude" ? CLAUDE_REASONING : CODEX_REASONING;
  if (!supported.has(reasoning)) {
    throw new Error(
      `Replay variant has an invalid ${agent === "claude" ? "Claude" : "Codex"} intelligence level.`,
    );
  }
  return reasoning;
}

function normalizedVariant(value, index, defaults, intent) {
  const requestedStrategy = String(value?.strategy ?? "");
  const strategy =
    intent === "chat" && requestedStrategy === "council_plan_codex_execute"
      ? "claude_only"
      : requestedStrategy;
  if (!STRATEGIES.has(strategy)) {
    throw new Error(`Replay variant ${index + 1} has an unsupported strategy.`);
  }
  const enabled = value?.contextEnabled !== false;
  const tokenBudget = Math.max(
    256,
    Math.min(
      64_000,
      Math.round(Number(value?.tokenBudget ?? defaults.tokenBudget) || 4_000),
    ),
  );
  const requestedLabel = String(value?.label ?? "").trim();
  const label = String(
    intent === "chat" &&
      requestedStrategy === "council_plan_codex_execute" &&
      /^Codex \+ Claude council(?: · context (?:on|off))?$/.test(requestedLabel)
      ? defaultLabel(strategy, enabled)
      : requestedLabel || defaultLabel(strategy, enabled),
  ).trim();
  if (!label || label.length > 80) {
    throw new Error("Replay variant labels must be between 1 and 80 characters.");
  }
  return {
    label,
    strategy,
    models: {
      codex: normalizedModel(value?.codexModel, "codex"),
      claude: normalizedModel(value?.claudeModel, "claude"),
    },
    reasoning: {
      codex: normalizedReasoning(value?.codexReasoning, "codex"),
      claude: normalizedReasoning(value?.claudeReasoning, "claude"),
    },
    contextPolicy: {
      enabled,
      tokenBudget,
      graphify: value?.graphify == null ? defaults.graphify : value.graphify !== false,
    },
  };
}

export function createReplayPlan(input = {}, defaults = {}) {
  const prompt = String(input.prompt ?? "").trim();
  if (!prompt) throw new Error("Enter a repository question or coding task to compare.");
  if (prompt.length > 20_000) {
    throw new Error("Replay tasks must be 20,000 characters or fewer.");
  }
  const intent = input.intent === "chat" ? "chat" : "code";
  const requested = Array.isArray(input.variants)
    ? input.variants
    : [
        { strategy: "codex_only", contextEnabled: true },
        { strategy: "council_plan_codex_execute", contextEnabled: true },
      ];
  if (requested.length < 2 || requested.length > 4) {
    throw new Error("Choose between two and four replay variants.");
  }
  const variantDefaults = {
    tokenBudget: Math.max(256, Number(defaults.tokenBudget) || 4_000),
    graphify: defaults.graphify !== false,
  };
  const variants = requested.map((variant, index) =>
    normalizedVariant(variant, index, variantDefaults, intent),
  );
  const signatures = new Set(
    variants.map(
      (variant) =>
        `${variant.strategy}:${variant.models.codex ?? ""}:${variant.models.claude ?? ""}:${variant.reasoning.codex ?? ""}:${variant.reasoning.claude ?? ""}:${variant.contextPolicy.enabled}:${variant.contextPolicy.tokenBudget}:${variant.contextPolicy.graphify}`,
    ),
  );
  if (signatures.size !== variants.length) {
    throw new Error(
      "Replay variants must differ by strategy, model, intelligence, or context policy.",
    );
  }
  return {
    id: randomUUID(),
    prompt,
    intent,
    createdAt: new Date().toISOString(),
    variants,
  };
}

export function replayMetadata(plan, variant, index, repository) {
  return {
    id: plan.id,
    label: variant.label,
    variantIndex: index,
    totalVariants: plan.variants.length,
    baseSha: repository.sha,
    baseFingerprint: repository.fingerprint,
    intent: plan.intent,
    startedAt: plan.createdAt,
  };
}

function elapsedMs(job) {
  const recorded = Number(job.usage?.totals?.durationMs ?? 0);
  if (recorded > 0) return recorded;
  const start = Date.parse(job.createdAt ?? "");
  const end = Date.parse(job.updatedAt ?? "");
  return Number.isFinite(start) && Number.isFinite(end)
    ? Math.max(0, end - start)
    : 0;
}

export function summarizeReplayJobs(jobs) {
  const replayJobs = jobs.filter((job) => job?.replay?.id);
  const groups = new Map();
  for (const job of replayJobs) {
    let group = groups.get(job.replay.id);
    if (!group) {
      group = {
        id: job.replay.id,
        prompt: job.prompt,
        repository: job.repository,
        repositoryName: job.repositoryName,
        intent: job.replay.intent ?? job.kind ?? "code",
        baseSha: job.replay.baseSha ?? job.baseSha ?? null,
        createdAt: job.replay.startedAt ?? job.createdAt,
        variants: [],
      };
      groups.set(job.replay.id, group);
    }
    group.variants.push({
      taskId: job.id,
      label: job.replay.label,
      variantIndex: job.replay.variantIndex,
      strategy: job.decision?.strategy ?? null,
      contextEnabled: job.contextPolicy?.enabled !== false,
      status: job.status,
      stage: job.stage,
      finished: FINISHED_STATUSES.has(job.status),
      successful: ["accepted", "awaiting_review", "completed"].includes(job.status),
      calls: Number(job.usage?.totals?.calls ?? 0),
      totalTokens: Number(job.usage?.totals?.totalTokens ?? 0),
      contextTokens: Number(job.usage?.totals?.contextTokens ?? 0),
      durationMs: elapsedMs(job),
      costUsd: Number(job.usage?.totals?.costUsd ?? 0),
      changedFiles: job.review?.files?.length ?? 0,
      patchStat: job.review?.stat ?? null,
      checks: job.review?.checks ?? null,
      error: job.error ?? null,
    });
  }
  return [...groups.values()]
    .map((group) => {
      group.variants.sort(
        (left, right) => left.variantIndex - right.variantIndex,
      );
      return {
        ...group,
        finished: group.variants.every((variant) => variant.finished),
      };
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
