/* eslint-disable @next/next/no-img-element -- Vinext serves these bundled logos directly; Next image optimization is unavailable in this runtime. */
"use client";

import {
  Component,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ErrorInfo,
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { diffRows, diffRowText } from "./council-diff-rows";
import { CopyPathButton } from "./copy-path-button";
import { localRequest } from "./local-request";
import {
  COUNCIL_UI_STATE_KEY,
  createCouncilUiState,
  parseCouncilUiState,
  repositoryUiState,
  toggleExpandedFolder,
  updateRepositoryUiState,
  type TaskCenterView,
  type TaskListFilter,
} from "./council-ui-state";

type Strategy = "codex_only" | "claude_only" | "council_plan_codex_execute";
type AgentSettings = { model: string; reasoning: string };
type ModelOption = {
  model: string;
  label: string;
  description: string;
  reasoning: string[];
};
type Settings = {
  routingMode: "manual" | "auto";
  strategy: Strategy;
  autoBuildContext: boolean;
  codex: AgentSettings;
  claude: AgentSettings;
  context: AgentSettings & {
    provider: "claude" | "codex";
    tokenBudget: number;
    enabledByDefault: boolean;
    graphify: boolean;
  };
};
type SettingsOptions = {
  codexModels: string[];
  codexReasoning: string[];
  claudeModels: string[];
  claudeReasoning: string[];
  codexCatalog: ModelOption[];
  claudeCatalog: ModelOption[];
  discoveredAt: string | null;
};
type Repository = {
  id: string;
  name: string;
  path: string;
  source?: "local" | "github";
  sourceUrl?: string | null;
  branch: string;
  sha: string;
  fingerprint?: string;
  dirty: boolean;
  remote?: string | null;
  upstream?: string | null;
  ahead?: number;
  behind?: number;
  changes?: { staged: number; modified: number; untracked: number };
  error?: string | null;
  trackedFiles: number;
  context: null | {
    status: "missing" | "fresh" | "stale";
    generatedAt: string | null;
    documents: number;
    model: string | null;
  };
};
type AgentProcess = {
  id: string;
  pid: number;
  agent: string;
  stage: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  outputTail: string;
  activity?: AgentActivity[];
};
type AgentActivity = {
  id: string;
  agent: "codex" | "claude";
  kind: "command" | "file" | "read" | "search" | "thinking";
  label: string;
  detail: string;
  output?: string;
  status: "running" | "complete" | "failed";
  exitCode?: number | null;
  startedAt: string;
  updatedAt: string;
  endedAt?: string | null;
};
type JobEvent = { stage: string; message: string; at: string };
type UsageTotals = {
  calls: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  contextTokens: number;
  durationMs: number;
  costUsd: number;
  reportedCalls: number;
};
type ConversationMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  at: string;
  kind?: string;
  agent?: "codex" | "claude";
};
type SkillOption = {
  provider: "codex" | "claude";
  name: string;
  invocation?: string;
  path: string;
  scope: "user" | "repo" | "system" | "admin" | "plugin";
  description: string;
  enabled: boolean;
  dependencies?: { tools?: Array<{ type: string; value: string }> } | null;
};
type SkillCatalog = {
  provider: "all";
  cwd: string;
  skills: SkillOption[];
  errors: Array<{ path: string; message: string }>;
  providers?: {
    codex: Omit<SkillCatalog, "provider" | "providers"> & {
      provider: "codex";
    };
    claude: Omit<SkillCatalog, "provider" | "providers"> & {
      provider: "claude";
    };
  };
};
type GitHubWorkspace = {
  repository: {
    nameWithOwner: string;
    url: string;
    description: string;
    defaultBranch: string;
  };
  issues: Array<{
    number: number;
    title: string;
    body: string;
    url: string;
    labels: string[];
    assignees: string[];
    updatedAt: string;
  }>;
  pullRequests: Array<{
    number: number;
    title: string;
    url: string;
    isDraft: boolean;
    headRefName: string;
    baseRefName: string;
    reviewDecision: string;
    checks: {
      total: number;
      pending: number;
      passing: number;
      failing: number;
      skipped: number;
    };
    updatedAt: string;
  }>;
  fetchedAt: string;
};
type TaskJob = {
  id: string;
  kind?: "chat" | "code";
  repository: string;
  repositoryName: string;
  baseSha?: string;
  baseFingerprint?: string;
  prompt: string;
  status: string;
  stage: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
  replay?: null | {
    id: string;
    label: string;
    variantIndex: number;
    totalVariants: number;
    baseSha: string;
    baseFingerprint: string;
    intent?: "chat" | "code";
    startedAt: string;
  };
  decision: {
    strategy: Strategy;
    label: string;
    reason: string;
    stages: string[];
  };
  agentConfig?: { codex: AgentSettings; claude: AgentSettings };
  processes: AgentProcess[];
  events: JobEvent[];
  conversation?: ConversationMessage[];
  clarification?: null | {
    status: "pending" | "answered" | "dismissed";
    question: string;
    stage: string;
    askedAt: string;
    answeredAt: string | null;
    dismissedAt?: string | null;
    answer: string | null;
  };
  cancelRequested: boolean;
  failedStage?: string | null;
  attempt?: number;
  attempts?: Array<{
    id: string;
    number: number;
    reason: string;
    startStage: string;
    status: string;
    stage: string;
    startedAt: string;
    updatedAt: string;
    endedAt: string | null;
  }>;
  skills?: {
    mode: "auto" | "explicit";
    selected: SkillOption[];
  };
  goal?: null | {
    enabled: boolean;
    provider: "codex" | "claude";
    objective: string;
    status:
      | "active"
      | "paused"
      | "blocked"
      | "usageLimited"
      | "budgetLimited"
      | "complete";
    tokenBudget: number;
    tokensUsed: number;
    timeUsedSeconds: number;
    autoContinue: boolean;
    maxContinuations: number;
    native?: boolean;
    createdAt: string | number;
    updatedAt: string | number;
  };
  agentSessions?: {
    codex?: {
      threadId: string;
      turnId?: string | null;
      stage: string;
      status: string;
      updatedAt: string;
    };
    claude?: {
      sessionId: string;
      stage: string;
      status: string;
      updatedAt: string;
    };
  };
  pausedStage?: string | null;
  approval: null | {
    id: string;
    status: string;
    stage: string;
    command: string | null;
    reason: string | null;
  };
  contextPack: null | {
    selectedPaths: string[];
    selectedEvidence?: Array<{
      path: string;
      graphScore: number;
      lexicalScore: number;
      priorityScore: number;
      graphQueries?: number[];
      chars?: number;
      estimatedTokens?: number;
      truncated?: boolean;
    }>;
    estimatedTokens: number;
    status: string;
    budgetTokens?: number;
    strategy?: string;
    graphify?: {
      status: string;
      estimatedTokens: number;
      error?: string;
      matchedPaths?: string[];
      matchedSymbols?: string[];
      nodeCount?: number;
      edgeCount?: number;
      cacheHit?: boolean;
      query?: string;
      queries?: string[];
      contextFilters?: string[];
      requestCount?: number;
      executedCalls?: number;
      durationMs?: number;
      escalated?: boolean;
      confidence?: RetrievalConfidence;
      operations?: Array<{
        operation: "query" | "path" | "explain" | "affected";
        input: string;
        status: string;
        durationMs: number;
        estimatedTokens: number;
        matchedPaths: string[];
        matchedSymbols: string[];
        cacheHit: boolean;
        followup: boolean;
        error?: string;
      }>;
    };
    retrieval?: {
      confidence?: RetrievalConfidence;
      graphifyRequests: number;
      graphifyCalls: number;
      graphifyDurationMs: number;
      graphifyCacheHit?: boolean;
      adaptiveFollowup: boolean;
      selectedDocuments: number;
      capsuleTokens: number;
    };
    manifest?: {
      schemaVersion: number;
      generatedAt: string;
      strategy: string;
    };
  };
  contextPolicy?: {
    enabled: boolean;
    tokenBudget: number;
    graphify: boolean;
  };
  usage?: {
    calls: Array<{
      id: string;
      agent: "codex" | "claude";
      stage: string;
      totalTokens: number;
      contextTokens: number;
      source: "reported" | "estimated";
    }>;
    totals?: UsageTotals;
    byAgent?: Partial<Record<"codex" | "claude", UsageTotals>>;
  };
  review: null | {
    stat: string;
    files: string[];
    diff: string;
    diffTruncated: boolean;
    checks: string;
  };
  reviewIteration: number;
  reviewHistory: Array<{ iteration: number; feedback: string; at: string }>;
  workspace?: null | {
    path: string;
    branch: string;
    baselineSha: string;
    cleanedAt?: string;
  };
  conflict?: null | {
    files: string[];
    detectedAt: string;
    detail: string;
    baseSha: string | null;
    currentSha: string | null;
    repositoryChanged: boolean;
  };
  git?: null | {
    commitSha: string;
    message: string;
    remote: string | null;
    destinationBranch: string;
    pushedAt: string | null;
    pullRequestUrl: string | null;
  };
  result: null | {
    proposal?: string;
    critique?: string;
    plan?: string;
    judgment?: string;
    execution?: string;
    chat?: string;
  };
  error: string | null;
};
type RetrievalConfidence = {
  score: number;
  level: "high" | "medium" | "low" | "disabled";
  threshold: number;
  shouldEscalate: boolean;
  reasons: string[];
};
type ContextJob = {
  id: string;
  repository: string;
  status: string;
  stage: string;
  provider: "claude" | "codex";
  model: string;
  effort: string;
  processes: AgentProcess[];
  events: JobEvent[];
  graphify?: { status: string; graphPath: string | null };
};
type UsageWindow = { remainingPercent: number };
type Status = {
  ready: boolean;
  tools: Record<
    string,
    {
      available: boolean;
      authenticated: boolean | null;
      loginCommand: string | null;
    }
  >;
  usage: {
    codex: { session: UsageWindow | null; weekly: UsageWindow | null };
    claude: { session: UsageWindow | null; weekly: UsageWindow | null };
  };
  editors: {
    available: boolean;
    preferred: null | { id: string; name: string };
  };
};
type DoctorCheck = {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  required: boolean;
  detail: string;
  version: string | null;
  fix: string | null;
};
type DoctorReport = {
  ready: boolean;
  generatedAt: string;
  summary: string;
  counts: { pass: number; warn: number; fail: number };
  checks: DoctorCheck[];
};
type ReplayVariantInput = {
  label: string;
  strategy: Strategy;
  contextEnabled: boolean;
  codexModel?: string;
  claudeModel?: string;
  codexReasoning?: string;
  claudeReasoning?: string;
};
type RepositoryFile = {
  path: string;
  name: string;
  content: string;
  language: string;
  size: number;
  lines: number;
};
type GitPreview = {
  repository: Repository;
  git: TaskJob["git"];
  defaultCommitMessage: string;
};
type CommandPaletteItem = {
  id: string;
  label: string;
  detail: string;
  keywords: string;
  command:
    | "new-task"
    | "run-tests"
    | "open-editor"
    | "open-view"
    | "open-diff"
    | "switch-repository"
    | "open-task"
    | "open-file";
  value?: string;
};
type TreeNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children: TreeNode[];
};
type EditorTab =
  | { id: string; kind: "file"; title: string; file: RepositoryFile }
  | { id: string; kind: "diff"; title: string; taskId: string; iteration: number }
  | { id: string; kind: "task"; title: string; taskId: string }
  | {
      id: string;
      kind: "replay";
      title: string;
      replayId: string;
      taskId: string;
    };
const FALLBACK_SETTINGS: Settings = {
  routingMode: "manual",
  strategy: "codex_only",
  autoBuildContext: true,
  codex: { model: "gpt-5.6-sol", reasoning: "high" },
  claude: { model: "claude-opus-4-8", reasoning: "high" },
  context: {
    provider: "claude",
    model: "claude-opus-4-8",
    reasoning: "high",
    tokenBudget: 4_000,
    enabledByDefault: true,
    graphify: true,
  },
};

const FALLBACK_OPTIONS: SettingsOptions = {
  codexModels: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5"],
  codexReasoning: ["low", "medium", "high", "xhigh", "max", "ultra"],
  claudeModels: [
    "claude-opus-4-8",
    "opus",
    "sonnet",
    "haiku",
    "best",
    "opusplan",
    "opus[1m]",
    "sonnet[1m]",
    "default",
  ],
  claudeReasoning: ["low", "medium", "high", "xhigh", "max"],
  codexCatalog: [],
  claudeCatalog: [],
  discoveredAt: null,
};

class WorkspaceErrorBoundary extends Component<
  {
    boundaryKey: string;
    children: ReactNode;
    label: string;
  },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.label} crashed`, error, info.componentStack);
  }

  componentDidUpdate(previous: Readonly<{ boundaryKey: string }>) {
    if (
      this.state.error &&
      previous.boundaryKey !== this.props.boundaryKey
    ) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="ide-boundary-error" role="alert">
        <strong>{this.props.label} needs to recover</strong>
        <p>{this.state.error.message || "An unexpected UI error occurred."}</p>
        <button onClick={() => this.setState({ error: null })} type="button">
          Try again
        </button>
      </section>
    );
  }
}

function shortTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function elapsed(start: string, end: string | null, now: number) {
  const seconds = Math.max(
    0,
    Math.floor(
      ((end ? new Date(end).getTime() : now) - new Date(start).getTime()) / 1000,
    ),
  );
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function compactTokens(value = 0) {
  if (value < 1_000) return `${value}`;
  if (value < 1_000_000) {
    return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`;
  }
  return `${(value / 1_000_000).toFixed(1)}m`;
}

function compactDuration(milliseconds = 0) {
  if (milliseconds < 1_000) return `${milliseconds}ms`;
  const seconds = Math.round(milliseconds / 1_000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function taskWindowTitle(task: TaskJob, repositoryTasks: TaskJob[]) {
  if (task.replay) {
    const subject = task.prompt
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[.!?]+$/, "");
    const summary =
      subject.length > 22 ? `${subject.slice(0, 21).trimEnd()}…` : subject;
    return `C${String(task.replay.variantIndex + 1).padStart(2, "0")} · ${
      summary || "Untitled"
    }`;
  }
  const ordered = [...repositoryTasks].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
  const number = Math.max(1, ordered.findIndex((job) => job.id === task.id) + 1);
  const prefix =
    task.kind === "chat"
      ? "Q"
      : task.decision.strategy === "council_plan_codex_execute"
        ? "C"
        : "T";
  const subject = task.prompt
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/, "");
  const summary =
    subject.length > 22 ? `${subject.slice(0, 21).trimEnd()}…` : subject;
  return `${prefix}${String(number).padStart(2, "0")} · ${summary || "Untitled"}`;
}

function replayWindowTitle(task: TaskJob, repositoryTasks: TaskJob[]) {
  const ordered = [...repositoryTasks].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
  const topLevelKeys = [
    ...new Set(
      ordered.map((job) =>
        job.replay ? `replay:${job.replay.id}` : `task:${job.id}`,
      ),
    ),
  ];
  const key = task.replay ? `replay:${task.replay.id}` : `task:${task.id}`;
  const number = Math.max(1, topLevelKeys.indexOf(key) + 1);
  const subject = task.prompt
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/, "");
  const summary =
    subject.length > 22 ? `${subject.slice(0, 21).trimEnd()}…` : subject;
  return `T${String(number).padStart(2, "0")} · ${summary || "Untitled"}`;
}

function taskAgentSettings(
  task: TaskJob,
  agent: "codex" | "claude",
): AgentSettings {
  return task.agentConfig?.[agent] ?? FALLBACK_SETTINGS[agent];
}

function patchCounts(review: TaskJob["review"]) {
  if (!review) return { additions: 0, deletions: 0 };
  if (review.diff) {
    let additions = 0;
    let deletions = 0;
    for (const line of review.diff.split(/\r?\n/)) {
      if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
      if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
    }
    return { additions, deletions };
  }
  const additions = Number(
    review.stat.match(/(\d+) insertion(?:s)?\(\+\)/)?.[1] ?? 0,
  );
  const deletions = Number(
    review.stat.match(/(\d+) deletion(?:s)?\(-\)/)?.[1] ?? 0,
  );
  return { additions, deletions };
}

function jobLabel(job: TaskJob) {
  if (job.status === "awaiting_review") return "Review";
  if (job.status === "awaiting_approval") return "Approval";
  if (job.status === "awaiting_input") return "Needs reply";
  if (job.status === "conflict") return "Patch conflict";
  if (job.status === "completed") return "Answered";
  if (job.cancelRequested) return "Stopping";
  return job.status.replaceAll("_", " ");
}

function taskIsActive(job: TaskJob) {
  return (
    ["queued", "running", "awaiting_approval"].includes(job.status) ||
    job.stage === "accepting"
  );
}

function strategyLabel(strategy: Strategy) {
  if (strategy === "claude_only") return "Claude";
  if (strategy === "council_plan_codex_execute") return "code-council";
  return "Codex";
}

function strategyDetails(settings: Settings) {
  if (settings.routingMode === "auto") return "Auto routing";
  if (settings.strategy === "claude_only") {
    return `${settings.claude.model} · ${settings.claude.reasoning}`;
  }
  if (settings.strategy === "council_plan_codex_execute") {
    return `${settings.claude.model} → ${settings.codex.model}`;
  }
  return `${settings.codex.model} · ${settings.codex.reasoning}`;
}

function modelEntries(
  catalog: ModelOption[],
  fallback: string[],
  current: string,
) {
  const entries = catalog.length
    ? catalog
    : fallback.map((model) => ({
        model,
        label: model,
        description: "",
        reasoning: [],
      }));
  return entries.some((entry) => entry.model === current)
    ? entries
    : [{ model: current, label: current, description: "", reasoning: [] }, ...entries];
}

function reasoningEntries(
  catalog: ModelOption[],
  model: string,
  fallback: string[],
) {
  const entry = catalog.find((candidate) => candidate.model === model);
  return entry?.reasoning.length ? entry.reasoning : fallback;
}

function compatibleReasoning(
  catalog: ModelOption[],
  model: string,
  current: string,
  fallback: string[],
) {
  const supported = reasoningEntries(catalog, model, fallback);
  if (supported.includes(current)) return current;
  return supported.includes("high") ? "high" : supported[0] ?? current;
}

function buildTree(files: string[]) {
  const root: TreeNode = { name: "", path: "", type: "directory", children: [] };
  for (const file of files) {
    let parent = root;
    const parts = file.split("/");
    parts.forEach((part, index) => {
      const childPath = parts.slice(0, index + 1).join("/");
      let child = parent.children.find((entry) => entry.name === part);
      if (!child) {
        child = {
          name: part,
          path: childPath,
          type: index === parts.length - 1 ? "file" : "directory",
          children: [],
        };
        parent.children.push(child);
      }
      parent = child;
    });
  }
  const sort = (node: TreeNode) => {
    node.children.sort((left, right) => {
      if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
      return left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
    node.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

function fileGlyph(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  if (["ts", "tsx"].includes(extension ?? "")) return "TS";
  if (["js", "jsx", "mjs"].includes(extension ?? "")) return "JS";
  if (extension === "css") return "#";
  if (extension === "json") return "{}";
  if (extension === "md") return "M";
  if (extension === "py") return "PY";
  return "·";
}

function TreeRows({
  nodes,
  depth,
  expanded,
  changedFiles,
  filter,
  onToggle,
  onOpen,
}: {
  nodes: TreeNode[];
  depth: number;
  expanded: Set<string>;
  changedFiles: Set<string>;
  filter: string;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
}) {
  const visible = (node: TreeNode): boolean =>
    !filter ||
    node.path.toLowerCase().includes(filter) ||
    node.children.some(visible);

  return (
    <>
      {nodes.filter(visible).map((node) => {
        const isOpen = expanded.has(node.path) || Boolean(filter);
        return (
          <Fragment key={node.path}>
            <button
              className={`ide-tree-row ${node.type}${changedFiles.has(node.path) ? " changed" : ""}`}
              onClick={() =>
                node.type === "directory" ? onToggle(node.path) : onOpen(node.path)
              }
              style={{ paddingLeft: 10 + depth * 14 }}
              title={node.path}
              type="button"
            >
              <span className="ide-tree-chevron">
                {node.type === "directory" ? (isOpen ? "⌄" : "›") : ""}
              </span>
              <span className={`ide-file-glyph ${node.type}`}>
                {node.type === "directory" ? "□" : fileGlyph(node.path)}
              </span>
              <span>{node.name}</span>
              {changedFiles.has(node.path) ? <i>M</i> : null}
            </button>
            {node.type === "directory" && isOpen ? (
              <TreeRows
                changedFiles={changedFiles}
                depth={depth + 1}
                expanded={expanded}
                filter={filter}
                nodes={node.children}
                onOpen={onOpen}
                onToggle={onToggle}
              />
            ) : null}
          </Fragment>
        );
      })}
    </>
  );
}

const CODE_TOKEN =
  /(\/\/.*$|\/\*.*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|let|var|function|return|export|import|from|async|await|if|else|for|while|type|interface|class|new|throw|try|catch|true|false|null|undefined)\b|\b\d+(?:\.\d+)?\b)/gm;

function highlightedCode(value: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of value.matchAll(CODE_TOKEN)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push(value.slice(cursor, index));
    const token = match[0];
    const kind = token.startsWith("//") || token.startsWith("/*")
      ? "comment"
      : /^["'`]/.test(token)
        ? "string"
        : /^\d/.test(token)
          ? "number"
          : "keyword";
    parts.push(
      <span className={`token-${kind}`} key={`${index}-${token}`}>
        {token}
      </span>,
    );
    cursor = index + token.length;
  }
  if (cursor < value.length) parts.push(value.slice(cursor));
  return parts;
}

function CodeEditor({ file }: { file: RepositoryFile }) {
  return (
    <section className="ide-code-view" aria-label={`${file.path} source`}>
      <header>
        <span className="ide-file-glyph">{fileGlyph(file.path)}</span>
        <code>{file.path}</code>
        <small>
          {file.lines} lines · read only
        </small>
      </header>
      <div className="ide-code-scroll">
        {file.content.split(/\r?\n/).map((line, index) => (
          <div className="ide-code-line" key={index}>
            <span>{index + 1}</span>
            <code>{highlightedCode(line || " ")}</code>
          </div>
        ))}
      </div>
    </section>
  );
}

function DiffEditor({
  task,
  onComment,
}: {
  task: TaskJob;
  onComment: (feedback: string) => void;
}) {
  const review = task.review;
  const [fileQuery, setFileQuery] = useState("");
  const [selectedFile, setSelectedFile] = useState(review?.files[0] ?? "");
  const [viewMode, setViewMode] = useState<"unified" | "side-by-side">("unified");
  const [hideWhitespace, setHideWhitespace] = useState(false);
  const [changeIndex, setChangeIndex] = useState(-1);
  const [commentTarget, setCommentTarget] = useState<{
    file: string;
    line: number | "file";
  } | null>(null);
  const [commentText, setCommentText] = useState("");
  const rowElements = useRef(new Map<number, HTMLDivElement>());
  if (!review) return <div className="ide-editor-empty">No patch is available.</div>;
  const reviewFiles = review.files;
  const allRows = diffRows(review.diff);
  const visibleFiles = reviewFiles.filter((file) =>
    file.toLowerCase().includes(fileQuery.toLowerCase()),
  );
  const activeFile = reviewFiles.includes(selectedFile)
    ? selectedFile
    : reviewFiles[0] ?? "";
  const rows = allRows.filter(
    (row) =>
      (!activeFile || row.file === activeFile) &&
      (!hideWhitespace ||
        !(["add", "remove"].includes(row.kind) && row.line.slice(1).trim() === "")),
  );
  const changes = rows.filter((row) =>
    ["add", "remove", "hunk"].includes(row.kind),
  );

  function moveToFile(direction: -1 | 1) {
    if (!reviewFiles.length) return;
    const current = Math.max(0, reviewFiles.indexOf(activeFile));
    const next = (current + direction + reviewFiles.length) % reviewFiles.length;
    setSelectedFile(reviewFiles[next]);
    setChangeIndex(-1);
  }

  function moveToChange(direction: -1 | 1) {
    if (!changes.length) return;
    const next = (changeIndex + direction + changes.length) % changes.length;
    setChangeIndex(next);
    rowElements.current.get(changes[next].index)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }

  function beginComment(file: string, line: number | "file") {
    setCommentTarget({ file, line });
    setCommentText("");
  }

  function submitComment() {
    if (!commentTarget || !commentText.trim()) return;
    const location =
      commentTarget.line === "file"
        ? commentTarget.file
        : `${commentTarget.file}:${commentTarget.line}`;
    onComment(`Review comment on ${location}: ${commentText.trim()}`);
    setCommentTarget(null);
    setCommentText("");
  }

  return (
    <section className="ide-diff-view">
      <header>
        <div>
          <strong>{review.stat}</strong>
          <span>Iteration {task.reviewIteration} · {review.checks}</span>
        </div>
        {review.diffTruncated ? (
          <span className="ide-diff-truncated">
            Showing the first 250,000 characters
          </span>
        ) : null}
      </header>
      <div className="ide-diff-toolbar">
        <label>
          <span>⌕</span>
          <input
            aria-label="Search changed files"
            onChange={(event) => setFileQuery(event.target.value)}
            placeholder="Changed files"
            value={fileQuery}
          />
        </label>
        <button onClick={() => moveToFile(-1)} title="Previous file" type="button">← File</button>
        <button onClick={() => moveToFile(1)} title="Next file" type="button">File →</button>
        <button onClick={() => moveToChange(-1)} title="Previous change" type="button">↑ Change</button>
        <button onClick={() => moveToChange(1)} title="Next change" type="button">↓ Change</button>
        <button
          aria-pressed={hideWhitespace}
          className={hideWhitespace ? "active" : ""}
          onClick={() => setHideWhitespace((current) => !current)}
          type="button"
        >
          Whitespace
        </button>
        <div className="ide-diff-view-toggle">
          <button
            aria-pressed={viewMode === "unified"}
            className={viewMode === "unified" ? "active" : ""}
            onClick={() => setViewMode("unified")}
            type="button"
          >
            Unified
          </button>
          <button
            aria-pressed={viewMode === "side-by-side"}
            className={viewMode === "side-by-side" ? "active" : ""}
            onClick={() => setViewMode("side-by-side")}
            type="button"
          >
            Split
          </button>
        </div>
      </div>
      <nav className="ide-diff-files" aria-label="Changed files">
        {visibleFiles.map((file) => (
          <button
            className={file === activeFile ? "active" : ""}
            key={file}
            onClick={() => {
              setSelectedFile(file);
              setChangeIndex(-1);
            }}
            type="button"
          >
            <span>{fileGlyph(file)}</span>
            {file}
          </button>
        ))}
      </nav>
      <details className="ide-diff-verification" open={/fail|error/i.test(review.checks)}>
        <summary>Verification <span>{review.checks}</span></summary>
        <pre>{review.checks || "No verification output was recorded."}</pre>
      </details>
      <div className="ide-diff-scroll">
        {!review.diff && review.files.length ? (
          <div className="ide-diff-loading">Loading change details…</div>
        ) : (
          rows.map((row) => {
            const line = row.newLine || row.oldLine || "file";
            const content = diffRowText(row) || " ";
            return (
              <div
                className={`ide-diff-line ${row.kind} ${viewMode}`}
                key={row.index}
                ref={(element) => {
                  if (element) rowElements.current.set(row.index, element);
                  else rowElements.current.delete(row.index);
                }}
              >
                {viewMode === "side-by-side" ? (
                  <>
                    <span>{row.oldLine}</span>
                    <code className={row.kind === "add" ? "blank" : ""}>
                      {row.kind === "add" ? " " : highlightedCode(content)}
                    </code>
                    <span>{row.newLine}</span>
                    <code className={row.kind === "remove" ? "blank" : ""}>
                      {row.kind === "remove" ? " " : highlightedCode(content)}
                    </code>
                  </>
                ) : (
                  <>
                    <span>{row.oldLine}</span>
                    <span>{row.newLine}</span>
                    <code>{highlightedCode(content)}</code>
                  </>
                )}
                {(row.kind === "file" || row.kind === "add" || row.kind === "remove") ? (
                  <button
                    aria-label={`Comment on ${row.file}${line === "file" ? "" : ` line ${line}`}`}
                    className="ide-diff-comment"
                    onClick={() => beginComment(row.file, line)}
                    title="Add review comment"
                    type="button"
                  >
                    +
                  </button>
                ) : null}
              </div>
            );
          })
        )}
      </div>
      {commentTarget ? (
        <div className="ide-inline-comment">
          <strong>
            Comment on {commentTarget.file}
            {commentTarget.line === "file" ? "" : `:${commentTarget.line}`}
          </strong>
          <textarea
            autoFocus
            onChange={(event) => setCommentText(event.target.value)}
            placeholder="Describe the requested change"
            rows={3}
            value={commentText}
          />
          <div>
            <button onClick={() => setCommentTarget(null)} type="button">Cancel</button>
            <button disabled={!commentText.trim()} onClick={submitComment} type="button">
              Add to change request
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function MessageContent({ content }: { content: string }) {
  const sections = content.split(/(```[\s\S]*?```)/g);
  return (
    <>
      {sections.map((section, index) =>
        section.startsWith("```") ? (
          <pre key={index}>
            <code>{section.replace(/^```[^\n]*\n?/, "").replace(/```$/, "")}</code>
          </pre>
        ) : (
          <p key={index}>{section}</p>
        ),
      )}
    </>
  );
}

function AgentActivityFeed({
  task,
  compact = false,
}: {
  task: TaskJob;
  compact?: boolean;
}) {
  const entries = task.processes
    .flatMap((process) =>
      (process.activity ?? []).map((activity) => ({
        ...activity,
        processId: process.id,
        pid: process.pid,
        stage: process.stage,
      })),
    )
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  const visible = compact ? entries.slice(-5) : entries;
  const active = ["queued", "running", "awaiting_approval"].includes(task.status);
  if (!visible.length && !active) return null;

  return (
    <section className={`ide-agent-trace ${compact ? "compact" : ""}`}>
      <header>
        <div>
          {active ? <span className="ide-live-dot" /> : <span>✓</span>}
          <strong>{compact ? "Live agent steps" : "Agent monitor"}</strong>
        </div>
        <small>{entries.length ? `${entries.length} actions` : "Starting…"}</small>
      </header>
      {visible.length ? (
        <ol>
          {visible.map((entry) => (
            <li className={entry.status} key={`${entry.processId}:${entry.id}`}>
              <i>
                {entry.kind === "command"
                  ? "›_"
                  : entry.kind === "file"
                    ? "±"
                    : entry.kind === "read"
                      ? "≡"
                      : entry.kind === "search"
                        ? "⌕"
                        : "◌"}
              </i>
              <div>
                <strong>{entry.label}</strong>
                {compact && entry.detail ? <code>{entry.detail}</code> : null}
                {!compact ? (
                  <details>
                    <summary>
                      {entry.kind === "command" ? "Command details" : "Operation details"}
                    </summary>
                    {entry.detail ? <code>{entry.detail}</code> : null}
                    {entry.output ? <pre>{entry.output}</pre> : <p>No output was recorded.</p>}
                  </details>
                ) : null}
                <small>
                  {entry.agent === "claude" ? "Claude" : "Codex"} · {entry.stage}
                  {entry.kind === "command" && entry.exitCode != null
                    ? ` · exit ${entry.exitCode}`
                    : ""}
                </small>
                {!compact && entry.kind === "command" && entry.detail ? (
                  <CopyPathButton label="Copy command" path={entry.detail} />
                ) : null}
              </div>
              <span className={`ide-trace-state ${entry.status}`}>
                {entry.status === "running"
                  ? "running"
                  : entry.status === "failed"
                    ? "failed"
                    : "done"}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p>Waiting for the agent’s first file, search, or command action.</p>
      )}
    </section>
  );
}

function TaskProgress({ task, now }: { task: TaskJob; now: number }) {
  const active = ["queued", "running", "awaiting_approval"].includes(task.status);
  const latestProcess = task.processes.at(-1);
  const latestEvent = (stage: string) => {
    const matchingStages =
      stage === "review"
        ? ["awaiting_review", "accepting", "accepted", "conflict", "rejected"]
        : [stage];
    return [...task.events]
      .reverse()
      .find((event) => matchingStages.includes(event.stage));
  };

  return (
    <section className="ide-task-progress" aria-label="Coding task progress">
      <header>
        <div>
          <span className={active ? "ide-live-dot" : "ide-progress-mark"} />
          <strong>{active ? "Agent is working" : "Task workflow"}</strong>
        </div>
        <small>Attempt {task.attempt ?? 1}</small>
      </header>
      <ol>
        {task.decision.stages.map((stage, index) => {
          const event = latestEvent(stage);
          const isCurrent =
            task.stage === stage ||
            (stage === "review" &&
              ["awaiting_review", "accepting", "conflict"].includes(task.stage));
          const isFailed =
            task.failedStage === stage ||
            (stage === "review" && task.status === "conflict");
          const isDone =
            Boolean(event) &&
            !isCurrent &&
            !isFailed &&
            !["failed", "conflict"].includes(event?.stage ?? "");
          return (
            <li
              className={
                isFailed ? "failed" : isCurrent ? "active" : isDone ? "done" : ""
              }
              key={`${stage}-${index}`}
            >
              <i>{isDone ? "✓" : isFailed ? "!" : index + 1}</i>
              <div>
                <strong>{stage.replaceAll("_", " ")}</strong>
                <p>{event?.message ?? "Waiting for the previous step"}</p>
              </div>
              {isCurrent && latestProcess ? (
                <time>
                  {elapsed(
                    latestProcess.startedAt,
                    latestProcess.endedAt,
                    now,
                  )}
                </time>
              ) : null}
            </li>
          );
        })}
      </ol>
      <AgentActivityFeed compact task={task} />
    </section>
  );
}

function TaskConversation({
  task,
  onReview,
  now,
}: {
  task: TaskJob;
  onReview: () => void;
  now: number;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const messages =
    task.conversation?.length
      ? task.conversation
      : [
          {
            id: `${task.id}:prompt`,
            role: "user" as const,
            content: task.prompt,
            at: task.createdAt,
            kind: "request",
          },
        ];
  const active = ["queued", "running", "awaiting_approval"].includes(task.status);
  const latestProcess = task.processes.at(-1);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, task.status, task.stage]);

  return (
    <section className="ide-conversation" aria-label="Task conversation">
      <header className="ide-conversation-header">
        <div>
          <span className={`ide-status ${task.status}`}>{jobLabel(task)}</span>
          <strong>{task.kind === "chat" ? "Repository chat" : task.decision.label}</strong>
        </div>
        <small>
          {strategyLabel(task.decision.strategy)} ·{" "}
          {task.decision.strategy === "claude_only"
            ? taskAgentSettings(task, "claude").model
            : taskAgentSettings(task, "codex").model}
        </small>
      </header>
      <div className="ide-message-list">
        {messages.map((message, index) => (
          <Fragment key={message.id}>
            <article
              className={`ide-message ${message.role} ${message.kind ?? ""}`}
            >
              {message.role === "assistant" ? (
                <span className={`ide-agent-avatar ${message.agent ?? "codex"}`}>
                  {message.agent === "claude" ? "A" : "C"}
                </span>
              ) : null}
              <div>
                <MessageContent content={message.content} />
                <footer>
                  {message.role === "assistant"
                    ? message.agent === "claude"
                      ? "Claude"
                      : "Codex"
                    : "You"}
                  <span>·</span>
                  {shortTime(message.at)}
                </footer>
              </div>
            </article>
            {index === 0 && task.kind !== "chat" ? (
              <TaskProgress now={now} task={task} />
            ) : null}
          </Fragment>
        ))}
        {active && task.kind === "chat" ? (
          <div className="ide-conversation-running">
            <span className="ide-live-dot" />
            <div>
              <strong>{task.stage.replaceAll("_", " ")}</strong>
              <p>{task.events.at(-1)?.message ?? "Starting…"}</p>
            </div>
            {latestProcess ? (
              <time>
                {elapsed(
                  latestProcess.startedAt,
                  latestProcess.endedAt,
                  now,
                )}
              </time>
            ) : null}
          </div>
        ) : null}
        {task.review ? (
          <button className="ide-review-card" onClick={onReview} type="button">
            <span>±</span>
            <div>
              <strong>Changes ready for review</strong>
              <small>{task.review.stat}</small>
            </div>
            <b>{task.review.files.length} files →</b>
          </button>
        ) : null}
        {task.error ? <div className="ide-task-error">{task.error}</div> : null}
        <div ref={endRef} />
      </div>
    </section>
  );
}

function WorkflowRuntime({
  process,
  now,
}: {
  process: AgentProcess;
  now: number;
}) {
  return (
    <small className="ide-workflow-runtime">
      {process.agent === "claude"
        ? "Claude"
        : process.agent === "graphify"
          ? "Graphify"
          : "Codex"}{" "}
      · PID {process.pid} · {elapsed(process.startedAt, process.endedAt, now)} ·{" "}
      {process.status}
    </small>
  );
}

function TaskEnvironment({
  repository,
  task,
  onReview,
  onOpenRepository,
  onGitAction,
  ghAvailable,
}: {
  repository: Repository;
  task: TaskJob;
  onReview: () => void;
  onOpenRepository: () => void;
  onGitAction: (action: "commit" | "push" | "draft-pr") => void;
  ghAvailable: boolean;
}) {
  const changes = patchCounts(task.review);
  const running = task.processes.filter((process) => process.status === "running");
  const repositoryChanged =
    Boolean(task.baseFingerprint) &&
    Boolean(repository.fingerprint) &&
    task.baseFingerprint !== repository.fingerprint;

  return (
    <section className="ide-task-panel ide-environment-panel" aria-label="Task environment">
      <header className="ide-task-panel-header">
        <div>
          <span>Environment</span>
          <strong>{repository.name}</strong>
          <p>Everything this task can change, and where those changes will land.</p>
        </div>
        <span className={`ide-job-dot ${task.status}`} />
      </header>
      <div className="ide-environment-grid">
        <button
          className="ide-environment-card changes"
          disabled={!task.review}
          onClick={onReview}
          type="button"
        >
          <span className="ide-environment-icon">±</span>
          <span className="ide-environment-copy">
            <strong>Changes</strong>
            <small>
              {task.review
                ? `${task.review.files.length} files · Open diff`
                : "No diff available yet"}
            </small>
          </span>
          <b>
            <em>+{changes.additions.toLocaleString()}</em>{" "}
            <del>-{changes.deletions.toLocaleString()}</del>
          </b>
        </button>
        <article className="ide-environment-card">
          <span className="ide-environment-icon">▱</span>
          <span className="ide-environment-copy">
            <strong>{repository.source === "github" ? "GitHub clone" : "Local folder"}</strong>
            <small>
              {repository.sourceUrl ?? repository.path}
            </small>
          </span>
          <b>{repository.source === "github" ? "GitHub" : "Local"}</b>
        </article>
        <article className="ide-environment-card">
          <span className="ide-environment-icon">⑂</span>
          <span className="ide-environment-copy">
            <strong>Branch</strong>
            <strong>{repository.branch}</strong>
            <small>
              Base {task.baseSha?.slice(0, 7) ?? "unknown"} · HEAD {repository.sha.slice(0, 7)}
            </small>
          </span>
          <b>
            ↑{repository.ahead ?? 0} ↓{repository.behind ?? 0}
          </b>
        </article>
        <article className="ide-environment-card git-actions">
          <span className="ide-environment-icon">⇧</span>
          <span className="ide-environment-copy">
            <strong>
              {task.status === "conflict"
                ? "Resolve conflict first"
                : task.git?.pushedAt
                  ? "Commit pushed"
                  : task.git?.commitSha
                    ? "Commit ready to push"
                    : task.status === "accepted"
                      ? "Accepted patch ready to commit"
                  : "Commit or push"}
            </strong>
            <small>
              {task.git?.commitSha
                ? `${task.git.commitSha.slice(0, 7)} · ${task.git.destinationBranch}`
                : "Only this task patch is staged; unrelated changes are never included."}
            </small>
          </span>
          <div className="ide-environment-actions">
            {!task.git?.commitSha ? (
              <button
                disabled={task.status !== "accepted"}
                onClick={() => onGitAction("commit")}
                type="button"
              >
                Create commit
              </button>
            ) : !task.git.pushedAt ? (
              <button onClick={() => onGitAction("push")} type="button">
                Review push
              </button>
            ) : ghAvailable && !task.git.pullRequestUrl ? (
              <button onClick={() => onGitAction("draft-pr")} type="button">
                Draft PR
              </button>
            ) : task.git.pullRequestUrl ? (
              <a href={task.git.pullRequestUrl} rel="noreferrer" target="_blank">
                Open PR
              </a>
            ) : null}
            <button
              disabled={task.status !== "accepted"}
              onClick={onOpenRepository}
              type="button"
            >
              Open editor
            </button>
          </div>
        </article>
      </div>
      <section className="ide-environment-section ide-git-facts">
        <header>
          <strong>Git state</strong>
          <small>{repository.dirty ? "Working tree modified" : "Working tree clean"}</small>
        </header>
        <dl>
          <div><dt>Remote</dt><dd>{repository.remote ?? "Not configured"}</dd></div>
          <div><dt>Upstream</dt><dd>{repository.upstream ?? "Not configured"}</dd></div>
          <div><dt>Task worktree</dt><dd>{task.workspace?.path ?? "Cleaned or not created"}</dd></div>
          <div>
            <dt>Working changes</dt>
            <dd>
              {repository.changes?.staged ?? 0} staged · {repository.changes?.modified ?? 0} modified · {repository.changes?.untracked ?? 0} untracked
            </dd>
          </div>
        </dl>
        {repositoryChanged ? (
          <p className="ide-git-warning">Repository content changed since this task started. Acceptance still uses a non-mutating patch preflight.</p>
        ) : null}
      </section>
      <section className="ide-environment-section">
        <header>
          <strong>Background processes</strong>
          <small>{running.length ? `${running.length} live` : `${task.processes.length} recorded`}</small>
        </header>
        <div className="ide-environment-processes">
          {(running.length ? running : task.processes.slice(-3)).map((process) => (
            <div key={process.id}>
              <span className={`ide-job-dot ${process.status}`} />
              <span>
                <strong>{process.agent === "claude" ? "Claude" : process.agent === "graphify" ? "Graphify" : "Codex"}</strong>
                <small>{process.stage} · PID {process.pid}</small>
              </span>
              <b>{process.status}</b>
            </div>
          ))}
          {!task.processes.length ? <p>No process has started for this task.</p> : null}
        </div>
      </section>
      <section className="ide-environment-section">
        <header>
          <strong>Task sources</strong>
          <small>
            {task.contextPolicy?.enabled === false
              ? "Context off"
              : `≈${(task.contextPack?.estimatedTokens ?? 0).toLocaleString()} tokens`}
          </small>
        </header>
        <div className="ide-environment-sources">
          {(task.contextPack?.selectedPaths ?? []).slice(0, 8).map((file) => (
            <span key={file}>{file}</span>
          ))}
          {task.contextPolicy?.enabled === false ? (
            <p>Agents inspected repository source directly for this task.</p>
          ) : !task.contextPack?.selectedPaths.length ? (
            <p>Task memory will appear after context selection.</p>
          ) : null}
        </div>
      </section>
    </section>
  );
}

function ChoiceMenu({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string; description?: string }>;
  onChange: (value: string) => void;
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <details className="ide-choice-menu">
      <summary>
        <span>{label}</span>
        <strong>{selected?.label ?? value}</strong>
        <i>⌄</i>
      </summary>
      <div role="listbox" aria-label={label}>
        {options.map((option) => (
          <button
            aria-selected={option.value === value}
            className={option.value === value ? "active" : ""}
            key={option.value}
            onClick={(event) => {
              onChange(option.value);
              event.currentTarget.closest("details")?.removeAttribute("open");
            }}
            role="option"
            type="button"
          >
            <span>
              <strong>{option.label}</strong>
              {option.description ? <small>{option.description}</small> : null}
            </span>
            {option.value === value ? <i>✓</i> : null}
          </button>
        ))}
      </div>
    </details>
  );
}

function AgentPicker({
  settings,
  options,
  onSave,
  onClose,
}: {
  settings: Settings;
  options: SettingsOptions;
  onSave: (settings: Settings) => void;
  onClose: () => void;
}) {
  const codexModels = modelEntries(
    options.codexCatalog,
    options.codexModels,
    settings.codex.model,
  );
  const claudeModels = modelEntries(
    options.claudeCatalog,
    options.claudeModels,
    settings.claude.model,
  );
  const showCodex =
    settings.strategy !== "claude_only" || settings.routingMode === "auto";
  const showClaude =
    settings.strategy !== "codex_only" || settings.routingMode === "auto";

  return (
    <div className="ide-agent-popover" role="dialog" aria-label="Choose agent mode">
      <header>
        <div>
          <strong>Run with</strong>
          <small>Choose an agent or the lean four-call council.</small>
        </div>
        <button aria-label="Close agent menu" onClick={onClose} type="button">
          ×
        </button>
      </header>
      <div className="ide-strategy-grid">
        {(
          [
            ["codex_only", "C", "Codex", "Direct execution"],
            ["claude_only", "A", "Claude", "Direct execution"],
            [
              "council_plan_codex_execute",
              "C+A",
              "code-council",
              "Plan, critique, revise, execute",
            ],
          ] as Array<[Strategy, string, string, string]>
        ).map(([value, mark, label, description]) => (
          <button
            className={
              settings.routingMode === "manual" && settings.strategy === value
                ? "active"
                : ""
            }
            key={value}
            onClick={() =>
              onSave({ ...settings, routingMode: "manual", strategy: value })
            }
            type="button"
          >
            <i>{mark}</i>
            <strong>{label}</strong>
            <small>{description}</small>
          </button>
        ))}
      </div>
      <label className="ide-auto-toggle">
        <span>
          <strong>Automatic routing</strong>
          <small>Codex for small work, code-council for larger or risky work.</small>
        </span>
        <input
          checked={settings.routingMode === "auto"}
          onChange={(event) =>
            onSave({
              ...settings,
              routingMode: event.target.checked ? "auto" : "manual",
            })
          }
          type="checkbox"
        />
      </label>
      <div className="ide-model-settings">
        {showCodex ? (
          <div>
            <span className="ide-agent-avatar codex">C</span>
            <ChoiceMenu
              label="Codex model"
              onChange={(model) => {
                  onSave({
                    ...settings,
                    codex: {
                      model,
                      reasoning: compatibleReasoning(
                        options.codexCatalog,
                        model,
                        settings.codex.reasoning,
                        options.codexReasoning,
                      ),
                    },
                  });
                }}
              options={codexModels.map((entry) => ({
                value: entry.model,
                label: entry.label,
                description: entry.description,
              }))}
              value={settings.codex.model}
            />
            <ChoiceMenu
              label="Reasoning"
              onChange={(reasoning) =>
                  onSave({
                    ...settings,
                    codex: { ...settings.codex, reasoning },
                  })
                }
              options={reasoningEntries(
                  options.codexCatalog,
                  settings.codex.model,
                  options.codexReasoning,
                ).map((reasoning) => ({ value: reasoning, label: reasoning }))}
              value={settings.codex.reasoning}
            />
          </div>
        ) : null}
        {showClaude ? (
          <div>
            <span className="ide-agent-avatar claude">A</span>
            <ChoiceMenu
              label="Claude model"
              onChange={(model) => {
                  onSave({
                    ...settings,
                    claude: {
                      model,
                      reasoning: compatibleReasoning(
                        options.claudeCatalog,
                        model,
                        settings.claude.reasoning,
                        options.claudeReasoning,
                      ),
                    },
                  });
                }}
              options={claudeModels.map((entry) => ({
                value: entry.model,
                label: entry.label,
                description: entry.description,
              }))}
              value={settings.claude.model}
            />
            <ChoiceMenu
              label="Reasoning"
              onChange={(reasoning) =>
                  onSave({
                    ...settings,
                    claude: { ...settings.claude, reasoning },
                  })
                }
              options={reasoningEntries(
                  options.claudeCatalog,
                  settings.claude.model,
                  options.claudeReasoning,
                ).map((reasoning) => ({ value: reasoning, label: reasoning }))}
              value={settings.claude.reasoning}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function GoalBar({
  task,
  busy,
  onClear,
  onEdit,
  onPause,
  onResume,
}: {
  task: TaskJob;
  busy: string;
  onClear: () => void;
  onEdit: () => void;
  onPause: () => void;
  onResume: () => void;
}) {
  const goal = task.goal;
  if (!goal) return null;
  const used = Math.max(0, Number(goal.tokensUsed ?? 0));
  const budget = Math.max(1, Number(goal.tokenBudget ?? 1));
  const progress = Math.min(100, Math.round((used / budget) * 100));
  const active = ["queued", "running", "awaiting_approval"].includes(task.status);
  return (
    <section className={`ide-goal-bar ${goal.status}`} aria-label="Durable goal">
      <div className="ide-goal-icon">◎</div>
      <div className="ide-goal-copy">
        <header>
          <strong>
            Goal · {goal.provider === "claude" ? "Claude" : "Codex"} ·{" "}
            {goal.status.replace(/([A-Z])/g, " $1")}
          </strong>
          <span>
            {compactTokens(used)} / {compactTokens(budget)} tokens
            {goal.timeUsedSeconds
              ? ` · ${compactDuration(goal.timeUsedSeconds * 1_000)}`
              : ""}
          </span>
        </header>
        <p>{goal.objective}</p>
        <div className="ide-goal-progress">
          <i style={{ width: `${progress}%` }} />
        </div>
      </div>
      <div className="ide-goal-actions">
        {active ? (
          <button disabled={Boolean(busy)} onClick={onPause} type="button">
            Pause
          </button>
        ) : task.status === "paused" ? (
          <button
            className="primary"
            disabled={Boolean(busy)}
            onClick={onResume}
            type="button"
          >
            Resume
          </button>
        ) : null}
        {!active ? (
          <button disabled={Boolean(busy)} onClick={onEdit} type="button">
            Edit
          </button>
        ) : null}
        {!active ? (
          <button disabled={Boolean(busy)} onClick={onClear} type="button">
            Clear
          </button>
        ) : null}
      </div>
    </section>
  );
}

function TaskMonitor({
  task,
  now,
  busy,
  onCancel,
  onEditRestart,
  onRetry,
}: {
  task: TaskJob;
  now: number;
  busy: string;
  onCancel: () => void;
  onEditRestart: () => void;
  onRetry: (stage?: string) => void;
}) {
  const active = ["queued", "running", "awaiting_approval"].includes(task.status);
  return (
    <section className="ide-task-panel ide-task-monitor" aria-label="Task monitor">
      <header className="ide-task-panel-header">
        <div>
          <span>Monitor</span>
          <strong>{active ? "Agent is working" : jobLabel(task)}</strong>
          <p>Commands, file operations, process health, and recoverable workflow stages.</p>
        </div>
        {active ? (
          <button
            disabled={task.cancelRequested || busy === "cancel"}
            onClick={onCancel}
            type="button"
          >
            {task.cancelRequested ? "Stopping…" : "Stop task"}
          </button>
        ) : null}
      </header>
      <div className="ide-task-panel-body">
        {task.error ? <div className="ide-task-error">{task.error}</div> : null}
        {["failed", "canceled", "conflict"].includes(task.status) ? (
          <div className="ide-retry-actions">
            {task.failedStage ? (
              <button
                disabled={busy.startsWith("retry:")}
                onClick={() => onRetry(task.failedStage ?? undefined)}
                type="button"
              >
                Retry {task.failedStage.replaceAll("_", " ")}
              </button>
            ) : null}
            <button
              disabled={busy.startsWith("retry:")}
              onClick={() => onRetry("prepare")}
              type="button"
            >
              Restart task
            </button>
            <button
              disabled={busy.startsWith("retry:")}
              onClick={onEditRestart}
              type="button"
            >
              Edit &amp; restart
            </button>
          </div>
        ) : null}
        <AgentActivityFeed task={task} />
        <details className="ide-run-details ide-workflow-history" open={!task.processes.some((process) => process.activity?.length)}>
          <summary>
            Workflow history
            <span>{task.events.length} updates</span>
          </summary>
          <ol className="ide-workflow-list">
            {task.events.map((event, index) => {
              const process = [...task.processes]
                .reverse()
                .find((entry) => entry.stage === event.stage);
              return (
                <li key={`${event.at}-${index}`}>
                  <i className={event.stage === task.stage && active ? "is-live" : ""} />
                  <div>
                    <strong>{event.stage.replaceAll("_", " ")}</strong>
                    <p>{event.message}</p>
                    {process ? <WorkflowRuntime now={now} process={process} /> : null}
                  </div>
                  <time>{shortTime(event.at)}</time>
                </li>
              );
            })}
          </ol>
        </details>
      </div>
    </section>
  );
}

function TaskMemory({
  repository,
  task,
  settings,
  tokenBudget,
  confidence,
}: {
  repository: Repository;
  task: TaskJob;
  settings: Settings;
  tokenBudget: number;
  confidence: RetrievalConfidence | null;
}) {
  const contextLimit =
    task.contextPack?.budgetTokens ?? task.contextPolicy?.tokenBudget ?? tokenBudget;
  return (
    <section className="ide-task-panel ide-task-memory" aria-label="Task memory">
      <header className="ide-task-panel-header">
        <div>
          <span>Memory</span>
          <strong>Context used by this task</strong>
          <p>Exact retrieval provenance and usage—not the entire repository context.</p>
        </div>
        {confidence ? (
          <span className={`ide-confidence-badge ${confidence.level}`}>
            {confidence.level === "disabled"
              ? "Off"
              : `${Math.round(confidence.score * 100)}% ${confidence.level}`}
          </span>
        ) : null}
      </header>
      <div className="ide-task-panel-body">
        <div className="ide-memory-summary-grid">
          <article>
            <span>Repository memory</span>
            <strong>{repository.context?.status ?? "missing"}</strong>
            <small>{repository.context?.documents ?? 0} documents</small>
          </article>
          <article>
            <span>Task capsule</span>
            <strong>
              {task.contextPolicy?.enabled === false
                ? "Disabled"
                : `≈${(task.contextPack?.estimatedTokens ?? 0).toLocaleString()} tokens`}
            </strong>
            <small>Limit {contextLimit.toLocaleString()}</small>
          </article>
          <article>
            <span>Retrieval</span>
            <strong>{task.contextPack?.graphify ? `Graphify ${task.contextPack.graphify.status}` : settings.context.graphify ? "Graphify enabled" : "Ranked memory"}</strong>
            <small>{task.contextPack?.graphify?.matchedPaths?.length ?? 0} source paths</small>
          </article>
          <article>
            <span>Total usage</span>
            <strong>{task.usage?.totals ? `${task.usage.totals.totalTokens.toLocaleString()} tokens` : "No calls"}</strong>
            <small>{task.usage?.totals ? `${task.usage.totals.calls} calls · ${compactDuration(task.usage.totals.durationMs)}` : "Waiting for agent usage"}</small>
          </article>
        </div>
        {task.usage?.totals ? (
          <section className="ide-usage-comparison">
            {(["codex", "claude"] as const).map((agent) => {
              const usage = task.usage?.byAgent?.[agent];
              return (
                <div key={agent}>
                  <span className={`ide-agent-avatar ${agent}`}>{agent === "codex" ? "C" : "A"}</span>
                  <div>
                    <strong>{agent === "codex" ? "Codex" : "Claude"}</strong>
                    <p>{usage ? `${usage.totalTokens.toLocaleString()} tokens · ${usage.calls} calls · ${compactDuration(usage.durationMs)}` : "No calls"}</p>
                  </div>
                </div>
              );
            })}
          </section>
        ) : null}
        <details className="ide-run-details" open>
          <summary>
            Selected memory
            <span>{task.contextPack?.selectedPaths.length ?? 0} files</span>
          </summary>
          <ul>
            {(task.contextPack?.selectedPaths ?? []).map((file) => (
              (() => {
                const evidence = task.contextPack?.selectedEvidence?.find(
                  (entry) => entry.path === file,
                );
                const reason = evidence
                  ? [
                      evidence.graphScore > 0 ? `graph ${evidence.graphScore}` : "",
                      evidence.lexicalScore > 0 ? `terms ${evidence.lexicalScore}` : "",
                      evidence.priorityScore > 0 ? `priority ${evidence.priorityScore}` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ") || "core context"
                  : "core context";
                return (
                  <li className="capsule-source" key={file}>
                    <span>{file}</span>
                    <small>
                      {reason}
                      {evidence?.estimatedTokens
                        ? ` · ≈${evidence.estimatedTokens.toLocaleString()} tokens`
                        : ""}
                    </small>
                  </li>
                );
              })()
            ))}
          </ul>
        </details>
      </div>
    </section>
  );
}

function ReplayComparison({
  replayId,
  tasks,
  onDismissClarification,
  onOpenTask,
  onReview,
}: {
  replayId: string;
  tasks: TaskJob[];
  onDismissClarification: (task: TaskJob) => void;
  onOpenTask: (task: TaskJob) => void;
  onReview: (task: TaskJob) => void;
}) {
  const variants = tasks
    .filter((task) => task.replay?.id === replayId)
    .sort(
      (left, right) =>
        (left.replay?.variantIndex ?? 0) - (right.replay?.variantIndex ?? 0),
    );
  const finished = variants.every((task) =>
    [
      "accepted",
      "awaiting_review",
      "canceled",
      "completed",
      "conflict",
      "failed",
      "rejected",
    ].includes(task.status),
  );
  const baseline = variants[0]?.replay?.baseSha ?? variants[0]?.baseSha;
  const readOnly = variants[0]?.kind === "chat";

  return (
    <section className="ide-task-panel ide-replay-panel" aria-label="Council replay comparison">
      <header className="ide-task-panel-header">
        <div>
          <span>Council Replay</span>
          <strong>{finished ? "Comparison ready" : "Running comparable tasks"}</strong>
          <p>
            Every variant reads {baseline?.slice(0, 12) ?? "the same snapshot"};{" "}
            {readOnly
              ? "answers stay read-only and create no worktrees."
              : "neither patch changes the connected repository before review."}
          </p>
        </div>
        <span className={`ide-replay-state ${finished ? "complete" : "running"}`}>
          {variants.filter((task) => !taskIsActive(task)).length}/{variants.length}
        </span>
      </header>
      <section className="ide-replay-prompt" aria-label="Original request">
        <span>Original request</span>
        <p>{variants[0]?.prompt ?? "Request unavailable"}</p>
      </section>
      <div className="ide-replay-grid">
        {variants.map((task) => {
          const usage = task.usage?.totals;
          return (
            <article className="ide-replay-card" key={task.id}>
              <header>
                <div>
                  <span>Variant {(task.replay?.variantIndex ?? 0) + 1}</span>
                  <strong>{task.replay?.label ?? task.decision.label}</strong>
                </div>
                <span className={`ide-status ${task.status}`}>{jobLabel(task)}</span>
              </header>
              <p>{task.decision.label}</p>
              <div className="ide-replay-models" aria-label="Selected models">
                {task.decision.strategy !== "claude_only" ? (
                  <span>
                    <b>C</b>
                    {taskAgentSettings(task, "codex").model} ·{" "}
                    {taskAgentSettings(task, "codex").reasoning}
                  </span>
                ) : null}
                {task.decision.strategy !== "codex_only" ? (
                  <span>
                    <b>A</b>
                    {taskAgentSettings(task, "claude").model} ·{" "}
                    {taskAgentSettings(task, "claude").reasoning}
                  </span>
                ) : null}
              </div>
              <dl>
                <div>
                  <dt>Context</dt>
                  <dd>{task.contextPolicy?.enabled === false ? "Off" : "On"}</dd>
                </div>
                <div>
                  <dt>Agent calls</dt>
                  <dd>{usage?.calls ?? 0}</dd>
                </div>
                <div>
                  <dt>Tokens</dt>
                  <dd>{compactTokens(usage?.totalTokens ?? 0)}</dd>
                </div>
                <div>
                  <dt>Context tokens</dt>
                  <dd>{compactTokens(usage?.contextTokens ?? 0)}</dd>
                </div>
                <div>
                  <dt>Agent time</dt>
                  <dd>{compactDuration(usage?.durationMs ?? 0)}</dd>
                </div>
                {readOnly ? (
                  <div>
                    <dt>Mode</dt>
                    <dd>Read-only</dd>
                  </div>
                ) : (
                  <div>
                    <dt>Changed files</dt>
                    <dd>{task.review?.files.length ?? 0}</dd>
                  </div>
                )}
              </dl>
              {task.review ? (
                <div className="ide-replay-evidence">
                  <strong>{task.review.stat}</strong>
                  <small>{task.review.checks}</small>
                </div>
              ) : task.error ? (
                <div className="ide-task-error">{task.error}</div>
              ) : (
                <div className="ide-replay-evidence pending">
                  <strong>{task.stage.replaceAll("_", " ")}</strong>
                  <small>{task.events.at(-1)?.message ?? "Waiting to start"}</small>
                </div>
              )}
              <footer>
                <button onClick={() => onOpenTask(task)} type="button">
                  Open run
                </button>
                {task.status === "awaiting_input" ? (
                  <button
                    className="danger"
                    onClick={() => onDismissClarification(task)}
                    type="button"
                  >
                    Dismiss request
                  </button>
                ) : null}
                {task.review ? (
                  <button className="primary" onClick={() => onReview(task)} type="button">
                    Review patch
                  </button>
                ) : null}
              </footer>
            </article>
          );
        })}
      </div>
      {!finished ? (
        <p className="ide-replay-note">
          {readOnly
            ? "Results update automatically as each read-only answer records usage."
            : "Results update automatically as each isolated task records usage and verification."}
        </p>
      ) : null}
    </section>
  );
}

export default function CouncilIde() {
  const [status, setStatus] = useState<Status | null>(null);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [tasks, setTasks] = useState<TaskJob[]>([]);
  const [contexts, setContexts] = useState<ContextJob[]>([]);
  const [settings, setSettings] = useState<Settings>(FALLBACK_SETTINGS);
  const [settingsOptions, setSettingsOptions] =
    useState<SettingsOptions>(FALLBACK_OPTIONS);
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [filePaths, setFilePaths] = useState<string[]>([]);
  const [uiState, setUiState] = useState(createCouncilUiState);
  const [uiStateHydrated, setUiStateHydrated] = useState(false);
  const [treeState, setTreeState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [treeError, setTreeError] = useState("");
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);
  const [fileFilter, setFileFilter] = useState("");
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [rightTab] = useState<"tasks" | "monitor" | "memory">("tasks");
  const [taskView, setTaskView] = useState<TaskCenterView>("conversation");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [draftingNew, setDraftingNew] = useState(false);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [doctorOpen, setDoctorOpen] = useState(false);
  const [doctorReport, setDoctorReport] = useState<DoctorReport | null>(null);
  const [replayOpen, setReplayOpen] = useState(false);
  const [replayIntent, setReplayIntent] = useState<"chat" | "code" | null>(null);
  const [replayVariants, setReplayVariants] = useState<ReplayVariantInput[]>([
    {
      label: "Codex only",
      strategy: "codex_only",
      contextEnabled: true,
      codexModel: FALLBACK_SETTINGS.codex.model,
      claudeModel: FALLBACK_SETTINGS.claude.model,
      codexReasoning: FALLBACK_SETTINGS.codex.reasoning,
      claudeReasoning: FALLBACK_SETTINGS.claude.reasoning,
    },
    {
      label: "Codex + Claude council",
      strategy: "council_plan_codex_execute",
      contextEnabled: true,
      codexModel: FALLBACK_SETTINGS.codex.model,
      claudeModel: FALLBACK_SETTINGS.claude.model,
      codexReasoning: FALLBACK_SETTINGS.codex.reasoning,
      claudeReasoning: FALLBACK_SETTINGS.claude.reasoning,
    },
  ]);
  const [connectMode, setConnectMode] = useState<"local" | "github">("local");
  const [repositoryInput, setRepositoryInput] = useState("");
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [skillCatalog, setSkillCatalog] = useState<SkillCatalog | null>(null);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [skillMode, setSkillMode] = useState<"auto" | "explicit">("auto");
  const [selectedSkillPaths, setSelectedSkillPaths] = useState<string[]>([]);
  const [skillError, setSkillError] = useState("");
  const [githubMenuOpen, setGitHubMenuOpen] = useState(false);
  const [githubWorkspace, setGitHubWorkspace] =
    useState<GitHubWorkspace | null>(null);
  const [githubError, setGitHubError] = useState("");
  const [githubLoading, setGitHubLoading] = useState(false);
  const [goalEnabled, setGoalEnabled] = useState(false);
  const [goalTokenBudget, setGoalTokenBudget] = useState(50_000);
  const [useContextForTask, setUseContextForTask] = useState(
    FALLBACK_SETTINGS.context.enabledByDefault,
  );
  const [prompt, setPrompt] = useState("");
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionFeedback, setRevisionFeedback] = useState("");
  const [gitDialogMode, setGitDialogMode] = useState<
    "commit" | "push" | "draft-pr" | null
  >(null);
  const [gitPreview, setGitPreview] = useState<GitPreview | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [pullRequestTitle, setPullRequestTitle] = useState("");
  const [pullRequestSummary, setPullRequestSummary] = useState("");
  const [pullRequestBase, setPullRequestBase] = useState("main");
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandIndex, setCommandIndex] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const lastDiffRef = useRef("");
  const loadingDiffsRef = useRef(new Set<string>());
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const uiStateRef = useRef(uiState);
  const tasksRef = useRef(tasks);
  const repositoriesRef = useRef(repositories);
  const previousTaskStatesRef = useRef<Map<string, string> | null>(null);
  const workbenchHandoffHandledRef = useRef(false);

  useEffect(() => {
    uiStateRef.current = uiState;
  }, [uiState]);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    repositoriesRef.current = repositories;
  }, [repositories]);

  const selectedRepository = useMemo(
    () => repositories.find((repository) => repository.id === selectedRepoId) ?? null,
    [repositories, selectedRepoId],
  );
  const selectedRepositoryId = selectedRepository?.id ?? null;
  const selectedRepositoryUi = useMemo(
    () => repositoryUiState(uiState, selectedRepositoryId),
    [selectedRepositoryId, uiState],
  );
  const expanded = useMemo(
    () => new Set(selectedRepositoryUi.expandedFolders),
    [selectedRepositoryUi.expandedFolders],
  );
  const repositoryTasks = useMemo(
    () => tasks.filter((job) => job.repository === selectedRepository?.path),
    [tasks, selectedRepository],
  );
  const activeRepositoryTasks = useMemo(
    () => repositoryTasks.filter((job) => !job.archivedAt),
    [repositoryTasks],
  );
  const archivedRepositoryTasks = useMemo(
    () => repositoryTasks.filter((job) => Boolean(job.archivedAt)),
    [repositoryTasks],
  );
  const taskFilter = selectedRepositoryUi.taskFilter;
  const filteredRepositoryTasks = useMemo(() => {
    if (taskFilter === "archived") return archivedRepositoryTasks;
    return activeRepositoryTasks.filter((job) => {
      if (taskFilter === "needs_input") {
        return ["awaiting_input", "awaiting_approval", "paused"].includes(
          job.status,
        );
      }
      if (taskFilter === "review") return job.status === "awaiting_review";
      if (taskFilter === "failed") {
        return ["failed", "conflict", "canceled"].includes(job.status);
      }
      return true;
    });
  }, [activeRepositoryTasks, archivedRepositoryTasks, taskFilter]);
  const selectedTask = useMemo(
    () =>
      tasks.find(
        (job) =>
          job.id === selectedTaskId &&
          job.repository === selectedRepository?.path,
      ) ??
      (draftingNew ? null : activeRepositoryTasks[0]) ??
      null,
    [
      tasks,
      selectedTaskId,
      activeRepositoryTasks,
      selectedRepository,
      draftingNew,
    ],
  );
  const activeContext = contexts.find(
    (job) =>
      job.repository === selectedRepository?.path &&
      ["queued", "running"].includes(job.status),
  );
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const tree = useMemo(() => buildTree(filePaths), [filePaths]);
  const changedFiles = useMemo(
    () => new Set(selectedTask?.review?.files ?? []),
    [selectedTask?.review?.files],
  );
  const pendingApproval = tasks.find(
    (job) => job.approval?.status === "pending",
  );
  const codexReady = Boolean(
    status?.tools.codex?.available && status.tools.codex.authenticated !== false,
  );
  const claudeReady = Boolean(
    status?.tools.claude?.available && status.tools.claude.authenticated !== false,
  );
  const agentsReady =
    settings.routingMode === "auto" ||
    settings.strategy === "council_plan_codex_execute"
      ? codexReady && claudeReady
      : settings.strategy === "claude_only"
        ? claudeReady
        : codexReady;
  const taskSkillProviders = useMemo(
    () =>
      new Set<"codex" | "claude">(
        settings.routingMode === "auto" ||
        settings.strategy === "council_plan_codex_execute"
          ? ["codex", "claude"]
          : settings.strategy === "claude_only"
            ? ["claude"]
            : ["codex"],
      ),
    [settings.routingMode, settings.strategy],
  );
  const availableSkills = useMemo(
    () =>
      (skillCatalog?.skills ?? []).filter((skill) =>
        taskSkillProviders.has(skill.provider),
      ),
    [skillCatalog, taskSkillProviders],
  );
  const selectedSkills = useMemo(
    () =>
      availableSkills.filter((skill) =>
        selectedSkillPaths.includes(skill.path),
      ),
    [availableSkills, selectedSkillPaths],
  );
  const replayNeedsCodex = replayVariants.some(
    (variant) => variant.strategy !== "claude_only",
  );
  const replayNeedsClaude = replayVariants.some(
    (variant) => variant.strategy !== "codex_only",
  );
  const replayCodexModels = modelEntries(
    settingsOptions.codexCatalog,
    settingsOptions.codexModels,
    settings.codex.model,
  );
  const replayClaudeModels = modelEntries(
    settingsOptions.claudeCatalog,
    settingsOptions.claudeModels,
    settings.claude.model,
  );
  const replyingToTask =
    Boolean(selectedTask) &&
    !draftingNew &&
    activeTab?.kind === "task" &&
    activeTab.taskId === selectedTask?.id &&
    (selectedTask?.kind === "chat" ||
      selectedTask?.status === "awaiting_input" ||
      ["queued", "running", "awaiting_approval"].includes(
        selectedTask?.status ?? "",
      ));
  const selectedConversationBusy = false;
  const retrievalConfidence =
    selectedTask?.contextPack?.retrieval?.confidence ??
    selectedTask?.contextPack?.graphify?.confidence ??
    null;
  const contextCatalog =
    settings.context.provider === "codex"
      ? settingsOptions.codexCatalog
      : settingsOptions.claudeCatalog;
  const contextFallbackModels =
    settings.context.provider === "codex"
      ? settingsOptions.codexModels
      : settingsOptions.claudeModels;
  const contextModels = modelEntries(
    contextCatalog,
    contextFallbackModels,
    settings.context.model,
  );
  const contextFallbackReasoning =
    settings.context.provider === "codex"
      ? settingsOptions.codexReasoning
      : settingsOptions.claudeReasoning;
  const taskContextBudget =
    settings.context.tokenBudget ?? FALLBACK_SETTINGS.context.tokenBudget;

  async function refreshAll(preferredRepositoryId?: string | null) {
    const [repositoryResult, taskResult, contextResult] = await Promise.all([
      localRequest<{ repositories: Repository[] }>("/v1/repositories"),
      localRequest<{ jobs: TaskJob[] }>("/v1/tasks"),
      localRequest<{ jobs: ContextJob[] }>("/v1/context/jobs"),
    ]);
    setRepositories(repositoryResult.repositories);
    setTasks((current) =>
      taskResult.jobs.map((job) => {
        const existing = current.find((candidate) => candidate.id === job.id);
        return job.review &&
          !job.review.diff &&
          existing?.review?.diff &&
          job.reviewIteration === existing.reviewIteration
          ? { ...job, review: existing.review }
          : job;
      }),
    );
    setContexts(contextResult.jobs);
    setSelectedRepoId((current) => {
      const selected = repositoryResult.repositories.find(
        (repository) =>
          repository.id === current || repository.id === preferredRepositoryId,
      );
      return selected?.id ?? repositoryResult.repositories[0]?.id ?? null;
    });
  }

  const ensureReviewDiff = useCallback(async (taskId: string) => {
    if (loadingDiffsRef.current.has(taskId)) return;
    loadingDiffsRef.current.add(taskId);
    try {
      const result = await localRequest<{ job: TaskJob }>(`/v1/tasks/${taskId}`);
      setTasks((current) =>
        current.map((job) =>
          job.id === taskId &&
          job.reviewIteration === result.job.reviewIteration
            ? { ...job, review: result.job.review }
            : job,
        ),
      );
    } catch (reason) {
      setError(String((reason as Error).message ?? reason));
    } finally {
      loadingDiffsRef.current.delete(taskId);
    }
  }, []);

  useEffect(() => {
    let canceled = false;
    queueMicrotask(() => {
      const migratedUiState = parseCouncilUiState(
        window.localStorage.getItem(COUNCIL_UI_STATE_KEY),
        {
          selectedRepositoryId: window.localStorage.getItem(
            "council.repositoryId",
          ),
          theme: window.localStorage.getItem("council.theme"),
        },
      );
      setUiState(migratedUiState);
      setTheme(migratedUiState.theme);
      setUiStateHydrated(true);
      Promise.all([
        localRequest<Status>("/v1/status"),
        localRequest<{ settings: Settings; options: SettingsOptions }>("/v1/settings"),
        refreshAll(migratedUiState.selectedRepositoryId),
      ])
        .then(([nextStatus, settingsResult]) => {
          if (canceled) return;
          setStatus(nextStatus);
          setSettings(settingsResult.settings);
          setUseContextForTask(
            settingsResult.settings.context.enabledByDefault !== false,
          );
          setSettingsOptions(settingsResult.options);
        })
        .catch((reason) => setError(String(reason.message ?? reason)));
    });
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (
      workbenchHandoffHandledRef.current ||
      !uiStateHydrated ||
      status === null
    ) {
      return;
    }
    let canceled = false;
    queueMicrotask(() => {
      if (canceled || workbenchHandoffHandledRef.current) return;
      const parameters = new URLSearchParams(window.location.search);
      const handoffPrompt = parameters.get("prompt")?.trim() ?? "";
      const handoffRepository = parameters.get("repository")?.trim() ?? "";
      const handoffView = parameters.get("view")?.trim() ?? "";
      if (!handoffPrompt && !handoffRepository && !handoffView) {
        workbenchHandoffHandledRef.current = true;
        return;
      }
      const repository =
        repositories.find(
          (candidate) => candidate.path === handoffRepository,
        ) ??
        repositories[0] ??
        null;
      if (handoffRepository && !repository && repositories.length === 0) return;

      workbenchHandoffHandledRef.current = true;
      window.history.replaceState({}, "", window.location.pathname);
      if (repository) setSelectedRepoId(repository.id);
      if (handoffPrompt) {
        setDraftingNew(true);
        setSelectedTaskId(null);
        setActiveTabId(null);
        setTaskView("conversation");
        setPrompt(handoffPrompt.slice(0, 20_000));
        window.requestAnimationFrame(() => composerRef.current?.focus());
      }
      if (handoffView === "github" && repository) {
        setGitHubMenuOpen(true);
        setGitHubLoading(true);
        setGitHubError("");
        void localRequest<GitHubWorkspace>(
          `/v1/repositories/${repository.id}/github`,
        )
          .then((workspace) => {
            if (!canceled) setGitHubWorkspace(workspace);
          })
          .catch((reason) => {
            if (!canceled) {
              setGitHubError(String((reason as Error).message ?? reason));
            }
          })
          .finally(() => {
            if (!canceled) setGitHubLoading(false);
          });
      }
    });
    return () => {
      canceled = true;
    };
  }, [repositories, status, uiStateHydrated]);

  useEffect(() => {
    if (!uiStateHydrated) return;
    window.localStorage.setItem(COUNCIL_UI_STATE_KEY, JSON.stringify(uiState));
  }, [uiState, uiStateHydrated]);

  useEffect(() => {
    const current = new Map(tasks.map((task) => [task.id, task.status]));
    const previous = previousTaskStatesRef.current;
    previousTaskStatesRef.current = current;
    if (!previous || !uiState.notificationsEnabled) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") {
      return;
    }
    const notificationLabels: Record<string, string> = {
      awaiting_input: "code-council needs clarification",
      awaiting_approval: "code-council needs approval",
      awaiting_review: "Patch ready for review",
      paused: "Goal paused",
      failed: "code-council task failed",
      conflict: "Accepted patch has a conflict",
    };
    for (const task of tasks) {
      if (previous.get(task.id) === task.status || !notificationLabels[task.status]) {
        continue;
      }
      new Notification(notificationLabels[task.status], {
        body: task.prompt.slice(0, 180),
        tag: `council:${task.id}:${task.status}`,
      });
    }
  }, [tasks, uiState.notificationsEnabled]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen(true);
        setCommandQuery("");
        setCommandIndex(0);
      } else if (event.key === "Escape") {
        setCommandPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!selectedTask || !selectedRepositoryId) return;
    let canceled = false;
    queueMicrotask(() => {
      if (canceled) return;
      setUiState((current) =>
        updateRepositoryUiState(
          current,
          selectedRepositoryId,
          (repositoryState) =>
            repositoryState.lastSeenTaskUpdates[selectedTask.id] ===
            selectedTask.updatedAt
              ? repositoryState
              : {
                  ...repositoryState,
                  lastSeenTaskUpdates: {
                    ...repositoryState.lastSeenTaskUpdates,
                    [selectedTask.id]: selectedTask.updatedAt,
                  },
                },
        ),
      );
    });
    return () => {
      canceled = true;
    };
  }, [selectedRepositoryId, selectedTask]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void refreshAll().catch(() => {});
    }, 1_500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let canceled = false;
    lastDiffRef.current = "";
    queueMicrotask(() => {
      if (canceled) return;
      setDraftingNew(false);
      if (!selectedRepositoryId) {
        setTabs([]);
        setActiveTabId(null);
        setSelectedTaskId(null);
        setTaskView("conversation");
        setFilePaths([]);
        setTreeState("idle");
        setTreeError("");
        return;
      }
      window.localStorage.setItem("council.repositoryId", selectedRepositoryId);
      setUiState((current) =>
        current.selectedRepositoryId === selectedRepositoryId
          ? current
          : { ...current, selectedRepositoryId },
      );
      const saved = repositoryUiState(uiStateRef.current, selectedRepositoryId);
      const repositoryTaskList = tasksRef.current.filter(
        (task) =>
          repositoriesRef.current.find(
            (repository) => repository.id === selectedRepositoryId,
          )?.path === task.repository,
      );
      const restoredTabs: EditorTab[] = [];
      const restoredReplayIds = new Set([
        ...saved.openReplayIds,
        ...saved.openTaskIds.flatMap((taskId) => {
          const task = repositoryTaskList.find(
            (candidate) => candidate.id === taskId,
          );
          return task?.replay && saved.taskViews[taskId] === "compare"
            ? [task.replay.id]
            : [];
        }),
      ]);
      for (const replayId of restoredReplayIds) {
        const task = repositoryTaskList
          .filter((candidate) => candidate.replay?.id === replayId)
          .sort(
            (left, right) =>
              (left.replay?.variantIndex ?? 0) -
              (right.replay?.variantIndex ?? 0),
          )[0];
        if (!task?.replay) continue;
        restoredTabs.push({
          id: `replay:${replayId}`,
          kind: "replay",
          title: replayWindowTitle(task, repositoryTaskList),
          replayId,
          taskId: task.id,
        });
      }
      for (const taskId of saved.openTaskIds) {
        const task = repositoryTaskList.find((candidate) => candidate.id === taskId);
        if (!task) continue;
        if (
          task.replay &&
          saved.taskViews[task.id] === "compare" &&
          !saved.openReplayIds.includes(task.replay.id)
        ) {
          continue;
        }
        restoredTabs.push({
          id: `task:${task.id}`,
          kind: "task",
          title: taskWindowTitle(task, repositoryTaskList),
          taskId: task.id,
        });
      }
      for (const taskId of saved.openDiffTaskIds) {
        const task = repositoryTaskList.find((candidate) => candidate.id === taskId);
        if (!task?.review) continue;
        restoredTabs.push({
          id: `diff:${task.id}`,
          kind: "diff",
          title: `Changes (${task.review.files.length})`,
          taskId: task.id,
          iteration: task.reviewIteration,
        });
      }
      setTabs(restoredTabs);
      setSelectedTaskId(saved.selectedTaskId);
      setTaskView(
        saved.selectedTaskId
          ? saved.taskViews[saved.selectedTaskId] ?? "conversation"
          : "conversation",
      );
      setActiveTabId(
        saved.activeTabId &&
          restoredTabs.some((tab) => tab.id === saved.activeTabId)
          ? saved.activeTabId
          : restoredTabs[0]?.id ?? null,
      );
      void Promise.all(
        saved.openFilePaths.map((relativePath) =>
          localRequest<RepositoryFile>(
            `/v1/repositories/${selectedRepositoryId}/file?file=${encodeURIComponent(relativePath)}`,
          ).catch(() => null),
        ),
      ).then((files) => {
        if (canceled) return;
        const fileTabs: EditorTab[] = files
          .filter((file): file is RepositoryFile => file !== null)
          .map((file) => ({
            id: `file:${file.path}`,
            kind: "file",
            title: file.name,
            file,
          }));
        const allTabs = [...restoredTabs, ...fileTabs];
        setTabs(allTabs);
        setActiveTabId(
          saved.activeTabId && allTabs.some((tab) => tab.id === saved.activeTabId)
            ? saved.activeTabId
            : allTabs[0]?.id ?? null,
        );
      });
    });
    return () => {
      canceled = true;
    };
  }, [selectedRepositoryId]);

  useEffect(() => {
    let canceled = false;
    queueMicrotask(() => {
      if (canceled) return;
      setSkillCatalog(null);
      setSkillError("");
      setSkillMode("auto");
      setSelectedSkillPaths([]);
      setSkillMenuOpen(false);
      setGitHubMenuOpen(false);
      setGitHubWorkspace(null);
      setGitHubError("");
      if (!selectedRepositoryId || (!codexReady && !claudeReady)) return;
      void localRequest<SkillCatalog>(
        `/v1/repositories/${selectedRepositoryId}/skills`,
      )
        .then((catalog) => {
          if (!canceled) setSkillCatalog(catalog);
        })
        .catch((reason) => {
          if (!canceled) {
            setSkillError(String((reason as Error).message ?? reason));
          }
        });
    });
    return () => {
      canceled = true;
    };
  }, [claudeReady, codexReady, selectedRepositoryId]);

  useEffect(() => {
    let canceled = false;
    queueMicrotask(() => {
      if (canceled || !selectedRepositoryId) return;
      setFilePaths([]);
      setTreeState("loading");
      setTreeError("");
      void localRequest<{ files: string[]; truncated: boolean }>(
        `/v1/repositories/${selectedRepositoryId}/tree`,
      )
        .then((result) => {
          if (!canceled) {
            setFilePaths(result.files);
            setTreeState("ready");
          }
        })
        .catch((reason) => {
          if (!canceled) {
            setFilePaths([]);
            setTreeError(String((reason as Error).message ?? reason));
            setTreeState("error");
          }
        });
    });
    return () => {
      canceled = true;
    };
  }, [selectedRepositoryId, treeRefreshKey]);

  useEffect(() => {
    if (!selectedTask || draftingNew || activeTab?.kind === "replay") return;
    let canceled = false;
    queueMicrotask(() => {
      if (canceled) return;
      const id = `task:${selectedTask.id}`;
      setTabs((current) =>
        current.some((tab) => tab.id === id)
          ? current
          : [
              ...current,
              {
                id,
                kind: "task",
                title: taskWindowTitle(selectedTask, repositoryTasks),
                taskId: selectedTask.id,
              },
            ],
      );
      setActiveTabId((current) => current ?? id);
      setSelectedTaskId(selectedTask.id);
      setUiState((current) =>
        selectedRepositoryId
          ? updateRepositoryUiState(
              current,
              selectedRepositoryId,
              (repositoryState) => ({
                ...repositoryState,
                activeTabId: repositoryState.activeTabId ?? id,
                selectedTaskId: selectedTask.id,
                openTaskIds: repositoryState.openTaskIds.includes(selectedTask.id)
                  ? repositoryState.openTaskIds
                  : [...repositoryState.openTaskIds, selectedTask.id],
              }),
            )
          : current,
      );
    });
    return () => {
      canceled = true;
    };
  }, [
    activeTab?.kind,
    draftingNew,
    repositoryTasks,
    selectedRepositoryId,
    selectedTask,
  ]);

  useEffect(() => {
    const task = selectedTask;
    const review = task?.review;
    if (!task || !review) return;
    let canceled = false;
    queueMicrotask(() => {
      if (canceled) return;
      if (!review.diff && review.files.length) {
        void ensureReviewDiff(task.id);
      }
      const version = `${task.id}:${task.reviewIteration}`;
      if (lastDiffRef.current === version) return;
      lastDiffRef.current = version;
      const tab: EditorTab = {
        id: `diff:${task.id}`,
        kind: "diff",
        title: `Changes (${review.files.length})`,
        taskId: task.id,
        iteration: task.reviewIteration,
      };
      setTabs((current) => [
        ...current.filter((entry) => entry.id !== tab.id),
        tab,
      ]);
    });
    return () => {
      canceled = true;
    };
  }, [ensureReviewDiff, selectedTask]);

  async function saveSettings(next: Settings) {
    setSettings(next);
    try {
      const result = await localRequest<{ settings: Settings }>("/v1/settings", {
        method: "POST",
        body: JSON.stringify(next),
      });
      setSettings(result.settings);
    } catch (reason) {
      setError(String((reason as Error).message ?? reason));
    }
  }

  function toggleTheme() {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      window.localStorage.setItem("council.theme", next);
      setUiState((state) => ({ ...state, theme: next }));
      return next;
    });
  }

  function persistRepositoryWorkspace(
    update: Parameters<typeof updateRepositoryUiState>[2],
  ) {
    if (!selectedRepositoryId) return;
    setUiState((current) =>
      updateRepositoryUiState(current, selectedRepositoryId, update),
    );
  }

  function beginExplorerResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = uiState.explorerWidth;
    const onMove = (moveEvent: PointerEvent) => {
      const explorerWidth = Math.max(
        220,
        Math.min(420, startWidth + moveEvent.clientX - startX),
      );
      setUiState((current) => ({ ...current, explorerWidth }));
    };
    const onEnd = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      document.body.classList.remove("ide-is-resizing");
    };
    document.body.classList.add("ide-is-resizing");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd, { once: true });
  }

  function selectTaskCenterView(view: TaskCenterView, taskId = selectedTask?.id) {
    setTaskView(view);
    if (!taskId) return;
    persistRepositoryWorkspace((current) => ({
      ...current,
      selectedTaskId: taskId,
      taskViews: { ...current.taskViews, [taskId]: view },
    }));
  }

  function selectTaskFilter(filter: TaskListFilter) {
    persistRepositoryWorkspace((current) => ({
      ...current,
      taskFilter: filter,
    }));
  }

  async function toggleDesktopNotifications() {
    if (uiState.notificationsEnabled) {
      setUiState((current) => ({
        ...current,
        notificationsEnabled: false,
      }));
      return;
    }
    if (typeof Notification === "undefined") {
      setError("Desktop notifications are not supported by this browser.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setError("Desktop notification permission was not granted.");
      return;
    }
    setUiState((current) => ({ ...current, notificationsEnabled: true }));
  }

  async function runDoctor() {
    setDoctorOpen(true);
    setBusy("doctor");
    setError("");
    try {
      setDoctorReport(await localRequest<DoctorReport>("/v1/doctor"));
    } catch (reason) {
      setError(String((reason as Error).message ?? reason));
    } finally {
      setBusy("");
    }
  }

  async function toggleGitHubWorkspace() {
    const opening = !githubMenuOpen;
    if (opening) setContextMenuOpen(false);
    setGitHubMenuOpen(opening);
    if (
      !opening ||
      githubWorkspace ||
      githubLoading ||
      !selectedRepositoryId
    ) {
      return;
    }
    setGitHubLoading(true);
    setGitHubError("");
    try {
      setGitHubWorkspace(
        await localRequest<GitHubWorkspace>(
          `/v1/repositories/${selectedRepositoryId}/github`,
        ),
      );
    } catch (reason) {
      setGitHubError(String((reason as Error).message ?? reason));
    } finally {
      setGitHubLoading(false);
    }
  }

  async function refreshGitHubWorkspace() {
    if (!selectedRepositoryId) return;
    setGitHubLoading(true);
    setGitHubError("");
    try {
      setGitHubWorkspace(
        await localRequest<GitHubWorkspace>(
          `/v1/repositories/${selectedRepositoryId}/github`,
        ),
      );
    } catch (reason) {
      setGitHubError(String((reason as Error).message ?? reason));
    } finally {
      setGitHubLoading(false);
    }
  }

  function draftFromGitHub(
    promptText: string,
    options: { goal?: boolean } = {},
  ) {
    beginNewTask();
    setPrompt(promptText);
    setGoalEnabled(Boolean(options.goal));
    setGitHubMenuOpen(false);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  function updateReplayVariant(
    index: number,
    update: Partial<ReplayVariantInput>,
  ) {
    setReplayVariants((current) =>
      current.map((variant, position) =>
        position === index ? { ...variant, ...update } : variant,
      ),
    );
  }

  async function openReplayDialog() {
    if (!selectedRepository || !prompt.trim()) return;
    setBusy("replay-intent");
    setError("");
    try {
      const result = await localRequest<{ intent: "chat" | "code" }>(
        "/v1/tasks/route",
        {
          method: "POST",
          body: JSON.stringify({
            path: selectedRepository.path,
            prompt: prompt.trim(),
            intent: "auto",
          }),
        },
      );
      setReplayIntent(result.intent);
      if (result.intent === "chat") {
        setReplayVariants((current) =>
          current.map((variant) =>
            variant.strategy === "council_plan_codex_execute"
              ? {
                  ...variant,
                  label:
                    variant.label === "Codex + Claude council"
                      ? "Claude only"
                      : variant.label,
                  strategy: "claude_only",
                }
              : variant,
          ),
        );
      }
      setReplayOpen(true);
    } catch (reason) {
      setError(String((reason as Error).message ?? reason));
    } finally {
      setBusy("");
    }
  }

  async function startReplay() {
    if (!selectedRepository || !prompt.trim()) return;
    setBusy("replay");
    setError("");
    try {
      const result = await localRequest<{
        intent: "chat" | "code";
        jobs: TaskJob[];
      }>(
        "/v1/replays/start",
        {
          method: "POST",
          body: JSON.stringify({
            path: selectedRepository.path,
            prompt: prompt.trim(),
            intent: "auto",
            variants: replayVariants,
            agentConfig: { codex: settings.codex, claude: settings.claude },
          }),
        },
      );
      const first = result.jobs[0];
      setTasks((current) => [
        ...result.jobs,
        ...current.filter(
          (task) => !result.jobs.some((candidate) => candidate.id === task.id),
        ),
      ]);
      setPrompt("");
      setReplayIntent(result.intent);
      setReplayOpen(false);
      if (first) {
        openReplayWindow(first, [...repositoryTasks, ...result.jobs]);
      }
    } catch (reason) {
      setError(String((reason as Error).message ?? reason));
    } finally {
      setBusy("");
    }
  }

  async function installAgent(agent: "codex" | "claude") {
    setBusy(`install:${agent}`);
    setError("");
    try {
      await localRequest("/v1/agents/install", {
        method: "POST",
        body: JSON.stringify({ agent }),
      });
      const [nextStatus, settingsResult] = await Promise.all([
        localRequest<Status>("/v1/status"),
        localRequest<{ settings: Settings; options: SettingsOptions }>(
          "/v1/settings",
        ),
      ]);
      setStatus(nextStatus);
      setSettings(settingsResult.settings);
      setSettingsOptions(settingsResult.options);
    } catch (reason) {
      setError(String((reason as Error).message ?? reason));
    } finally {
      setBusy("");
    }
  }

  function openReplayWindow(
    task: TaskJob,
    taskList: TaskJob[] = repositoryTasks,
  ) {
    if (!task.replay) {
      openTaskWindow(task);
      return;
    }
    const replay = task.replay;
    const id = `replay:${replay.id}`;
    const tab: EditorTab = {
      id,
      kind: "replay",
      title: replayWindowTitle(task, taskList),
      replayId: replay.id,
      taskId: task.id,
    };
    setTabs((current) =>
      current.some((entry) => entry.id === id) ? current : [...current, tab],
    );
    setSelectedTaskId(task.id);
    setDraftingNew(false);
    setActiveTabId(id);
    setTaskView("compare");
    persistRepositoryWorkspace((current) => ({
      ...current,
      activeTabId: id,
      selectedTaskId: task.id,
      openReplayIds: current.openReplayIds.includes(replay.id)
        ? current.openReplayIds
        : [...current.openReplayIds, replay.id],
    }));
  }

  function openTaskWindow(
    task: TaskJob,
    viewOverride?: TaskCenterView,
  ) {
    const id = `task:${task.id}`;
    const tab: EditorTab = {
      id,
      kind: "task",
      title: taskWindowTitle(task, repositoryTasks),
      taskId: task.id,
    };
    setTabs((current) =>
      current.some((entry) => entry.id === id) ? current : [...current, tab],
    );
    setSelectedTaskId(task.id);
    setDraftingNew(false);
    setActiveTabId(id);
    const requestedView =
      viewOverride ??
      selectedRepositoryUi.taskViews[task.id] ??
      "conversation";
    const savedView =
      task.replay && requestedView === "compare"
        ? "conversation"
        : requestedView;
    setTaskView(savedView);
    persistRepositoryWorkspace((current) => ({
      ...current,
      activeTabId: id,
      selectedTaskId: task.id,
      openTaskIds: current.openTaskIds.includes(task.id)
        ? current.openTaskIds
        : [...current.openTaskIds, task.id],
      taskViews: { ...current.taskViews, [task.id]: savedView },
    }));
  }

  async function openFile(relativePath: string) {
    if (!selectedRepository) return;
    const id = `file:${relativePath}`;
    const existing = tabs.find((tab) => tab.id === id);
    if (existing) {
      setActiveTabId(id);
      persistRepositoryWorkspace((current) => ({
        ...current,
        activeTabId: id,
      }));
      return;
    }
    setBusy(`file:${relativePath}`);
    try {
      const file = await localRequest<RepositoryFile>(
        `/v1/repositories/${selectedRepository.id}/file?file=${encodeURIComponent(relativePath)}`,
      );
      const tab: EditorTab = { id, kind: "file", title: file.name, file };
      setTabs((current) => [...current, tab]);
      setActiveTabId(id);
      persistRepositoryWorkspace((current) => ({
        ...current,
        activeTabId: id,
        openFilePaths: current.openFilePaths.includes(relativePath)
          ? current.openFilePaths
          : [...current.openFilePaths, relativePath],
      }));
    } catch (reason) {
      setError(String((reason as Error).message ?? reason));
    } finally {
      setBusy("");
    }
  }

  function closeTab(id: string) {
    const index = tabs.findIndex((tab) => tab.id === id);
    const next = tabs.filter((tab) => tab.id !== id);
    const fallback =
      activeTabId === id
        ? next[Math.max(0, index - 1)] ?? next[0] ?? null
        : null;
    if (activeTabId === id) {
      setActiveTabId(fallback?.id ?? null);
      if (fallback?.kind === "task" || fallback?.kind === "replay") {
        setSelectedTaskId(fallback.taskId);
        setDraftingNew(false);
        setTaskView(
          fallback.kind === "replay"
            ? "compare"
            : selectedRepositoryUi.taskViews[fallback.taskId] ?? "conversation",
        );
      } else if (!fallback) {
        setSelectedTaskId(null);
        setDraftingNew(true);
        setTaskView("conversation");
      }
    }
    setTabs(next);
    persistRepositoryWorkspace((current) => ({
      ...current,
      activeTabId:
        activeTabId === id
          ? fallback?.id ?? null
          : current.activeTabId,
      openFilePaths: current.openFilePaths.filter(
        (path) => `file:${path}` !== id,
      ),
      openTaskIds: current.openTaskIds.filter(
        (taskId) => `task:${taskId}` !== id,
      ),
      openReplayIds: current.openReplayIds.filter(
        (replayId) => `replay:${replayId}` !== id,
      ),
      openDiffTaskIds: current.openDiffTaskIds.filter(
        (taskId) => `diff:${taskId}` !== id,
      ),
    }));
  }

  function closeTaskWindows(taskId: string) {
    const removed = new Set([`task:${taskId}`, `diff:${taskId}`]);
    const next = tabs.filter((tab) => !removed.has(tab.id));
    if (activeTabId && removed.has(activeTabId)) {
      const fallback = next.at(-1) ?? null;
      setActiveTabId(fallback?.id ?? null);
      if (fallback?.kind === "task" || fallback?.kind === "replay") {
        setSelectedTaskId(fallback.taskId);
        setDraftingNew(false);
        setTaskView(fallback.kind === "replay" ? "compare" : "conversation");
      } else {
        setSelectedTaskId(null);
        setDraftingNew(!fallback);
        setTaskView("conversation");
      }
    }
    setTabs(next);
  }

  function beginNewTask() {
    setDraftingNew(true);
    setSelectedTaskId(null);
    setActiveTabId(null);
    setTaskView("conversation");
    setUseContextForTask(settings.context.enabledByDefault !== false);
    setGoalEnabled(false);
    setGoalTokenBudget(50_000);
    setPrompt("");
    persistRepositoryWorkspace((current) => ({
      ...current,
      activeTabId: null,
      selectedTaskId: null,
    }));
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  function openReview(task: TaskJob) {
    if (!task.review) return;
    const tab: EditorTab = {
      id: `diff:${task.id}`,
      kind: "diff",
      title: `Changes (${task.review.files.length})`,
      taskId: task.id,
      iteration: task.reviewIteration,
    };
    setTabs((current) => [
      ...current.filter((entry) => entry.id !== tab.id),
      tab,
    ]);
    setActiveTabId(tab.id);
    setSelectedTaskId(task.id);
    persistRepositoryWorkspace((current) => ({
      ...current,
      activeTabId: tab.id,
      selectedTaskId: task.id,
      openDiffTaskIds: current.openDiffTaskIds.includes(task.id)
        ? current.openDiffTaskIds
        : [...current.openDiffTaskIds, task.id],
    }));
    if (!task.review.diff && task.review.files.length) {
      void ensureReviewDiff(task.id);
    }
  }

  async function openRepositoryForGit() {
    if (!selectedRepository) return;
    setBusy("open-repository");
    setError("");
    try {
      await localRequest(`/v1/repositories/${selectedRepository.id}/editor`, {
        method: "POST",
        body: JSON.stringify({ editor: status?.editors.preferred?.id }),
      });
    } catch (reason) {
      setError(String((reason as Error).message ?? reason));
    } finally {
      setBusy("");
    }
  }

  async function openTaskGitDialog(
    mode: "commit" | "push" | "draft-pr",
  ) {
    if (!selectedTask) return;
    setBusy("git-preview");
    setError("");
    try {
      const preview = await localRequest<GitPreview>(
        `/v1/tasks/${selectedTask.id}/git`,
      );
      setGitPreview(preview);
      setCommitMessage(preview.git?.message ?? preview.defaultCommitMessage);
      const title = selectedTask.prompt
        .trim()
        .split(/\r?\n/)[0]
        .replace(/[.!?]+$/, "");
      setPullRequestTitle(title.slice(0, 120));
      setPullRequestSummary(
        [
          "## Summary",
          selectedTask.prompt.trim(),
          "",
          "## Verification",
          selectedTask.review?.checks || "No verification output was recorded.",
        ].join("\n"),
      );
      setPullRequestBase("main");
      setGitDialogMode(mode);
    } catch (reason) {
      setError(String((reason as Error).message ?? reason));
    } finally {
      setBusy("");
    }
  }

  async function submitTaskGitAction() {
    if (!selectedTask || !gitDialogMode) return;
    const action = gitDialogMode;
    setBusy(`git:${action}`);
    setError("");
    try {
      const body =
        action === "commit"
          ? { message: commitMessage }
          : action === "push"
            ? { confirmed: true }
            : {
                title: pullRequestTitle,
                summary: pullRequestSummary,
                base: pullRequestBase,
              };
      const result = await localRequest<{
        job: TaskJob;
        repository?: Repository;
      }>(`/v1/tasks/${selectedTask.id}/git/${action}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setTasks((current) =>
        current.map((task) => (task.id === result.job.id ? result.job : task)),
      );
      if (result.repository) {
        setRepositories((current) =>
          current.map((repository) =>
            repository.id === selectedRepositoryId
              ? { ...repository, ...result.repository }
              : repository,
          ),
        );
      } else {
        await refreshAll(selectedRepositoryId);
      }
      setGitDialogMode(null);
      setGitPreview(null);
    } catch (reason) {
      setError(String((reason as Error).message ?? reason));
    } finally {
      setBusy("");
    }
  }

  async function startTask(promptOverride?: string) {
    const taskPrompt = promptOverride?.trim() || prompt.trim();
    if (!selectedRepository || !taskPrompt) return;
    setBusy("start");
    setError("");
    try {
      const result = !promptOverride && replyingToTask && selectedTask
        ? await localRequest<{ job: TaskJob }>(
            `/v1/tasks/${selectedTask.id}/message`,
            {
              method: "POST",
              body: JSON.stringify({ message: taskPrompt }),
            },
          )
        : await localRequest<{ job: TaskJob; intent: "chat" | "code" }>(
            "/v1/tasks/start",
            {
              method: "POST",
              body: JSON.stringify({
                path: selectedRepository.path,
                prompt: taskPrompt,
                intent: "auto",
                routingMode: settings.routingMode,
                strategy: settings.strategy,
                agentConfig: { codex: settings.codex, claude: settings.claude },
                contextPolicy: {
                  enabled: useContextForTask,
                  tokenBudget: taskContextBudget,
                  graphify: settings.context.graphify,
                },
                skills: {
                  mode: skillMode,
                  selected: skillMode === "explicit" ? selectedSkills : [],
                },
                goal: goalEnabled
                  ? {
                      enabled: true,
                      objective: taskPrompt,
                      tokenBudget: goalTokenBudget,
                      autoContinue: true,
                      maxContinuations: 6,
                    }
                  : null,
              }),
            },
          );
      setPrompt("");
      setSelectedTaskId(result.job.id);
      setDraftingNew(false);
      setTaskView("conversation");
      const taskTab: EditorTab = {
        id: `task:${result.job.id}`,
        kind: "task",
        title: taskWindowTitle(result.job, [...repositoryTasks, result.job]),
        taskId: result.job.id,
      };
      setTabs((current) =>
        current.some((tab) => tab.id === taskTab.id)
          ? current
          : [...current, taskTab],
      );
      setActiveTabId(taskTab.id);
      setTasks((current) => [
        result.job,
        ...current.filter((job) => job.id !== result.job.id),
      ]);
    } catch (reason) {
      setError(String((reason as Error).message ?? reason));
    } finally {
      setBusy("");
    }
  }

  function closeComposerMenus() {
    setAgentMenuOpen(false);
    setSkillMenuOpen(false);
    setContextMenuOpen(false);
    setGitHubMenuOpen(false);
  }

  async function taskAction(action: "accept" | "reject" | "cancel") {
    if (!selectedTask) return;
    setBusy(action);
    try {
      await localRequest(`/v1/tasks/${selectedTask.id}/${action}`, { method: "POST" });
      await refreshAll();
    } catch (reason) {
      setError(String((reason as Error).message ?? reason));
    } finally {
      setBusy("");
    }
  }

  async function pauseOrResumeGoal(action: "pause" | "resume") {
    if (!selectedTask?.goal) return;
    setBusy(action);
    setError("");
    try {
      const result = await localRequest<{ job: TaskJob }>(
        `/v1/tasks/${selectedTask.id}/${action}`,
        { method: "POST" },
      );
      setTasks((current) =>
        current.map((task) => (task.id === result.job.id ? result.job : task)),
      );
      await refreshAll();
    } catch (reason) {
      setError(String((reason as Error).message ?? reason));
    } finally {
      setBusy("");
    }
  }

  async function editGoal(task: TaskJob) {
    if (!task.goal) return;
    const objective = window.prompt("Goal objective", task.goal.objective);
    if (objective == null || !objective.trim()) return;
    const budgetText = window.prompt(
      "Token budget",
      String(task.goal.tokenBudget),
    );
    if (budgetText == null) return;
    const tokenBudget = Number(budgetText);
    if (!Number.isFinite(tokenBudget) || tokenBudget < 1_000) {
      setError("Goal token budget must be at least 1,000 tokens.");
      return;
    }
    setBusy("goal-edit");
    setError("");
    try {
      const result = await localRequest<{ job: TaskJob }>(
        `/v1/tasks/${task.id}/goal`,
        {
          method: "POST",
          body: JSON.stringify({ objective: objective.trim(), tokenBudget }),
        },
      );
      setTasks((current) =>
        current.map((candidate) =>
          candidate.id === result.job.id ? result.job : candidate,
        ),
      );
    } catch (reason) {
      setError(String((reason as Error).message ?? reason));
    } finally {
      setBusy("");
    }
  }

  async function clearGoal(task: TaskJob) {
    if (
      !window.confirm(
        "Clear this durable goal? A paused task will need to be restarted before continuing.",
      )
    ) {
      return;
    }
    setBusy("goal-clear");
    setError("");
    try {
      const result = await localRequest<{ job: TaskJob }>(
        `/v1/tasks/${task.id}/goal`,
        { method: "DELETE" },
      );
      setTasks((current) =>
        current.map((candidate) =>
          candidate.id === result.job.id ? result.job : candidate,
        ),
      );
    } catch (reason) {
      setError(String((reason as Error).message ?? reason));
    } finally {
      setBusy("");
    }
  }

  async function dismissClarification(task: TaskJob) {
    if (
      !window.confirm(
        "Dismiss this clarification? The run will close without restarting agents or consuming more quota.",
      )
    ) {
      return;
    }
    setBusy(`dismiss:${task.id}`);
    setError("");
    try {
      const result = await localRequest<{ job: TaskJob }>(
        `/v1/tasks/${task.id}/clarification/dismiss`,
        { method: "POST" },
      );
      setPrompt("");
      setTasks((current) =>
        current.map((candidate) =>
          candidate.id === result.job.id ? result.job : candidate,
        ),
      );
    } catch (reason) {
      setError(String((reason as Error).message ?? reason));
    } finally {
      setBusy("");
    }
  }

  async function archiveTask(task: TaskJob, archived: boolean) {
    setBusy(`${archived ? "archive" : "restore"}:${task.id}`);
    setError("");
    try {
      await localRequest(`/v1/tasks/${task.id}/archive`, {
        method: "POST",
        body: JSON.stringify({ archived }),
      });
      if (archived) closeTaskWindows(task.id);
      await refreshAll();
    } catch (reason) {
      setError(String((reason as Error).message ?? reason));
    } finally {
      setBusy("");
    }
  }

  async function deleteTask(task: TaskJob) {
    if (
      !window.confirm(
        `Permanently delete this task and its local run history?\n\n${task.prompt}`,
      )
    ) {
      return;
    }
    setBusy(`delete:${task.id}`);
    setError("");
    try {
      await localRequest(`/v1/tasks/${task.id}`, { method: "DELETE" });
      closeTaskWindows(task.id);
      await refreshAll();
    } catch (reason) {
      setError(String((reason as Error).message ?? reason));
    } finally {
      setBusy("");
    }
  }

  async function retryTask(stage?: string, updatedPrompt?: string) {
    if (!selectedTask) return;
    setBusy(`retry:${stage ?? "prepare"}`);
    setError("");
    try {
      await localRequest(`/v1/tasks/${selectedTask.id}/retry`, {
        method: "POST",
        body: JSON.stringify({
          stage: stage ?? "prepare",
          prompt: updatedPrompt,
        }),
      });
      await refreshAll();
    } catch (reason) {
      setError(String((reason as Error).message ?? reason));
    } finally {
      setBusy("");
    }
  }

  function editAndRestartTask() {
    if (!selectedTask) return;
    const updated = window.prompt(
      "Edit the task before starting a new attempt",
      selectedTask.prompt,
    );
    if (updated == null || !updated.trim()) return;
    void retryTask("prepare", updated.trim());
  }

  async function requestChanges() {
    if (!selectedTask || !revisionFeedback.trim()) return;
    setBusy("revise");
    try {
      await localRequest(`/v1/tasks/${selectedTask.id}/revise`, {
        method: "POST",
        body: JSON.stringify({ feedback: revisionFeedback }),
      });
      setRevisionFeedback("");
      setRevisionOpen(false);
      await refreshAll();
    } catch (reason) {
      setError(String((reason as Error).message ?? reason));
    } finally {
      setBusy("");
    }
  }

  async function buildContext() {
    if (!selectedRepository) return;
    setBusy("context");
    try {
      await localRequest("/v1/context/generate", {
        method: "POST",
        body: JSON.stringify({
          path: selectedRepository.path,
          reason: "manual",
          context: settings.context,
        }),
      });
      setContextMenuOpen(false);
      await refreshAll();
    } catch (reason) {
      setError(String((reason as Error).message ?? reason));
    } finally {
      setBusy("");
    }
  }

  async function connectRepository(event: FormEvent) {
    event.preventDefault();
    setBusy("connect");
    try {
      const result = await localRequest<{ repository: Repository }>(
        "/v1/repositories/connect",
        {
          method: "POST",
          body: JSON.stringify(
            connectMode === "github"
              ? { url: repositoryInput }
              : { path: repositoryInput },
          ),
        },
      );
      setSelectedRepoId(result.repository.id);
      setRepositoryInput("");
      setConnectOpen(false);
      await refreshAll();
    } catch (reason) {
      setError(String((reason as Error).message ?? reason));
    } finally {
      setBusy("");
    }
  }

  async function disconnectRepository(repository: Repository) {
    if (!window.confirm(`Remove ${repository.name} from Projects? No files will be deleted.`)) {
      return;
    }
    setBusy(`disconnect:${repository.id}`);
    try {
      await localRequest(`/v1/repositories/${repository.id}`, {
        method: "DELETE",
      });
      if (selectedRepoId === repository.id) {
        setSelectedRepoId(null);
        setSelectedTaskId(null);
      }
      await refreshAll();
    } catch (reason) {
      setError(String((reason as Error).message ?? reason));
    } finally {
      setBusy("");
    }
  }

  async function decideApproval(decision: string) {
    if (!pendingApproval) return;
    setBusy("approval");
    try {
      await localRequest(`/v1/tasks/${pendingApproval.id}/approval`, {
        method: "POST",
        body: JSON.stringify({ decision }),
      });
      await refreshAll();
    } catch (reason) {
      setError(String((reason as Error).message ?? reason));
    } finally {
      setBusy("");
    }
  }

  const diffTask =
    activeTab?.kind === "diff"
      ? tasks.find((job) => job.id === activeTab.taskId) ?? null
      : null;
  const taskIsUnread = (task: TaskJob) =>
    task.id !== selectedTask?.id &&
    (selectedRepositoryUi.lastSeenTaskUpdates[task.id] ?? "") < task.updatedAt;
  const commandItems: CommandPaletteItem[] = [
    {
      id: "new-task",
      label: "Start a new task",
      detail: "Task",
      keywords: "new create prompt composer",
      command: "new-task",
    },
    {
      id: "run-tests",
      label: "Run configured tests",
      detail: selectedRepository?.name ?? "Select a repository",
      keywords: "test verify npm suite",
      command: "run-tests",
    },
    {
      id: "open-editor",
      label: "Open repository in configured editor",
      detail: status?.editors.preferred?.name ?? "Editor unavailable",
      keywords: "editor vscode cursor zed repository",
      command: "open-editor",
    },
    ...(["environment", "monitor", "memory"] as TaskCenterView[]).map(
      (view) => ({
        id: `view:${view}`,
        label: `Open ${view[0].toUpperCase()}${view.slice(1)}`,
        detail: selectedTask ? taskWindowTitle(selectedTask, repositoryTasks) : "No task selected",
        keywords: `task view ${view}`,
        command: "open-view" as const,
        value: view,
      }),
    ),
    ...(selectedTask?.review
      ? [
          {
            id: "open-diff",
            label: "Open task diff",
            detail: `${selectedTask.review.files.length} changed files`,
            keywords: "review changes patch diff",
            command: "open-diff" as const,
          },
        ]
      : []),
    ...repositories.map((repository) => ({
      id: `repository:${repository.id}`,
      label: `Switch repository: ${repository.name}`,
      detail: `${repository.branch} · ${repository.path}`,
      keywords: `project repo ${repository.name} ${repository.path}`,
      command: "switch-repository" as const,
      value: repository.id,
    })),
    ...repositoryTasks.map((task) => ({
      id: `task:${task.id}`,
      label: task.prompt,
      detail: `Task · ${jobLabel(task)}`,
      keywords: `task ${task.status} ${task.decision.label}`,
      command: "open-task" as const,
      value: task.id,
    })),
    ...filePaths.map((path) => ({
      id: `file:${path}`,
      label: path,
      detail: "File",
      keywords: `open source ${path}`,
      command: "open-file" as const,
      value: path,
    })),
  ];
  const normalizedCommandQuery = commandQuery.trim().toLowerCase();
  const visibleCommandItems = commandItems
    .filter((item) =>
      !normalizedCommandQuery
        ? true
        : `${item.label} ${item.detail} ${item.keywords}`
            .toLowerCase()
            .includes(normalizedCommandQuery),
    )
    .slice(0, 14);

  function runCommand(item: CommandPaletteItem) {
    setCommandPaletteOpen(false);
    setCommandQuery("");
    setCommandIndex(0);
    if (item.command === "new-task") {
      beginNewTask();
    } else if (item.command === "run-tests") {
      void startTask(
        "Run the repository's configured test suite and report the exact results. Do not modify files.",
      );
    } else if (item.command === "open-editor") {
      void openRepositoryForGit();
    } else if (item.command === "open-view") {
      if (!selectedTask || !item.value) return;
      openTaskWindow(selectedTask);
      selectTaskCenterView(item.value as TaskCenterView, selectedTask.id);
    } else if (item.command === "open-diff") {
      if (selectedTask?.review) openReview(selectedTask);
    } else if (item.command === "switch-repository" && item.value) {
      setSelectedRepoId(item.value);
    } else if (item.command === "open-task" && item.value) {
      const task = repositoryTasks.find((candidate) => candidate.id === item.value);
      if (task) openTaskWindow(task);
    } else if (item.command === "open-file" && item.value) {
      void openFile(item.value);
    }
  }

  return (
    <main
      className="ide-shell"
      data-theme={theme}
      style={
        {
          "--ide-explorer-width": `${uiState.explorerWidth}px`,
        } as CSSProperties
      }
    >
      <WorkspaceErrorBoundary
        boundaryKey={selectedRepositoryId ?? "no-repository"}
        label="Repository explorer"
      >
        <aside className="ide-explorer">
        <header className="ide-explorer-header">
            <img
              alt=""
              className="ide-brand"
              height="31"
              src="/code-council-logo.png"
              width="31"
          />
          <div>
            <strong>code-council</strong>
            <small>Collective coding intelligence</small>
          </div>
        </header>

        <section className="ide-projects">
          <header>
            <span>Projects</span>
            <button
              aria-label="Connect repository"
              onClick={() => setConnectOpen(true)}
              title="Connect repository"
              type="button"
            >
              +
            </button>
          </header>
          <nav aria-label="Connected projects">
            {repositories.map((repository) => {
              const projectTasks = tasks.filter(
                (task) => task.repository === repository.path && !task.archivedAt,
              );
              const running = projectTasks.some(taskIsActive);
              return (
                <div
                  className={repository.id === selectedRepoId ? "active" : ""}
                  key={repository.id}
                >
                  <button
                    className="ide-project-main"
                    onClick={() => setSelectedRepoId(repository.id)}
                    type="button"
                  >
                    <i>{repository.name.slice(0, 1).toUpperCase()}</i>
                    <span>
                      <strong>{repository.name}</strong>
                      <small>
                        {projectTasks.length} task{projectTasks.length === 1 ? "" : "s"} ·{" "}
                        {repository.branch}
                      </small>
                    </span>
                    {running ? <b title="Task running" /> : null}
                  </button>
                  <button
                    aria-label={`Remove ${repository.name} from Projects`}
                    className="ide-project-remove"
                    disabled={busy === `disconnect:${repository.id}`}
                    onClick={() => void disconnectRepository(repository)}
                    title="Remove from Projects"
                    type="button"
                  >
                    ×
                  </button>
                </div>
              );
            })}
            {!repositories.length ? (
              <button
                className="ide-project-empty"
                onClick={() => setConnectOpen(true)}
                type="button"
              >
                + Add your first project
              </button>
            ) : null}
          </nav>
        </section>

        {selectedRepository ? (
          <>
            <div className="ide-repo-meta">
              <span>{selectedRepository.branch}</span>
              <code>{selectedRepository.sha.slice(0, 7)}</code>
              {selectedRepository.dirty ? <i>Modified</i> : null}
            </div>
            <nav className="ide-explorer-tabs" aria-label="Repository navigation">
              <strong>
                Files <span>{filePaths.length}</span>
              </strong>
            </nav>
            <label className="ide-file-search">
              <span>⌕</span>
              <input
                aria-label="Filter files"
                onChange={(event) =>
                  setFileFilter(event.target.value.toLowerCase())
                }
                placeholder="Filter files"
                value={fileFilter}
              />
            </label>
            <nav className="ide-file-tree" aria-label="Repository files">
              {treeState === "loading" ? (
                <div className="ide-tree-state" role="status">
                  <span className="ide-spinner" />
                  Loading files…
                </div>
              ) : treeState === "error" ? (
                <div className="ide-tree-state error" role="alert">
                  <strong>Files unavailable</strong>
                  <p>{treeError}</p>
                  <button
                    onClick={() => setTreeRefreshKey((current) => current + 1)}
                    type="button"
                  >
                    Retry
                  </button>
                </div>
              ) : treeState === "ready" && !tree.length ? (
                <div className="ide-tree-state empty">
                  <strong>No readable files</strong>
                  <p>This repository may be empty or contain only ignored files.</p>
                </div>
              ) : (
                <TreeRows
                  changedFiles={changedFiles}
                  depth={0}
                  expanded={expanded}
                  filter={fileFilter}
                  nodes={tree}
                  onOpen={(path) => void openFile(path)}
                  onToggle={(path) => {
                    if (!selectedRepositoryId) return;
                    setUiState((current) =>
                      toggleExpandedFolder(current, selectedRepositoryId, path),
                    );
                  }}
                />
              )}
            </nav>
          </>
        ) : (
          <div className="ide-no-repo">
            <strong>Connect a repository</strong>
            <p>Browse files, run agents, and review patches without leaving code-council.</p>
            <button onClick={() => setConnectOpen(true)} type="button">
              Connect
            </button>
          </div>
        )}

        <footer className="ide-explorer-footer">
          <div className="ide-usage-mini">
            <div>
              <i className="codex">C</i>
              <span>
                <strong>Codex</strong>
                <small>
                  S {status?.usage.codex.session?.remainingPercent ?? "—"}% · W{" "}
                  {status?.usage.codex.weekly?.remainingPercent ?? "—"}%
                </small>
              </span>
            </div>
            <div>
              <i className="claude">A</i>
              <span>
                <strong>Claude</strong>
                <small>
                  S {status?.usage.claude.session?.remainingPercent ?? "—"}% · W{" "}
                  {status?.usage.claude.weekly?.remainingPercent ?? "—"}%
                </small>
              </span>
            </div>
          </div>
          <div className="ide-runtime-row">
            <span className={status?.ready ? "online" : ""} />
            <strong>Local runtime</strong>
            <button
              disabled={busy === "doctor"}
              onClick={() => void runDoctor()}
              type="button"
            >
              {busy === "doctor" ? "Checking…" : "Doctor"}
            </button>
          </div>
        </footer>
        <div
          aria-label="Resize file explorer"
          aria-orientation="vertical"
          className="ide-explorer-resizer"
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const direction = event.key === "ArrowLeft" ? -1 : 1;
            setUiState((current) => ({
              ...current,
              explorerWidth: Math.max(
                220,
                Math.min(420, current.explorerWidth + direction * 12),
              ),
            }));
          }}
          onPointerDown={beginExplorerResize}
          role="separator"
          tabIndex={0}
        />
        </aside>
      </WorkspaceErrorBoundary>

      <WorkspaceErrorBoundary
        boundaryKey={`${selectedRepositoryId ?? "no-repository"}:${selectedTask?.id ?? "no-task"}`}
        label="Task workspace"
      >
        <section className="ide-workbench">
        <header className="ide-topbar">
          <div>
            <button aria-label="Back" type="button">‹</button>
            <button aria-label="Forward" type="button">›</button>
          </div>
          <p>
            <strong>{selectedRepository?.name ?? "code-council"}</strong>
            {activeTab?.kind === "file" ? (
              <>
                <span>›</span>
                <code>{activeTab.file.path}</code>
              </>
            ) : activeTab?.kind === "diff" ? (
              <>
                <span>›</span>
                <code>Task changes</code>
              </>
            ) : selectedTask ? (
              <>
                <span>›</span>
                <code>{selectedTask.prompt}</code>
              </>
            ) : null}
          </p>
          <div className="ide-top-actions">
            <button
              aria-label="Open command palette"
              className="ide-command-trigger"
              onClick={() => {
                setCommandPaletteOpen(true);
                setCommandQuery("");
                setCommandIndex(0);
              }}
              title="Command palette (Command or Control K)"
              type="button"
            >
              ⌕ <span>⌘K</span>
            </button>
            <button
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              className="ide-theme-button"
              onClick={toggleTheme}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              type="button"
            >
              {theme === "dark" ? "☀" : "☾"}
            </button>
            {status?.tools.gh?.available &&
            /github\.com[/:]/i.test(selectedRepository?.remote ?? "") ? (
              <button
                aria-expanded={githubMenuOpen}
                className="ide-github-button"
                onClick={() => void toggleGitHubWorkspace()}
                type="button"
              >
                GitHub
              </button>
            ) : null}
            {githubMenuOpen ? (
              <div className="ide-github-popover">
                <header>
                  <div>
                    <strong>
                      {githubWorkspace?.repository.nameWithOwner ?? "GitHub workspace"}
                    </strong>
                    <small>
                      Issues, pull requests, reviews and checks without leaving the task flow
                    </small>
                  </div>
                  <button
                    disabled={githubLoading}
                    onClick={() => void refreshGitHubWorkspace()}
                    type="button"
                  >
                    {githubLoading ? "Loading…" : "Refresh"}
                  </button>
                </header>
                {githubError ? (
                  <p className="ide-github-error">{githubError}</p>
                ) : githubLoading && !githubWorkspace ? (
                  <p className="ide-github-empty">Loading GitHub work…</p>
                ) : githubWorkspace ? (
                  <div className="ide-github-columns">
                    <section>
                      <header>
                        <strong>Open issues</strong>
                        <span>{githubWorkspace.issues.length}</span>
                      </header>
                      <div>
                        {githubWorkspace.issues.slice(0, 8).map((issue) => (
                          <article key={issue.number}>
                            <div>
                              <a href={issue.url} rel="noreferrer" target="_blank">
                                #{issue.number} {issue.title}
                              </a>
                              <small>
                                {issue.labels.length
                                  ? issue.labels.join(" · ")
                                  : "No labels"}
                              </small>
                            </div>
                            <button
                              onClick={() =>
                                draftFromGitHub(
                                  `Fix GitHub issue #${issue.number}: ${issue.title}\n\n${issue.body}\n\nSource: ${issue.url}`,
                                  { goal: true },
                                )
                              }
                              type="button"
                            >
                              Start goal
                            </button>
                          </article>
                        ))}
                        {!githubWorkspace.issues.length ? (
                          <p>No open issues.</p>
                        ) : null}
                      </div>
                    </section>
                    <section>
                      <header>
                        <strong>Open pull requests</strong>
                        <span>{githubWorkspace.pullRequests.length}</span>
                      </header>
                      <div>
                        {githubWorkspace.pullRequests.slice(0, 8).map((pullRequest) => (
                          <article key={pullRequest.number}>
                            <div>
                              <a
                                href={pullRequest.url}
                                rel="noreferrer"
                                target="_blank"
                              >
                                #{pullRequest.number} {pullRequest.title}
                              </a>
                              <small>
                                {pullRequest.isDraft ? "Draft" : "Ready"} ·{" "}
                                {pullRequest.checks.failing
                                  ? `${pullRequest.checks.failing} failing`
                                  : pullRequest.checks.pending
                                    ? `${pullRequest.checks.pending} pending`
                                    : `${pullRequest.checks.passing} passing`}
                              </small>
                            </div>
                            <button
                              onClick={() =>
                                draftFromGitHub(
                                  pullRequest.checks.failing
                                    ? `Fix the failing checks on GitHub pull request #${pullRequest.number}: ${pullRequest.title}\n\nInspect the PR, reproduce the failures locally, implement the smallest correct fix, and verify it.\n\nSource: ${pullRequest.url}`
                                    : `Review GitHub pull request #${pullRequest.number}: ${pullRequest.title}\n\nInspect the changes, checks, and repository context. Report concrete correctness risks, regressions, and missing tests without modifying files.\n\nSource: ${pullRequest.url}`,
                                  { goal: pullRequest.checks.failing > 0 },
                                )
                              }
                              type="button"
                            >
                              {pullRequest.checks.failing ? "Fix checks" : "Review"}
                            </button>
                          </article>
                        ))}
                        {!githubWorkspace.pullRequests.length ? (
                          <p>No open pull requests.</p>
                        ) : null}
                      </div>
                    </section>
                  </div>
                ) : null}
              </div>
            ) : null}
            <button
              className={`ide-context-button ${selectedRepository?.context?.status ?? "missing"}`}
              disabled={!selectedRepository}
              onClick={() => {
                setGitHubMenuOpen(false);
                setContextMenuOpen((open) => !open);
              }}
              type="button"
            >
              <i />
              {activeContext
                ? "Context running"
                : selectedRepository?.context?.status === "fresh"
                  ? "Context ready"
                  : selectedRepository?.context?.status === "stale"
                    ? "Context stale"
                    : "Build context"}
            </button>
            {contextMenuOpen && selectedRepository ? (
              <div className="ide-context-popover">
                <strong>Repository context</strong>
                <p>
                  {selectedRepository.context?.documents ?? 0} memory files ·{" "}
                  {settings.context.model} · {settings.context.reasoning}
                </p>
                <div className="ide-context-fields">
                  <select
                    aria-label="Context agent"
                    onChange={(event) => {
                      const provider = event.target.value as "codex" | "claude";
                      const catalog =
                        provider === "codex"
                          ? settingsOptions.codexCatalog
                          : settingsOptions.claudeCatalog;
                      const fallback =
                        provider === "codex"
                          ? settingsOptions.codexModels
                          : settingsOptions.claudeModels;
                      const model =
                        catalog[0]?.model ??
                        fallback[0] ??
                        settings.context.model;
                      void saveSettings({
                        ...settings,
                        context: {
                          ...settings.context,
                          provider,
                          model,
                          reasoning: "high",
                        },
                      });
                    }}
                    value={settings.context.provider}
                  >
                    <option value="codex">Codex</option>
                    <option value="claude">Claude</option>
                  </select>
                  <select
                    aria-label="Context model"
                    onChange={(event) => {
                      const model = event.target.value;
                      void saveSettings({
                        ...settings,
                        context: {
                          ...settings.context,
                          model,
                          reasoning: compatibleReasoning(
                            contextCatalog,
                            model,
                            settings.context.reasoning,
                            contextFallbackReasoning,
                          ),
                        },
                      });
                    }}
                    value={settings.context.model}
                  >
                    {contextModels.map((entry) => (
                      <option key={entry.model} value={entry.model}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Context reasoning"
                    onChange={(event) =>
                      void saveSettings({
                        ...settings,
                        context: {
                          ...settings.context,
                          reasoning: event.target.value,
                        },
                      })
                    }
                    value={settings.context.reasoning}
                  >
                    {reasoningEntries(
                      contextCatalog,
                      settings.context.model,
                      contextFallbackReasoning,
                    ).map((reasoning) => (
                      <option key={reasoning}>{reasoning}</option>
                    ))}
                  </select>
                  <label className="ide-context-budget">
                    <span>
                      Context length budget
                      <output htmlFor="context-token-budget">
                        {taskContextBudget.toLocaleString()} tokens
                      </output>
                    </span>
                    <input
                      aria-label="Context length token budget"
                      aria-valuetext={`${taskContextBudget.toLocaleString()} tokens`}
                      id="context-token-budget"
                      max={64_000}
                      min={256}
                      onBlur={(event) =>
                        void saveSettings({
                          ...settings,
                          context: {
                            ...settings.context,
                            tokenBudget: Number(event.currentTarget.value),
                          },
                        })
                      }
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          context: {
                            ...current.context,
                            tokenBudget: Math.max(
                              256,
                              Math.min(
                                64_000,
                                Number(event.target.value) || 256,
                              ),
                            ),
                          },
                        }))
                      }
                      onKeyUp={(event) => {
                        if (
                          ![
                            "ArrowDown",
                            "ArrowLeft",
                            "ArrowRight",
                            "ArrowUp",
                            "End",
                            "Home",
                            "PageDown",
                            "PageUp",
                          ].includes(event.key)
                        ) {
                          return;
                        }
                        void saveSettings({
                          ...settings,
                          context: {
                            ...settings.context,
                            tokenBudget: Number(event.currentTarget.value),
                          },
                        });
                      }}
                      onPointerUp={(event) =>
                        void saveSettings({
                          ...settings,
                          context: {
                            ...settings.context,
                            tokenBudget: Number(event.currentTarget.value),
                          },
                        })
                      }
                      step={256}
                      type="range"
                      value={taskContextBudget}
                    />
                    <small>Maximum context added to each task</small>
                  </label>
                  <label className="ide-checkbox ide-context-option">
                    <input
                      checked={settings.context.enabledByDefault}
                      onChange={(event) =>
                        void saveSettings({
                          ...settings,
                          context: {
                            ...settings.context,
                            enabledByDefault: event.target.checked,
                          },
                        })
                      }
                      type="checkbox"
                    />
                    Use context for new tasks
                  </label>
                  <label className="ide-checkbox ide-context-option">
                    <input
                      checked={settings.context.graphify}
                      onChange={(event) =>
                        void saveSettings({
                          ...settings,
                          context: {
                            ...settings.context,
                            graphify: event.target.checked,
                          },
                        })
                      }
                      type="checkbox"
                    />
                    Graphify structural retrieval
                  </label>
                  <button
                    disabled={Boolean(activeContext) || busy === "context"}
                    onClick={() => void buildContext()}
                    type="button"
                  >
                    {selectedRepository.context?.status === "fresh"
                      ? "Regenerate"
                      : "Update context"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </header>

        <nav className="ide-tabs" aria-label="Open editor tabs">
          {draftingNew ? (
            <button
              className={activeTabId === null ? "active task" : "task"}
              onClick={() => setActiveTabId(null)}
              type="button"
            >
              <span className="task">＋</span>
              New task
            </button>
          ) : null}
          {tabs.map((tab) => (
            <button
              className={`${tab.id === activeTabId ? "active" : ""} ${tab.kind}`}
              key={tab.id}
              onClick={() => {
                setActiveTabId(tab.id);
                if (tab.kind === "task") {
                  setSelectedTaskId(tab.taskId);
                  setDraftingNew(false);
                  const savedView =
                    selectedRepositoryUi.taskViews[tab.taskId] ?? "conversation";
                  selectTaskCenterView(
                    savedView === "compare" ? "conversation" : savedView,
                    tab.taskId,
                  );
                } else if (tab.kind === "replay") {
                  setSelectedTaskId(tab.taskId);
                  setDraftingNew(false);
                  setTaskView("compare");
                } else if (tab.kind === "diff") {
                  setSelectedTaskId(tab.taskId);
                  setDraftingNew(false);
                }
                persistRepositoryWorkspace((current) => ({
                  ...current,
                  activeTabId: tab.id,
                  selectedTaskId:
                    tab.kind === "task" ||
                    tab.kind === "replay" ||
                    tab.kind === "diff"
                      ? tab.taskId
                      : current.selectedTaskId,
                }));
              }}
              title={
                tab.kind === "task"
                  ? tasks.find((task) => task.id === tab.taskId)?.prompt ?? tab.title
                  : tab.title
              }
              type="button"
            >
              <span className={tab.kind}>
                {tab.kind === "diff"
                  ? "±"
                  : tab.kind === "replay"
                    ? "⇄"
                  : tab.kind === "task"
                    ? "◌"
                    : fileGlyph(tab.title)}
              </span>
              {tab.title}
              <i
                aria-label={`Close ${tab.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab.id);
                }}
                role="button"
                tabIndex={0}
              >
                ×
              </i>
            </button>
          ))}
          <button
            className="ide-new-tab"
            onClick={beginNewTask}
            title="New task"
            type="button"
          >
            +
          </button>
        </nav>

        <section className="ide-editor">
          {activeTab?.kind === "file" ? (
            <CodeEditor file={activeTab.file} />
          ) : activeTab?.kind === "diff" && diffTask ? (
            <DiffEditor
              onComment={(feedback) => {
                setRevisionFeedback(feedback);
                setRevisionOpen(true);
              }}
              task={diffTask}
            />
          ) : (activeTab?.kind === "task" || activeTab?.kind === "replay") &&
            selectedTask &&
            !draftingNew ? (
            <section className="ide-task-workspace">
              <nav className="ide-task-nav" aria-label="Task workspace">
                {activeTab.kind === "task" ? (
                  <>
                    <button
                      className={taskView === "conversation" ? "active" : ""}
                      onClick={() => selectTaskCenterView("conversation")}
                      type="button"
                    >
                      Conversation
                    </button>
                    <button
                      className={taskView === "environment" ? "active" : ""}
                      onClick={() => selectTaskCenterView("environment")}
                      type="button"
                    >
                      Environment
                      {selectedTask.review ? <span>{selectedTask.review.files.length}</span> : null}
                    </button>
                    <button
                      className={taskView === "monitor" ? "active" : ""}
                      onClick={() => selectTaskCenterView("monitor")}
                      type="button"
                    >
                      Monitor
                      {selectedTask.processes.some((process) => process.status === "running") ? <i /> : null}
                    </button>
                    <button
                      className={taskView === "memory" ? "active" : ""}
                      onClick={() => selectTaskCenterView("memory")}
                      type="button"
                    >
                      Memory
                    </button>
                  </>
                ) : null}
                {selectedTask.replay ? (
                  <button
                    className={activeTab.kind === "replay" ? "active" : ""}
                    onClick={() =>
                      activeTab.kind === "replay"
                        ? setTaskView("compare")
                        : openReplayWindow(selectedTask)
                    }
                    type="button"
                  >
                    {activeTab.kind === "replay" ? "Comparison" : "Back to comparison"}
                    <span>{selectedTask.replay.totalVariants}</span>
                  </button>
                ) : null}
              </nav>
              <div className="ide-task-view">
                {activeTab.kind === "replay" && selectedTask.replay ? (
                  <ReplayComparison
                    onDismissClarification={(task) =>
                      void dismissClarification(task)
                    }
                    onOpenTask={(task) => openTaskWindow(task, "conversation")}
                    onReview={openReview}
                    replayId={selectedTask.replay.id}
                    tasks={tasks}
                  />
                ) : taskView === "environment" && selectedRepository ? (
                  <TaskEnvironment
                    ghAvailable={Boolean(status?.tools.gh?.available)}
                    onGitAction={(action) => void openTaskGitDialog(action)}
                    onOpenRepository={() => void openRepositoryForGit()}
                    onReview={() => openReview(selectedTask)}
                    repository={selectedRepository}
                    task={selectedTask}
                  />
                ) : taskView === "monitor" ? (
                  <TaskMonitor
                    busy={busy}
                    now={now}
                    onCancel={() => void taskAction("cancel")}
                    onEditRestart={editAndRestartTask}
                    onRetry={(stage) => void retryTask(stage)}
                    task={selectedTask}
                  />
                ) : taskView === "memory" && selectedRepository ? (
                  <TaskMemory
                    confidence={retrievalConfidence}
                    repository={selectedRepository}
                    settings={settings}
                    task={selectedTask}
                    tokenBudget={taskContextBudget}
                  />
                ) : (
                  <TaskConversation
                    now={now}
                    onReview={() => openReview(selectedTask)}
                    task={selectedTask}
                  />
                )}
              </div>
            </section>
          ) : (
            <div className="ide-editor-welcome">
                    <img
                      alt="code-council collective intelligence mark"
                      className="ide-welcome-mark"
                      height="64"
                src="/code-council-logo.png"
                width="64"
              />
              <h1>{selectedRepository ? selectedRepository.name : "code-council"}</h1>
              <p>
                Ask anything about this repository or describe a code change.
                code-council will chat read-only, ask for missing details, or start an
                isolated coding task.
              </p>
              <div>
                <button
                  disabled={!selectedRepository}
                  onClick={() => composerRef.current?.focus()}
                  type="button"
                >
                  <span>?</span>
                  Ask about the repository
                  <kbd>Read only</kbd>
                </button>
                <button
                  disabled={!selectedRepository}
                  onClick={() => composerRef.current?.focus()}
                  type="button"
                >
                  <span>⌘</span>
                  Start a code change
                  <kbd>Review gated</kbd>
                </button>
              </div>
            </div>
          )}
        </section>

        {selectedTask?.status === "awaiting_review" &&
        activeTab?.kind === "diff" ? (
          <div className="ide-review-strip">
            <div>
              <strong>Patch ready for review</strong>
              <small>The connected repository is unchanged until you accept.</small>
            </div>
            <button
              className="danger"
              disabled={Boolean(busy)}
              onClick={() => void taskAction("reject")}
              type="button"
            >
              Decline
            </button>
            <button
              disabled={Boolean(busy)}
              onClick={() => setRevisionOpen(true)}
              type="button"
            >
              Request changes
            </button>
            <button
              className="primary"
              disabled={Boolean(busy)}
              onClick={() => void taskAction("accept")}
              type="button"
            >
              Accept
            </button>
          </div>
        ) : null}

        {selectedTask && !draftingNew && activeTab?.kind === "task" ? (
          <>
            <GoalBar
              busy={busy}
              onClear={() => void clearGoal(selectedTask)}
              onEdit={() => void editGoal(selectedTask)}
              onPause={() => void pauseOrResumeGoal("pause")}
              onResume={() => void pauseOrResumeGoal("resume")}
              task={selectedTask}
            />
            {selectedTask.skills?.mode === "explicit" &&
            selectedTask.skills.selected.length ? (
              <div className="ide-task-capabilities">
                <strong>Skills</strong>
                {selectedTask.skills.selected.map((skill) => (
                  <span key={`${skill.provider}:${skill.path}`}>
                    {skill.provider === "claude" ? "Claude" : "Codex"} · $
                    {skill.name}
                  </span>
                ))}
              </div>
            ) : null}
          </>
        ) : null}

        <section className="ide-composer">
          {error ? (
            <div className="ide-error" role="alert">
              <span>{error}</span>
              <button onClick={() => setError("")} type="button">×</button>
            </div>
          ) : null}
          <textarea
            aria-label="Message code-council"
            disabled={!selectedRepository}
            onChange={(event) => setPrompt(event.target.value)}
            onFocus={closeComposerMenus}
            onPointerDown={closeComposerMenus}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void startTask();
              }
            }}
            placeholder={
              selectedTask?.status === "awaiting_input" && !draftingNew
                ? "Answer the clarification so the task can continue"
                : selectedTask &&
                    ["queued", "running", "awaiting_approval"].includes(
                      selectedTask.status,
                    ) &&
                    !draftingNew
                  ? "Send an update to the active agent"
                : selectedTask?.kind === "chat" && !draftingNew
                  ? "Reply or ask a follow-up question"
                  : "Ask a question or describe a code change"
            }
            ref={composerRef}
            rows={3}
            value={prompt}
          />
          <footer>
            {replyingToTask ? (
              <span className="ide-reply-mode">
                {selectedTask?.status === "awaiting_input"
                  ? "Clarification reply"
                  : ["queued", "running", "awaiting_approval"].includes(
                        selectedTask?.status ?? "",
                      )
                    ? "Update active task"
                    : "Continue chat"}
              </span>
            ) : null}
            {selectedTask &&
            !draftingNew &&
            ["queued", "running", "awaiting_approval"].includes(
              selectedTask.status,
            ) ? (
              <button
                className="ide-stop-task"
                disabled={selectedTask.cancelRequested || busy === "cancel"}
                onClick={() => void taskAction("cancel")}
                type="button"
              >
                {selectedTask.cancelRequested ? "Stopping…" : "■ Stop"}
              </button>
            ) : null}
            {selectedTask?.goal && !draftingNew && selectedTask.status === "paused" ? (
              <button
                className="ide-resume-task"
                disabled={Boolean(busy)}
                onClick={() => void pauseOrResumeGoal("resume")}
                type="button"
              >
                Resume goal
              </button>
            ) : null}
            {selectedTask?.status === "awaiting_input" && !draftingNew ? (
              <button
                className="ide-dismiss-clarification"
                disabled={busy === `dismiss:${selectedTask.id}`}
                onClick={() => void dismissClarification(selectedTask)}
                title="Close this run without restarting agents"
                type="button"
              >
                {busy === `dismiss:${selectedTask.id}`
                  ? "Dismissing…"
                  : "Dismiss without rerun"}
              </button>
            ) : null}
            <div className="ide-agent-picker">
              <button
                className="ide-agent-trigger"
                onClick={() => {
                  setAgentMenuOpen((open) => !open);
                  setSkillMenuOpen(false);
                  setContextMenuOpen(false);
                }}
                type="button"
              >
                <span className={`ide-agent-avatar ${
                  settings.strategy === "claude_only" ? "claude" : "codex"
                }`}>
                  {settings.strategy === "council_plan_codex_execute"
                    ? "C+A"
                    : settings.strategy === "claude_only"
                      ? "A"
                      : "C"}
                </span>
                <span>
                  <strong>
                    {settings.routingMode === "auto"
                      ? "Auto"
                      : strategyLabel(settings.strategy)}
                  </strong>
                  <small>{strategyDetails(settings)}</small>
                </span>
                <i>⌃</i>
              </button>
              {agentMenuOpen ? (
                <AgentPicker
                  onClose={() => setAgentMenuOpen(false)}
                  onSave={(next) => void saveSettings(next)}
                  options={settingsOptions}
                  settings={settings}
                />
              ) : null}
            </div>
            {!replyingToTask ? (
              <div className="ide-skill-picker">
                <button
                  className={`ide-task-context-toggle ${
                    skillMode === "explicit" ? "active" : ""
                  }`}
                  onClick={() => {
                    setSkillMenuOpen((open) => !open);
                    setAgentMenuOpen(false);
                    setContextMenuOpen(false);
                  }}
                  title={
                    skillMode === "auto"
                      ? "Each selected agent discovers relevant skills automatically"
                      : `${selectedSkills.length} explicit skills selected`
                  }
                  type="button"
                >
                  {skillMode === "auto"
                    ? "Skills · Auto"
                    : `Skills · ${selectedSkills.length}`}
                </button>
                {skillMenuOpen ? (
                  <div className="ide-skill-popover">
                    <header>
                      <div>
                        <strong>Agent skills</strong>
                        <small>Native Codex and Claude workflows available here</small>
                      </div>
                      <button
                        aria-label="Close skills"
                        onClick={() => setSkillMenuOpen(false)}
                        type="button"
                      >
                        ×
                      </button>
                    </header>
                    <button
                      className={skillMode === "auto" ? "active" : ""}
                      onClick={() => {
                        setSkillMode("auto");
                        setSelectedSkillPaths([]);
                      }}
                      type="button"
                    >
                      <span>Auto-select</span>
                      <small>Let each active agent choose from its native skills.</small>
                    </button>
                    <div className="ide-skill-list">
                      {availableSkills.map((skill) => {
                        const checked = selectedSkillPaths.includes(skill.path);
                        return (
                          <label key={`${skill.provider}:${skill.path}`}>
                            <input
                              checked={checked}
                              onChange={() => {
                                setSkillMode("explicit");
                                setSelectedSkillPaths((current) =>
                                  checked
                                    ? current.filter((path) => path !== skill.path)
                                    : [...current, skill.path],
                                );
                              }}
                              type="checkbox"
                            />
                            <span>
                              <strong>
                                <i className={`ide-skill-provider ${skill.provider}`}>
                                  {skill.provider === "claude" ? "Claude" : "Codex"}
                                </i>
                                ${skill.name}
                              </strong>
                              <small>
                                {skill.description} · {skill.scope}
                              </small>
                            </span>
                          </label>
                        );
                      })}
                      {!skillCatalog ? (
                        <p>{skillError || "Loading available skills…"}</p>
                      ) : availableSkills.length === 0 ? (
                        <p>
                          {skillCatalog.errors[0]?.message ??
                            "No enabled skills were found for the selected agents."}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            {!replyingToTask ? (
              <>
                <button
                  aria-pressed={goalEnabled}
                  className={`ide-task-context-toggle ${
                    goalEnabled ? "active ide-goal-toggle" : ""
                  }`}
                  onClick={() => {
                    setGoalEnabled((enabled) => !enabled);
                    setAgentMenuOpen(false);
                    setSkillMenuOpen(false);
                  }}
                  title="Persist the objective and continue within a bounded token budget"
                  type="button"
                >
                  {goalEnabled ? "Goal · On" : "Goal"}
                </button>
                {goalEnabled ? (
                  <label className="ide-goal-budget">
                    <span>Budget</span>
                    <input
                      aria-label="Goal token budget"
                      max={1_000_000}
                      min={1_000}
                      onChange={(event) =>
                        setGoalTokenBudget(Number(event.target.value))
                      }
                      step={1_000}
                      type="number"
                      value={goalTokenBudget}
                    />
                  </label>
                ) : null}
              </>
            ) : null}
            {!replyingToTask ? (
              <button
                aria-pressed={useContextForTask}
                className={`ide-task-context-toggle ${
                  useContextForTask ? "active" : ""
                }`}
                onClick={() => setUseContextForTask((current) => !current)}
                title={
                  useContextForTask
                    ? `Task capsule enabled (${taskContextBudget.toLocaleString()} token budget)`
                    : "Task will run without generated repository context"
                }
                type="button"
              >
                {useContextForTask
                  ? `Context · ${compactTokens(taskContextBudget)}`
                  : "Context off"}
              </button>
            ) : null}
            {!replyingToTask ? (
              <button
                className="ide-replay-trigger"
                disabled={
                  !selectedRepository ||
                  !prompt.trim() ||
                  busy === "replay-intent"
                }
                onClick={() => void openReplayDialog()}
                title="Compare automatically inferred read-only or coding runs"
                type="button"
              >
                {busy === "replay-intent" ? "Detecting…" : "Compare"}
              </button>
            ) : null}
            <span className="ide-context-hint">
              {!useContextForTask && !replyingToTask
                ? "Agents inspect source directly"
                : selectedTask?.kind === "chat"
                ? "Questions stay read-only"
                : selectedRepository?.context?.status === "fresh"
                  ? "code-council infers chat or code · context ready"
                  : "code-council infers chat or code · review before apply"}
            </span>
            <button
              aria-label="Run task"
              className="ide-send-button"
              disabled={
                !selectedRepository ||
                !prompt.trim() ||
                busy === "start" ||
                selectedConversationBusy ||
                !agentsReady
              }
              onClick={() => void startTask()}
              title={
                replyingToTask
                  ? "Send update (Enter)"
                  : "Run task (Enter, Shift+Enter for newline)"
              }
              type="button"
            >
              {busy === "start" ? "…" : "↑"}
            </button>
          </footer>
        </section>
        </section>
      </WorkspaceErrorBoundary>

      <aside className="ide-inspector">
        <nav>
          <strong className="ide-inspector-title">
            Tasks
            {activeRepositoryTasks.some(taskIsActive) ? <i /> : null}
          </strong>
          <button
            aria-label="New task"
            disabled={!selectedRepository}
            onClick={beginNewTask}
            title="New task"
            type="button"
          >
            +
          </button>
        </nav>

        {rightTab === "memory" ? (
          <div className="ide-memory-pane">
            <section>
              <span className={`ide-memory-state ${selectedRepository?.context?.status ?? "missing"}`} />
              <div>
                <strong>Repository context</strong>
                <p>
                  {selectedRepository?.context?.status ?? "missing"} ·{" "}
                  {selectedRepository?.context?.documents ?? 0} documents
                </p>
              </div>
            </section>
            <dl>
              <div>
                <dt>Generator</dt>
                <dd>{selectedRepository?.context?.model ?? settings.context.model}</dd>
              </div>
              <div>
                <dt>Reasoning</dt>
                <dd>{settings.context.reasoning}</dd>
              </div>
              <div>
                <dt>Context used</dt>
                <dd>
                  {selectedTask?.contextPolicy?.enabled === false
                    ? "Disabled for this task"
                    : selectedTask?.contextPack
                    ? `≈${selectedTask.contextPack.estimatedTokens.toLocaleString()} / ${(selectedTask.contextPack.budgetTokens ?? selectedTask.contextPolicy?.tokenBudget ?? taskContextBudget).toLocaleString()} tokens`
                    : "Not selected yet"}
                </dd>
              </div>
              <div>
                <dt>Retrieval</dt>
                <dd>
                  {selectedTask?.contextPack?.graphify
                    ? `Graphify ${selectedTask.contextPack.graphify.status}${
                        selectedTask.contextPack.graphify.matchedPaths?.length
                          ? ` · ${selectedTask.contextPack.graphify.matchedPaths.length} files`
                          : ""
                      }${
                        selectedTask.contextPack.graphify.cacheHit
                          ? " · cached"
                          : ""
                      }${
                        retrievalConfidence
                          ? ` · ${Math.round(retrievalConfidence.score * 100)}% confidence`
                          : ""
                      }`
                    : settings.context.graphify
                      ? "Graphify enabled"
                      : "Ranked memory only"}
                </dd>
              </div>
              <div>
                <dt>Total usage</dt>
                <dd>
                  {selectedTask?.usage?.totals
                    ? `${selectedTask.usage.totals.totalTokens.toLocaleString()} tokens · ${selectedTask.usage.totals.calls} calls · ${compactDuration(selectedTask.usage.totals.durationMs)}${selectedTask.usage.totals.costUsd > 0 ? ` · $${selectedTask.usage.totals.costUsd.toFixed(4)}` : ""}`
                    : "No calls recorded"}
                </dd>
              </div>
            </dl>
            {selectedTask?.contextPack?.retrieval ? (
              <section className="ide-context-used">
                <header>
                  <div>
                    <strong>Context used</strong>
                    <p>
                      A bounded task capsule assembled before the agent call.
                    </p>
                  </div>
                  {retrievalConfidence ? (
                    <span
                      className={`ide-confidence-badge ${retrievalConfidence.level}`}
                      title={retrievalConfidence.reasons.join(" ")}
                    >
                      {retrievalConfidence.level === "disabled"
                        ? "Off"
                        : `${Math.round(retrievalConfidence.score * 100)}% ${retrievalConfidence.level}`}
                    </span>
                  ) : null}
                </header>
                <div>
                  <span>
                    <strong>
                      {selectedTask.contextPack.retrieval.selectedDocuments}
                    </strong>
                    memory docs
                  </span>
                  <span>
                    <strong>
                      {selectedTask.contextPack.graphify?.matchedPaths?.length ?? 0}
                    </strong>
                    source paths
                  </span>
                  <span>
                    <strong>
                      {selectedTask.contextPack.retrieval.graphifyCalls}
                    </strong>
                    graph calls
                  </span>
                  <span>
                    <strong>
                      {compactDuration(
                        selectedTask.contextPack.retrieval.graphifyDurationMs,
                      )}
                    </strong>
                    retrieval
                  </span>
                </div>
                <p className="ide-context-decision">
                  {selectedTask.contextPack.retrieval.graphifyCacheHit
                    ? "Reused the repository-fingerprint cache; no Graphify process was started for this task."
                    : selectedTask.contextPack.retrieval.adaptiveFollowup
                      ? "Initial evidence was below the confidence threshold, so code-council ran one bounded structural follow-up."
                      : "Initial evidence cleared the confidence gate; no additional graph query was needed."}
                </p>
              </section>
            ) : null}
            {selectedTask?.usage?.totals ? (
              <section className="ide-usage-comparison">
                {(["codex", "claude"] as const).map((agent) => {
                  const usage = selectedTask.usage?.byAgent?.[agent];
                  return (
                    <div key={agent}>
                      <span className={`ide-agent-avatar ${agent}`}>
                        {agent === "codex" ? "C" : "A"}
                      </span>
                      <div>
                        <strong>{agent === "codex" ? "Codex" : "Claude"}</strong>
                        <p>
                          {usage
                            ? `${usage.totalTokens.toLocaleString()} tokens · ${usage.calls} calls · ${compactDuration(usage.durationMs)}${usage.costUsd > 0 ? ` · $${usage.costUsd.toFixed(4)}` : ""}`
                            : "No calls"}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <p>
                  Context supplied:{" "}
                  {selectedTask.usage.totals.contextTokens.toLocaleString()} tokens.
                  Reported usage is used when the CLI exposes it; otherwise code-council
                  labels the estimate.
                </p>
              </section>
            ) : null}
            {selectedTask?.contextPack ? (
              <>
                {selectedTask.contextPack.graphify?.operations?.length ||
                selectedTask.contextPack.graphify?.matchedPaths?.length ? (
                  <details className="ide-run-details">
                    <summary>
                      Graphify retrieval
                      <span>
                        {selectedTask.contextPack.graphify.requestCount ?? 0} requests
                      </span>
                    </summary>
                    {selectedTask.contextPack.graphify.operations?.map(
                      (operation, index) => (
                        <div className="ide-graph-operation" key={`${operation.operation}:${index}`}>
                          <span>
                            {operation.followup ? "Follow-up" : "Initial"} · {operation.operation}
                          </span>
                          <p>{operation.input}</p>
                          <small>
                            {operation.status}
                            {operation.cacheHit ? " · cached" : ""} · {operation.matchedPaths.length} paths · {compactDuration(operation.durationMs)}
                          </small>
                        </div>
                      ),
                    )}
                    {selectedTask.contextPack.graphify.matchedPaths?.length ? (
                    <ul>
                      {selectedTask.contextPack.graphify.matchedPaths.map(
                        (file) => (
                          <li key={file}>{file}</li>
                        ),
                      )}
                    </ul>
                    ) : null}
                  </details>
                ) : null}
                <details className="ide-run-details" open>
                  <summary>
                    Selected memory
                    <span>
                      {selectedTask.contextPack.strategy?.replaceAll("_", " ")}
                    </span>
                  </summary>
                  <ul>
                    {(selectedTask.contextPack.selectedPaths ?? []).map((file) => {
                      const evidence =
                        selectedTask.contextPack?.selectedEvidence?.find(
                          (entry) => entry.path === file,
                        );
                      const source =
                        evidence && evidence.graphScore >= evidence.lexicalScore
                          ? "graph"
                          : evidence?.lexicalScore
                            ? "terms"
                            : "core";
                      return (
                        <li className="capsule-source" key={file}>
                          <span>{file}</span>
                          <small>
                            {source}
                            {evidence?.estimatedTokens
                              ? ` · ≈${evidence.estimatedTokens.toLocaleString()} tok`
                              : ""}
                            {evidence?.truncated ? " · clipped" : ""}
                          </small>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              </>
            ) : null}
          </div>
        ) : rightTab === "tasks" ? (
          <div className="ide-right-tasks">
            <header className="ide-right-tasks-header">
              <div>
                <strong>Task windows</strong>
                <small>
                  {activeRepositoryTasks.length} active · {archivedRepositoryTasks.length} archived
                </small>
              </div>
              <div className="ide-task-header-actions">
                <button
                  aria-label={`${uiState.notificationsEnabled ? "Disable" : "Enable"} desktop task notifications`}
                  aria-pressed={uiState.notificationsEnabled}
                  className={uiState.notificationsEnabled ? "active" : ""}
                  onClick={() => void toggleDesktopNotifications()}
                  title="Notifications for input, approvals, failures, and review"
                  type="button"
                >
                  {uiState.notificationsEnabled ? "Alerts on" : "Alerts"}
                </button>
                <button disabled={!selectedRepository} onClick={beginNewTask} type="button">
                  New task
                </button>
              </div>
            </header>
            <div className="ide-task-filters" role="group" aria-label="Filter tasks">
              {(
                [
                  ["active", "Active"],
                  ["needs_input", "Needs input"],
                  ["review", "Review"],
                  ["failed", "Failed"],
                  ["archived", "Archived"],
                ] as Array<[TaskListFilter, string]>
              ).map(([value, label]) => (
                <button
                  aria-pressed={taskFilter === value}
                  className={taskFilter === value ? "active" : ""}
                  key={value}
                  onClick={() => selectTaskFilter(value)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="ide-right-task-list">
              {status &&
              (!status.tools.codex?.available ||
                !status.tools.claude?.available ||
                status.tools.codex?.authenticated === false ||
                status.tools.claude?.authenticated === false) ? (
                <section className="ide-agent-setup">
                  <strong>Finish agent setup</strong>
                  <p>Install missing CLIs locally, then sign in with your own account.</p>
                  {!status.tools.codex?.available ? (
                    <button
                      disabled={busy === "install:codex"}
                      onClick={() => void installAgent("codex")}
                      type="button"
                    >
                      {busy === "install:codex" ? "Installing…" : "Install Codex"}
                    </button>
                  ) : null}
                  {!status.tools.claude?.available ? (
                    <button
                      disabled={busy === "install:claude"}
                      onClick={() => void installAgent("claude")}
                      type="button"
                    >
                      {busy === "install:claude" ? "Installing…" : "Install Claude Code"}
                    </button>
                  ) : null}
                  {status.tools.codex?.available && status.tools.codex.authenticated === false ? (
                    <code>Terminal: {status.tools.codex.loginCommand}</code>
                  ) : null}
                  {status.tools.claude?.available && status.tools.claude.authenticated === false ? (
                    <code>Terminal: {status.tools.claude.loginCommand}</code>
                  ) : null}
                </section>
              ) : null}
              {activeContext ? (
                <section className="ide-context-run ide-context-run-compact">
                  <header>
                    <span className="ide-live-dot" />
                    <div>
                      <strong>Building repository context</strong>
                      <small>{activeContext.model} · {activeContext.effort} · survives refresh</small>
                    </div>
                  </header>
                </section>
              ) : null}
              {filteredRepositoryTasks.map((task) => (
                <div
                  className={`ide-right-task-row ${task.id === selectedTask?.id ? "active" : ""} ${task.archivedAt ? "archived" : ""} ${taskIsUnread(task) ? "unread" : ""}`}
                  key={task.id}
                >
                  <button
                    className="ide-right-task-main"
                    onClick={() => openTaskWindow(task)}
                    type="button"
                  >
                    <span className={`ide-job-dot ${task.status}`} />
                    <span>
                      <strong>{task.prompt}</strong>
                      <small>
                        {task.kind === "chat" ? "Chat" : task.decision.label} · {jobLabel(task)}
                        {taskIsUnread(task) ? " · Unread" : ""}
                        {task.usage?.totals?.totalTokens
                          ? ` · ${compactTokens(task.usage.totals.totalTokens)} tokens`
                          : ""}
                      </small>
                    </span>
                    <time>{shortTime(task.updatedAt)}</time>
                  </button>
                  <div className="ide-task-row-actions">
                    <button
                      aria-label={`${task.archivedAt ? "Restore" : "Archive"} ${task.prompt}`}
                      disabled={busy === `archive:${task.id}` || taskIsActive(task)}
                      onClick={() => void archiveTask(task, !task.archivedAt)}
                      title={taskIsActive(task) ? "Stop the task before archiving" : task.archivedAt ? "Restore task" : "Archive task"}
                      type="button"
                    >
                      {task.archivedAt ? "↟" : "⌄"}
                    </button>
                    <button
                      aria-label={`Delete ${task.prompt}`}
                      disabled={busy === `delete:${task.id}` || taskIsActive(task)}
                      onClick={() => void deleteTask(task)}
                      title={taskIsActive(task) ? "Stop the task before deleting" : "Delete task"}
                      type="button"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
              {!filteredRepositoryTasks.length ? (
                <div className="ide-right-tasks-empty">
                  <strong>No {taskFilter.replaceAll("_", " ")} tasks</strong>
                  <p>{taskFilter === "active" ? "Start a chat or coding task for this repository." : "Tasks matching this filter will appear here."}</p>
                  <button disabled={!selectedRepository} onClick={beginNewTask} type="button">
                    New task
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="ide-monitor-pane">
            {status &&
            (!status.tools.codex?.available ||
              !status.tools.claude?.available ||
              status.tools.codex?.authenticated === false ||
              status.tools.claude?.authenticated === false) ? (
              <section className="ide-agent-setup">
                <strong>Finish agent setup</strong>
                <p>Install missing CLIs locally, then sign in with your own account.</p>
                {!status.tools.codex?.available ? (
                  <button
                    disabled={busy === "install:codex"}
                    onClick={() => void installAgent("codex")}
                    type="button"
                  >
                    {busy === "install:codex" ? "Installing…" : "Install Codex"}
                  </button>
                ) : null}
                {!status.tools.claude?.available ? (
                  <button
                    disabled={busy === "install:claude"}
                    onClick={() => void installAgent("claude")}
                    type="button"
                  >
                    {busy === "install:claude"
                      ? "Installing…"
                      : "Install Claude Code"}
                  </button>
                ) : null}
                {status.tools.codex?.available &&
                status.tools.codex.authenticated === false ? (
                  <code>Terminal: {status.tools.codex.loginCommand}</code>
                ) : null}
                {status.tools.claude?.available &&
                status.tools.claude.authenticated === false ? (
                  <code>Terminal: {status.tools.claude.loginCommand}</code>
                ) : null}
              </section>
            ) : null}
            {activeContext ? (
              <section className="ide-context-run">
                <header>
                  <span className="ide-live-dot" />
                  <div>
                    <strong>Building context</strong>
                    <small>{activeContext.model} · {activeContext.effort}</small>
                  </div>
                </header>
                <ol className="ide-workflow-list">
                  {activeContext.events.map((event, index) => {
                    const process = [...activeContext.processes]
                      .reverse()
                      .find((entry) => entry.stage === event.stage);
                    return (
                      <li key={`${event.at}-${index}`}>
                        <i
                          className={
                            event.stage === activeContext.stage ? "is-live" : ""
                          }
                        />
                        <div>
                          <strong>{event.stage.replaceAll("_", " ")}</strong>
                          <p>{event.message}</p>
                          {process ? (
                            <WorkflowRuntime now={now} process={process} />
                          ) : null}
                        </div>
                        <time>{shortTime(event.at)}</time>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ) : null}
            {selectedTask ? (
              <>
                <header className="ide-task-heading">
                  <span className={`ide-status ${selectedTask.status}`}>
                    {jobLabel(selectedTask)}
                  </span>
                  <h2>{selectedTask.prompt}</h2>
                  <p>
                    {selectedTask.decision.label} ·{" "}
                    {selectedTask.decision.strategy === "claude_only"
                      ? taskAgentSettings(selectedTask, "claude").model
                      : taskAgentSettings(selectedTask, "codex").model}
                  </p>
                  {["queued", "running", "awaiting_approval"].includes(
                    selectedTask.status,
                  ) ? (
                    <button
                      disabled={selectedTask.cancelRequested || busy === "cancel"}
                      onClick={() => void taskAction("cancel")}
                      type="button"
                    >
                      {selectedTask.cancelRequested ? "Stopping…" : "Stop"}
                    </button>
                  ) : null}
                </header>
                {selectedTask.error ? (
                  <div className="ide-task-error">{selectedTask.error}</div>
                ) : null}
                {["failed", "canceled", "conflict"].includes(
                  selectedTask.status,
                ) ? (
                  <div className="ide-retry-actions">
                    {selectedTask.status === "conflict" ? (
                      <>
                        <button
                          disabled={busy.startsWith("retry:")}
                          onClick={() => void retryTask("execute")}
                          type="button"
                        >
                          Refresh patch on latest
                        </button>
                        <button
                          disabled={Boolean(busy)}
                          onClick={() => void taskAction("reject")}
                          type="button"
                        >
                          Discard stale patch
                        </button>
                      </>
                    ) : selectedTask.failedStage ? (
                      <button
                        disabled={busy.startsWith("retry:")}
                        onClick={() =>
                          void retryTask(selectedTask.failedStage ?? undefined)
                        }
                        type="button"
                      >
                        Retry {selectedTask.failedStage.replaceAll("_", " ")}
                      </button>
                    ) : null}
                    <button
                      disabled={busy.startsWith("retry:")}
                      onClick={() => void retryTask("prepare")}
                      type="button"
                    >
                      Restart task
                    </button>
                    <button
                      disabled={busy.startsWith("retry:")}
                      onClick={editAndRestartTask}
                      type="button"
                    >
                      Edit &amp; restart
                    </button>
                  </div>
                ) : null}
                <AgentActivityFeed task={selectedTask} />
                <details className="ide-run-details ide-workflow-history">
                  <summary>
                    Workflow history
                    <span>{selectedTask.events.length} updates</span>
                  </summary>
                  <ol className="ide-workflow-list">
                  {selectedTask.events.map((event, index) => {
                    const process = [...selectedTask.processes]
                      .reverse()
                      .find((entry) => entry.stage === event.stage);
                    const failed =
                      ["failed", "conflict"].includes(selectedTask.status) &&
                      (selectedTask.failedStage === event.stage ||
                        event.stage === "conflict") &&
                      index ===
                        selectedTask.events.findLastIndex(
                          (entry) => entry.stage === event.stage,
                        );
                    return (
                      <li
                        className={failed ? "failed" : ""}
                        key={`${event.at}-${index}`}
                      >
                        <i
                          className={
                            event.stage === selectedTask.stage &&
                            selectedTask.status === "running"
                              ? "is-live"
                              : ""
                          }
                        />
                        <div>
                          <strong>{event.stage.replaceAll("_", " ")}</strong>
                          {process ? (
                            <WorkflowRuntime now={now} process={process} />
                          ) : null}
                        </div>
                        <time>{shortTime(event.at)}</time>
                      </li>
                    );
                  })}
                  {!selectedTask.events.length ? (
                    <li>
                      <i className="is-live" />
                      <div>
                        <strong>{selectedTask.stage.replaceAll("_", " ")}</strong>
                        <p>Waiting for the first workflow update.</p>
                      </div>
                    </li>
                  ) : null}
                  </ol>
                </details>
              </>
            ) : (
              <div className="ide-inspector-empty">
                <span>C+A</span>
                <strong>Task monitor</strong>
                <p>Commands, file operations, PIDs, failures, and retry controls appear here.</p>
              </div>
            )}
          </div>
        )}
      </aside>

      {commandPaletteOpen ? (
        <div className="ide-command-backdrop">
          <section
            aria-label="Command palette"
            aria-modal="true"
            className="ide-command-palette"
            role="dialog"
          >
            <label>
              <span>⌕</span>
              <input
                aria-controls="council-command-results"
                aria-label="Search commands, repositories, tasks, and files"
                autoFocus
                onChange={(event) => {
                  setCommandQuery(event.target.value);
                  setCommandIndex(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setCommandIndex((current) =>
                      visibleCommandItems.length
                        ? (current + 1) % visibleCommandItems.length
                        : 0,
                    );
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setCommandIndex((current) =>
                      visibleCommandItems.length
                        ? (current - 1 + visibleCommandItems.length) %
                          visibleCommandItems.length
                        : 0,
                    );
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    const item = visibleCommandItems[commandIndex];
                    if (item) runCommand(item);
                  }
                }}
                placeholder="Type a command or file name"
                value={commandQuery}
              />
              <kbd>Esc</kbd>
            </label>
            <div id="council-command-results" role="listbox">
              {visibleCommandItems.map((item, index) => (
                <button
                  aria-selected={index === commandIndex}
                  className={index === commandIndex ? "active" : ""}
                  key={item.id}
                  onClick={() => runCommand(item)}
                  onMouseEnter={() => setCommandIndex(index)}
                  role="option"
                  type="button"
                >
                  <span>{item.label}</span>
                  <small>{item.detail}</small>
                </button>
              ))}
              {!visibleCommandItems.length ? (
                <p>No matching commands or files.</p>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {doctorOpen ? (
        <div className="ide-modal-backdrop">
          <section
            aria-label="Setup Doctor"
            aria-modal="true"
            className="ide-modal ide-doctor-modal"
            role="dialog"
          >
            <button
              aria-label="Close"
              className="ide-modal-close"
              onClick={() => setDoctorOpen(false)}
              type="button"
            >
              ×
            </button>
            <span className="ide-modal-kicker">Local setup</span>
            <h2>Setup Doctor</h2>
            <p>
              Non-mutating checks for the runtimes, agents, and local tools used by
              code-council.
            </p>
            {busy === "doctor" && !doctorReport ? (
              <div className="ide-doctor-loading" role="status">
                <span className="ide-spinner" /> Inspecting local tools…
              </div>
            ) : doctorReport ? (
              <>
                <div className={`ide-doctor-summary ${doctorReport.ready ? "ready" : "blocked"}`}>
                  <strong>{doctorReport.ready ? "Ready to run" : "Setup needs attention"}</strong>
                  <span>{doctorReport.summary}</span>
                  <small>
                    {doctorReport.counts.pass} passed · {doctorReport.counts.warn} optional · {doctorReport.counts.fail} blocking
                  </small>
                </div>
                <div className="ide-doctor-checks">
                  {doctorReport.checks.map((check) => (
                    <article className={check.status} key={check.id}>
                      <span>{check.status === "pass" ? "✓" : check.status === "warn" ? "!" : "×"}</span>
                      <div>
                        <header>
                          <strong>{check.label}</strong>
                          {check.version ? <code>{check.version}</code> : null}
                        </header>
                        <p>{check.detail}</p>
                        {check.fix ? <pre>{check.fix}</pre> : null}
                      </div>
                    </article>
                  ))}
                </div>
              </>
            ) : null}
            {error ? <div className="ide-error" role="alert">{error}</div> : null}
            <footer>
              <button onClick={() => setDoctorOpen(false)} type="button">
                Close
              </button>
              <button
                className="primary"
                disabled={busy === "doctor"}
                onClick={() => void runDoctor()}
                type="button"
              >
                {busy === "doctor" ? "Checking…" : "Run again"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {replayOpen ? (
        <div className="ide-modal-backdrop">
          <section
            aria-label="Council Replay"
            aria-modal="true"
            className="ide-modal ide-replay-modal"
            role="dialog"
          >
            <button
              aria-label="Close"
              className="ide-modal-close"
              onClick={() => setReplayOpen(false)}
              type="button"
            >
              ×
            </button>
            <span className="ide-modal-kicker">Evaluation</span>
            <h2>
              {replayIntent === "chat"
                ? "Compare read-only answers"
                : replayIntent === "code"
                  ? "Compare the same code change"
                  : "Compare the same request"}
            </h2>
            <p>
              {replayIntent === "chat"
                ? "Both variants inspect the same source snapshot in read-only mode. No worktrees or patches are created."
                : replayIntent === "code"
                  ? "Both variants use the same source snapshot and separate worktrees. Review the patches before accepting either result."
                  : "Intent is inferred automatically from the prompt when the comparison starts."}
            </p>
            <div
              className={`ide-replay-intent ${
                replayIntent === "chat" ? "chat" : replayIntent === "code" ? "code" : ""
              }`}
            >
              <strong>
                {replayIntent === "chat"
                  ? "Read-only question"
                  : replayIntent === "code"
                    ? "Code change"
                    : "Automatic intent"}
              </strong>
              <span>No mode selection required</span>
            </div>
            <label>
              {replayIntent === "chat"
                ? "Repository question"
                : replayIntent === "code"
                  ? "Coding task"
                  : "Request"}
              <textarea
                onChange={(event) => {
                  setPrompt(event.target.value);
                  setReplayIntent(null);
                }}
                rows={4}
                value={prompt}
              />
            </label>
            <div className="ide-replay-variants">
              {replayVariants.map((variant, index) => (
                <fieldset key={index}>
                  <legend>Variant {index + 1}</legend>
                  <label>
                    Label
                    <input
                      maxLength={80}
                      onChange={(event) =>
                        updateReplayVariant(index, { label: event.target.value })
                      }
                      value={variant.label}
                    />
                  </label>
                  <label>
                    Strategy
                    <select
                      onChange={(event) => {
                        const strategy = event.target.value as Strategy;
                        updateReplayVariant(index, {
                          strategy,
                          label:
                            strategy === "codex_only"
                              ? "Codex only"
                              : strategy === "claude_only"
                                ? "Claude only"
                                : "Codex + Claude council",
                        });
                      }}
                      value={variant.strategy}
                    >
                      <option value="codex_only">Codex only</option>
                      <option value="claude_only">Claude only</option>
                      {replayIntent !== "chat" ? (
                        <option value="council_plan_codex_execute">
                          Codex + Claude council
                        </option>
                      ) : null}
                    </select>
                  </label>
                  {variant.strategy !== "claude_only" ? (
                    <label>
                      Codex model
                      <select
                        onChange={(event) => {
                          const model = event.target.value;
                          updateReplayVariant(index, {
                            codexModel: model,
                            codexReasoning: compatibleReasoning(
                              settingsOptions.codexCatalog,
                              model,
                              variant.codexReasoning ?? settings.codex.reasoning,
                              settingsOptions.codexReasoning,
                            ),
                          });
                        }}
                        value={variant.codexModel ?? settings.codex.model}
                      >
                        {replayCodexModels.map((entry) => (
                          <option key={entry.model} value={entry.model}>
                            {entry.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {variant.strategy !== "claude_only" ? (
                    <label>
                      Codex intelligence
                      <select
                        onChange={(event) =>
                          updateReplayVariant(index, {
                            codexReasoning: event.target.value,
                          })
                        }
                        value={
                          variant.codexReasoning ?? settings.codex.reasoning
                        }
                      >
                        {reasoningEntries(
                          settingsOptions.codexCatalog,
                          variant.codexModel ?? settings.codex.model,
                          settingsOptions.codexReasoning,
                        ).map((reasoning) => (
                          <option key={reasoning} value={reasoning}>
                            {reasoning}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {variant.strategy !== "codex_only" ? (
                    <label>
                      Claude model
                      <select
                        onChange={(event) => {
                          const model = event.target.value;
                          updateReplayVariant(index, {
                            claudeModel: model,
                            claudeReasoning: compatibleReasoning(
                              settingsOptions.claudeCatalog,
                              model,
                              variant.claudeReasoning ?? settings.claude.reasoning,
                              settingsOptions.claudeReasoning,
                            ),
                          });
                        }}
                        value={variant.claudeModel ?? settings.claude.model}
                      >
                        {replayClaudeModels.map((entry) => (
                          <option key={entry.model} value={entry.model}>
                            {entry.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {variant.strategy !== "codex_only" ? (
                    <label>
                      Claude intelligence
                      <select
                        onChange={(event) =>
                          updateReplayVariant(index, {
                            claudeReasoning: event.target.value,
                          })
                        }
                        value={
                          variant.claudeReasoning ?? settings.claude.reasoning
                        }
                      >
                        {reasoningEntries(
                          settingsOptions.claudeCatalog,
                          variant.claudeModel ?? settings.claude.model,
                          settingsOptions.claudeReasoning,
                        ).map((reasoning) => (
                          <option key={reasoning} value={reasoning}>
                            {reasoning}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <label className="ide-checkbox">
                    <input
                      checked={variant.contextEnabled}
                      onChange={(event) =>
                        updateReplayVariant(index, {
                          contextEnabled: event.target.checked,
                        })
                      }
                      type="checkbox"
                    />
                    Use repository context
                  </label>
                </fieldset>
              ))}
            </div>
            {replayNeedsClaude && !claudeReady ? (
              <div className="ide-task-error">
                Authenticate Claude Code before starting a Claude or council variant.
              </div>
            ) : null}
            {error ? <div className="ide-error" role="alert">{error}</div> : null}
            <footer>
              <button onClick={() => setReplayOpen(false)} type="button">
                Cancel
              </button>
              <button
                className="primary"
                disabled={
                  busy === "replay" ||
                  !prompt.trim() ||
                  (replayNeedsCodex && !codexReady) ||
                  (replayNeedsClaude && !claudeReady)
                }
                onClick={() => void startReplay()}
                type="button"
              >
                {busy === "replay" ? "Starting…" : "Start comparison"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {connectOpen ? (
        <div className="ide-modal-backdrop">
          <section className="ide-modal" role="dialog" aria-modal="true">
            <button
              aria-label="Close"
              className="ide-modal-close"
              onClick={() => setConnectOpen(false)}
              type="button"
            >
              ×
            </button>
            <span className="ide-modal-kicker">Workspace</span>
            <h2>Connect a repository</h2>
            <p>Local paths, credentials, tasks, and context remain on this machine.</p>
            <div className="ide-modal-tabs">
              <button
                className={connectMode === "local" ? "active" : ""}
                onClick={() => setConnectMode("local")}
                type="button"
              >
                Local folder
              </button>
              <button
                className={connectMode === "github" ? "active" : ""}
                onClick={() => setConnectMode("github")}
                type="button"
              >
                GitHub
              </button>
            </div>
            <form onSubmit={connectRepository}>
              <label>
                {connectMode === "local" ? "Absolute repository path" : "GitHub URL"}
                <input
                  autoFocus
                  onChange={(event) => setRepositoryInput(event.target.value)}
                  placeholder={
                    connectMode === "local"
                      ? "/Users/you/code/project"
                      : "https://github.com/owner/repository"
                  }
                  required
                  value={repositoryInput}
                />
              </label>
              <label className="ide-checkbox">
                <input
                  checked={settings.autoBuildContext}
                  onChange={(event) =>
                    void saveSettings({
                      ...settings,
                      autoBuildContext: event.target.checked,
                    })
                  }
                  type="checkbox"
                />
                Build repository context after connecting
              </label>
              <footer>
                <button onClick={() => setConnectOpen(false)} type="button">
                  Cancel
                </button>
                <button className="primary" disabled={busy === "connect"} type="submit">
                  {busy === "connect" ? "Connecting…" : "Connect"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}

      {revisionOpen && selectedTask ? (
        <div className="ide-modal-backdrop">
          <section className="ide-modal" role="dialog" aria-modal="true">
            <button
              aria-label="Close"
              className="ide-modal-close"
              onClick={() => setRevisionOpen(false)}
              type="button"
            >
              ×
            </button>
            <span className="ide-modal-kicker">Patch review</span>
            <h2>Request additional changes</h2>
            <p>The task stays in its isolated worktree for another iteration.</p>
            <label>
              Review feedback
              <textarea
                autoFocus
                onChange={(event) => setRevisionFeedback(event.target.value)}
                placeholder="Describe the behavior, file, or test evidence to change."
                rows={6}
                value={revisionFeedback}
              />
            </label>
            <footer>
              <button onClick={() => setRevisionOpen(false)} type="button">
                Cancel
              </button>
              <button
                className="primary"
                disabled={!revisionFeedback.trim() || busy === "revise"}
                onClick={() => void requestChanges()}
                type="button"
              >
                {busy === "revise" ? "Sending…" : "Send feedback"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {gitDialogMode && selectedTask && gitPreview ? (
        <div className="ide-modal-backdrop">
          <section
            aria-label="Accepted task Git workflow"
            aria-modal="true"
            className="ide-modal ide-git-modal"
            role="dialog"
          >
            <button
              aria-label="Close"
              className="ide-modal-close"
              onClick={() => setGitDialogMode(null)}
              type="button"
            >
              ×
            </button>
            <span className="ide-modal-kicker">Accepted task</span>
            <h2>
              {gitDialogMode === "commit"
                ? "Create a focused commit"
                : gitDialogMode === "push"
                  ? "Confirm push destination"
                  : "Create a draft pull request"}
            </h2>
            {gitDialogMode === "commit" ? (
              <>
                <p>
                  code-council applies this task’s stored patch to the Git index. It
                  refuses to proceed if unrelated staged changes already exist.
                </p>
                <label>
                  Commit message
                  <textarea
                    autoFocus
                    maxLength={500}
                    onChange={(event) => setCommitMessage(event.target.value)}
                    rows={4}
                    value={commitMessage}
                  />
                </label>
                <div className="ide-git-scope">
                  <strong>{selectedTask.review?.files.length ?? 0} task files</strong>
                  <span>{selectedTask.review?.files.join(", ")}</span>
                </div>
              </>
            ) : gitDialogMode === "push" ? (
              <>
                <p>
                  Pushing is never automatic. Confirm the exact remote and
                  destination branch below.
                </p>
                <dl className="ide-git-confirmation">
                  <div><dt>Remote</dt><dd>{gitPreview.repository.remote ?? "Not configured"}</dd></div>
                  <div><dt>Destination</dt><dd>origin/{selectedTask.git?.destinationBranch ?? gitPreview.repository.branch}</dd></div>
                  <div><dt>Commit</dt><dd>{selectedTask.git?.commitSha?.slice(0, 12)}</dd></div>
                </dl>
              </>
            ) : (
              <>
                <p>GitHub CLI will create this as a draft for further review.</p>
                <label>
                  PR title
                  <input
                    autoFocus
                    maxLength={256}
                    onChange={(event) => setPullRequestTitle(event.target.value)}
                    value={pullRequestTitle}
                  />
                </label>
                <label>
                  Base branch
                  <input
                    onChange={(event) => setPullRequestBase(event.target.value)}
                    value={pullRequestBase}
                  />
                </label>
                <label>
                  Summary
                  <textarea
                    onChange={(event) => setPullRequestSummary(event.target.value)}
                    rows={9}
                    value={pullRequestSummary}
                  />
                </label>
              </>
            )}
            {error ? <div className="ide-error" role="alert">{error}</div> : null}
            <footer>
              <button onClick={() => setGitDialogMode(null)} type="button">
                Cancel
              </button>
              <button
                className="primary"
                disabled={
                  busy.startsWith("git:") ||
                  (gitDialogMode === "commit" && !commitMessage.trim()) ||
                  (gitDialogMode === "draft-pr" &&
                    (!pullRequestTitle.trim() || !pullRequestSummary.trim()))
                }
                onClick={() => void submitTaskGitAction()}
                type="button"
              >
                {busy.startsWith("git:")
                  ? "Working…"
                  : gitDialogMode === "commit"
                    ? "Create commit"
                    : gitDialogMode === "push"
                      ? `Push to origin/${selectedTask.git?.destinationBranch ?? gitPreview.repository.branch}`
                      : "Create draft PR"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {pendingApproval?.approval ? (
        <div className="ide-modal-backdrop">
          <section className="ide-modal" role="dialog" aria-modal="true">
            <span className="ide-modal-kicker">Approval required</span>
            <h2>Codex needs permission</h2>
            <p>{pendingApproval.approval.reason ?? "Review this requested action."}</p>
            {pendingApproval.approval.command ? (
              <pre>{pendingApproval.approval.command}</pre>
            ) : null}
            <footer>
              <button onClick={() => void decideApproval("decline")} type="button">
                Deny
              </button>
              <button
                className="primary"
                onClick={() => void decideApproval("accept")}
                type="button"
              >
                Allow once
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  );
}
