/* eslint-disable @next/next/no-img-element -- Vinext serves this bundled logo directly; Next image optimization is unavailable in this runtime. */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CopyPathButton } from "./copy-path-button";
import { localRequest } from "./local-request";

type Tool = {
  id: string;
  available: boolean;
  version: string | null;
  authenticated: boolean | null;
  loginCommand: string | null;
};

type Repository = {
  id: string;
  name: string;
  path: string;
  source: "local" | "github";
  sourceUrl: string | null;
  branch: string;
  sha: string;
  dirty: boolean;
  trackedFiles: number;
  error?: string | null;
  context: {
    status: "missing" | "fresh" | "stale";
    generatedAt: string | null;
    documents: number;
    model: string | null;
  } | null;
};

type AgentSettings = {
  model: string;
  reasoning: string;
};

type Settings = {
  routingMode: "manual" | "auto";
  strategy: "codex_only" | "claude_only" | "council_plan_codex_execute";
  autoBuildContext: boolean;
  codex: AgentSettings;
  claude: AgentSettings;
  context: AgentSettings & { provider: "claude" | "codex" };
};

type SettingsOptions = {
  codexModels: string[];
  codexReasoning: string[];
  claudeModels: string[];
  claudeReasoning: string[];
  codexCatalog: ModelOption[];
  claudeCatalog: ModelOption[];
  discoveredAt: string | null;
  contextProviders: Array<"claude" | "codex">;
};

type ModelOption = {
  model: string;
  label: string;
  description: string;
  reasoning: string[];
  isDefault?: boolean;
};

type Decision = {
  strategy: "codex_only" | "claude_only" | "council_plan_codex_execute";
  label: string;
  reason: string;
  stages: string[];
  agents: string[];
  routingMode: "manual" | "auto";
};

type JobEvent = { stage: string; message: string; at: string };

type AgentProcess = {
  id: string;
  pid: number;
  agent: "codex" | "claude" | string;
  stage: string;
  command: string;
  status: "running" | "complete" | "failed" | "stopped" | "interrupted";
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  signal: string | null;
  outputTail: string;
};

type Approval = {
  id: string;
  kind: string;
  command: string | null;
  reason: string | null;
  cwd: string;
  status: "pending" | "decided";
  requestedAt: string;
  agent: string;
  stage: string;
};

type TaskJob = {
  id: string;
  repository: string;
  repositoryName: string;
  prompt: string;
  decision: Decision;
  agentConfig: { codex: AgentSettings; claude: AgentSettings };
  status:
    | "queued"
    | "running"
    | "awaiting_approval"
    | "awaiting_review"
    | "accepted"
    | "rejected"
    | "canceled"
    | "failed";
  stage: string;
  createdAt: string;
  updatedAt: string;
  events: JobEvent[];
  processes: AgentProcess[];
  approval: Approval | null;
  cancelRequested: boolean;
  contextPack: null | {
    selectedPaths: string[];
    chars: number;
    estimatedTokens: number;
    status: string;
  };
  workspace: null | { path: string; branch: string; cleanedAt?: string };
  review: null | {
    stat: string;
    files: string[];
    diff: string;
    diffTruncated: boolean;
    checks: string;
  };
  reviewIteration: number;
  reviewHistory: Array<{
    iteration: number;
    feedback: string;
    at: string;
  }>;
  result: null | {
    execution?: string;
    proposal?: string;
    critique?: string;
    plan?: string;
    judgment?: string;
  };
  contextRefreshJobId: string | null;
  error: string | null;
};

type ContextJob = {
  id: string;
  repository: string;
  repositoryName: string;
  status: "queued" | "running" | "complete" | "canceled" | "failed";
  stage: string;
  reason: string;
  taskId: string | null;
  provider: "claude" | "codex";
  model: string;
  effort: string;
  createdAt: string;
  updatedAt: string;
  events: JobEvent[];
  processes: AgentProcess[];
  result: null | {
    generation: "initial" | "incremental";
    documents: number;
    updatedDocuments: string[];
    deletedDocuments: string[];
  };
  error: string | null;
};

type UsageWindow = {
  usedPercent: number;
  remainingPercent: number;
  resetsAt: string | null;
  durationMinutes: number | null;
};

type AgentUsage = {
  status: string;
  plan: string | null;
  session: UsageWindow | null;
  weekly: UsageWindow | null;
  message: string | null;
};

type Status = {
  ready: boolean;
  tools: Record<string, Tool>;
  runtime: { ready: boolean };
  usage: {
    codex: AgentUsage;
    claude: AgentUsage;
    retrievedAt: string;
  };
  editors: {
    available: boolean;
    preferred: null | { id: string; name: string; line: boolean };
    editors: Array<{ id: string; name: string; line: boolean }>;
  };
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
  },
};

const FALLBACK_OPTIONS: SettingsOptions = {
  codexModels: [
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
  ],
  codexReasoning: [
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "ultra",
  ],
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
  codexCatalog: [
    {
      model: "gpt-5.6-sol",
      label: "GPT-5.6 Sol",
      description: "Frontier coding model",
      reasoning: ["low", "medium", "high", "xhigh", "max", "ultra"],
    },
    {
      model: "gpt-5.6-terra",
      label: "GPT-5.6 Terra",
      description: "Balanced coding model",
      reasoning: ["low", "medium", "high", "xhigh", "max", "ultra"],
    },
    {
      model: "gpt-5.6-luna",
      label: "GPT-5.6 Luna",
      description: "Fast coding model",
      reasoning: ["low", "medium", "high", "xhigh", "max"],
    },
  ],
  claudeCatalog: [
    {
      model: "claude-opus-4-8",
      label: "Claude Opus 4.8",
      description: "Pinned quality-first model",
      reasoning: ["low", "medium", "high", "xhigh", "max"],
    },
  ],
  discoveredAt: null,
  contextProviders: ["claude", "codex"],
};

function modelOptions(catalog: ModelOption[], models: string[], current: string) {
  const entries = catalog.length
    ? catalog
    : models.map((model) => ({
        model,
        label: model,
        description: "",
        reasoning: [],
      }));
  return entries.some((entry) => entry.model === current)
    ? entries
    : [
        {
          model: current,
          label: current,
          description: "Current saved selection",
          reasoning: [],
        },
        ...entries,
      ];
}

function reasoningOptions(
  catalog: ModelOption[],
  model: string,
  fallback: string[],
) {
  const supported = catalog.find((entry) => entry.model === model)?.reasoning;
  return supported?.length ? supported : fallback;
}

function compatibleReasoning(
  catalog: ModelOption[],
  model: string,
  current: string,
  fallback: string[],
) {
  const supported = reasoningOptions(catalog, model, fallback);
  if (supported.includes(current)) return current;
  if (supported.includes("high")) return "high";
  if (supported.includes("medium")) return "medium";
  return supported[0] ?? current;
}

function shortTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function resetLabel(value: string | null) {
  if (!value) return "";
  return `Resets ${new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))}`;
}

function elapsed(start: string, end: string | null, now: number) {
  const seconds = Math.max(
    0,
    Math.floor(((end ? new Date(end).getTime() : now) - new Date(start).getTime()) / 1000),
  );
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function friendlyOutput(value: string) {
  const output: string[] = [];
  let partialMessage = "";
  const flushPartial = () => {
    if (!partialMessage.trim()) return;
    output.push(partialMessage.trim());
    partialMessage = "";
  };
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.replace(/^\[stderr\]\s*/, "");
    if (!line.trim()) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      if (!/ignoring interface\.icon_|PATH aliases/i.test(line)) output.push(line);
      continue;
    }
    const method = String(event.method ?? "");
    const params = event.params as Record<string, unknown> | undefined;
    const item = params?.item as Record<string, unknown> | undefined;
    if (method === "turn/started") {
      flushPartial();
      output.push("Turn started");
    }
    if (method === "item/agentMessage/delta" && params?.delta) {
      partialMessage += String(params.delta);
    }
    if (method === "item/started" && item?.type === "commandExecution") {
      flushPartial();
      output.push(`$ ${String(item.command ?? "command")}`);
    }
    if (method === "item/completed" && item?.type === "commandExecution") {
      flushPartial();
      const commandOutput = String(item.aggregatedOutput ?? "").trim();
      if (commandOutput) output.push(commandOutput);
      if (item.exitCode != null) output.push(`exit ${String(item.exitCode)}`);
    }
    if (method === "item/completed" && item?.type === "agentMessage" && item.text) {
      flushPartial();
      output.push(String(item.text));
    }
    if (event.type === "system" && event.subtype === "init") {
      output.push(`Session started · ${String(event.model ?? "Claude")}`);
    }
    if (event.type === "assistant") {
      flushPartial();
      const message = event.message as Record<string, unknown> | undefined;
      const content = Array.isArray(message?.content) ? message.content : [];
      for (const block of content as Array<Record<string, unknown>>) {
        if (block.type === "text" && block.text) output.push(String(block.text));
        if (block.type === "tool_use" && block.name) {
          output.push(`tool · ${String(block.name)}`);
        }
      }
    }
    if (event.type === "result" && event.result) output.push(String(event.result));
  }
  flushPartial();
  return output.join("\n").trim().slice(-14_000);
}

type DiffLine = {
  kind: "add" | "remove" | "context" | "meta";
  content: string;
  oldLine?: number;
  newLine?: number;
};

type DiffHunk = {
  header: string;
  lines: DiffLine[];
};

type DiffFile = {
  oldPath: string;
  newPath: string;
  displayPath: string;
  status: "added" | "deleted" | "modified" | "renamed";
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
};

function cleanDiffPath(value: string) {
  const path = value.split("\t")[0]?.trim() ?? value;
  return path === "/dev/null" ? path : path.replace(/^[ab]\//, "");
}

function parseUnifiedDiff(value: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  const ensureHunk = () => {
    if (!file) return null;
    if (!hunk) {
      hunk = { header: "File metadata", lines: [] };
      file.hunks.push(hunk);
    }
    return hunk;
  };

  for (const line of String(value ?? "").split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      const oldPath = match?.[1] ?? "unknown";
      const newPath = match?.[2] ?? oldPath;
      file = {
        oldPath,
        newPath,
        displayPath: newPath,
        status: "modified",
        additions: 0,
        deletions: 0,
        hunks: [],
      };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    if (line.startsWith("new file mode ")) {
      file.status = "added";
      ensureHunk()?.lines.push({ kind: "meta", content: line });
      continue;
    }
    if (line.startsWith("deleted file mode ")) {
      file.status = "deleted";
      ensureHunk()?.lines.push({ kind: "meta", content: line });
      continue;
    }
    if (line.startsWith("rename from ")) {
      file.status = "renamed";
      file.oldPath = line.slice("rename from ".length);
      ensureHunk()?.lines.push({ kind: "meta", content: line });
      continue;
    }
    if (line.startsWith("rename to ")) {
      file.status = "renamed";
      file.newPath = line.slice("rename to ".length);
      file.displayPath = file.newPath;
      ensureHunk()?.lines.push({ kind: "meta", content: line });
      continue;
    }
    if (line.startsWith("--- ")) {
      file.oldPath = cleanDiffPath(line.slice(4));
      if (file.oldPath === "/dev/null") file.status = "added";
      continue;
    }
    if (line.startsWith("+++ ")) {
      file.newPath = cleanDiffPath(line.slice(4));
      if (file.newPath === "/dev/null") file.status = "deleted";
      file.displayPath =
        file.newPath === "/dev/null" ? file.oldPath : file.newPath;
      continue;
    }
    if (line.startsWith("@@")) {
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      oldLine = Number(match?.[1] ?? 0);
      newLine = Number(match?.[2] ?? 0);
      hunk = { header: line, lines: [] };
      file.hunks.push(hunk);
      continue;
    }

    const target = ensureHunk();
    if (!target) continue;
    if (line.startsWith("+")) {
      target.lines.push({
        kind: "add",
        content: line.slice(1),
        newLine: newLine++,
      });
      file.additions += 1;
    } else if (line.startsWith("-")) {
      target.lines.push({
        kind: "remove",
        content: line.slice(1),
        oldLine: oldLine++,
      });
      file.deletions += 1;
    } else if (line.startsWith(" ")) {
      target.lines.push({
        kind: "context",
        content: line.slice(1),
        oldLine: oldLine++,
        newLine: newLine++,
      });
    } else if (line) {
      target.lines.push({ kind: "meta", content: line });
    }
  }
  return files;
}

function DiffViewer({
  diff,
  editorName,
  onOpenFile,
}: {
  diff: string;
  editorName?: string;
  onOpenFile?: (file: string, line: number) => void;
}) {
  const files = useMemo(() => parseUnifiedDiff(diff), [diff]);
  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);
  if (!files.length) {
    return <div className="diff-empty">No source changes</div>;
  }
  return (
    <div className="diff-viewer">
      <header className="diff-summary">
        <strong>{files.length} changed {files.length === 1 ? "file" : "files"}</strong>
        <span className="diff-add">+{additions}</span>
        <span className="diff-remove">−{deletions}</span>
      </header>
      {files.map((changedFile, fileIndex) => (
        <details
          className="diff-file"
          key={`${changedFile.displayPath}-${fileIndex}`}
          open={fileIndex < 4}
        >
          <summary>
            <span className={`diff-status ${changedFile.status}`}>
              {changedFile.status.slice(0, 1).toUpperCase()}
            </span>
            <code>{changedFile.displayPath}</code>
            <span className="diff-file-counts">
              <i>+{changedFile.additions}</i>
              <b>−{changedFile.deletions}</b>
            </span>
            {onOpenFile && changedFile.status !== "deleted" ? (
              <button
                className="open-editor-button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const line =
                    changedFile.hunks
                      .flatMap((hunk) => hunk.lines)
                      .find((entry) => entry.newLine)?.newLine ?? 1;
                  onOpenFile(changedFile.displayPath, line);
                }}
                type="button"
              >
                Open{editorName ? ` in ${editorName}` : ""}
              </button>
            ) : null}
            {changedFile.status !== "deleted" ? (
              <CopyPathButton path={changedFile.displayPath} />
            ) : null}
          </summary>
          <div className="diff-code">
            {changedFile.hunks.map((changedHunk, hunkIndex) => (
              <div className="diff-hunk" key={`${changedHunk.header}-${hunkIndex}`}>
                <div className="diff-hunk-header">{changedHunk.header}</div>
                {changedHunk.lines.map((line, lineIndex) => (
                  <div
                    className={`diff-line ${line.kind}`}
                    key={`${line.kind}-${lineIndex}`}
                  >
                    <span className="diff-line-number">{line.oldLine ?? ""}</span>
                    <span className="diff-line-number">{line.newLine ?? ""}</span>
                    <span className="diff-marker">
                      {line.kind === "add"
                        ? "+"
                        : line.kind === "remove"
                          ? "−"
                          : " "}
                    </span>
                    <code>{line.content || " "}</code>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

function jobLabel(job: TaskJob) {
  if (job.status === "awaiting_review") return "Review";
  if (job.status === "awaiting_approval") return "Needs approval";
  if (job.cancelRequested) return "Canceling";
  if (job.status === "canceled") return "Canceled";
  if (job.status === "failed") return "Failed";
  if (job.status === "accepted") return "Accepted";
  if (job.status === "rejected") return "Rejected";
  return job.stage.replaceAll("_", " ");
}

function RepoGlyph({ name }: { name: string }) {
  return <span className="repo-glyph">{name.slice(0, 1).toUpperCase()}</span>;
}

function AgentBadge({ agent }: { agent: string }) {
  return (
    <span className={`agent-badge ${agent}`}>
      {agent === "claude" ? "A" : "C"}
    </span>
  );
}

function UsageCard({
  agent,
  label,
  usage,
}: {
  agent: "codex" | "claude";
  label: string;
  usage: AgentUsage | undefined;
}) {
  const windows: Array<["Session" | "Weekly", UsageWindow | null]> = [
    ["Session", usage?.session ?? null],
    ["Weekly", usage?.weekly ?? null],
  ];
  return (
    <section className="usage-card">
      <header>
        <AgentBadge agent={agent} />
        <strong>{label}</strong>
        {usage?.plan ? <small>{usage.plan}</small> : null}
      </header>
      <div className="usage-windows">
        {windows.map(([windowLabel, window]) => (
          <div className="usage-window" key={windowLabel}>
            <span>
              <small>{windowLabel}</small>
              <strong>{window ? `${window.remainingPercent}% left` : "—"}</strong>
            </span>
            <i aria-hidden="true">
              <b style={{ width: `${window?.remainingPercent ?? 0}%` }} />
            </i>
            {window?.resetsAt ? <em>{resetLabel(window.resetsAt)}</em> : null}
          </div>
        ))}
      </div>
      {!usage?.session && !usage?.weekly && usage?.message ? (
        <p>{usage.message}</p>
      ) : null}
    </section>
  );
}

function ProcessCard({
  process,
  now,
}: {
  process: AgentProcess;
  now: number;
}) {
  const output = friendlyOutput(process.outputTail);
  const readable = output.split(/\r?\n/).filter(Boolean).slice(-6).join("\n");
  return (
    <article className={`activity-message ${process.status}`}>
      <AgentBadge agent={process.agent} />
      <div className="activity-message-body">
        <header>
          <div>
            <strong>{process.agent === "claude" ? "Claude Code" : "Codex"}</strong>
            <span>{process.stage.replaceAll("_", " ")}</span>
          </div>
          <span className={`activity-status ${process.status}`}>
            {process.status === "running" ? <i className="live-dot" /> : null}
            {process.status}
          </span>
        </header>
        <pre className="activity-copy">{readable || "Starting agent…"}</pre>
        <details className="activity-details">
          <summary>
            PID {process.pid} · {elapsed(process.startedAt, process.endedAt, now)}
            {output ? " · Full output" : ""}
          </summary>
          {output ? (
            <pre aria-label={`${process.agent} full output`}>{output}</pre>
          ) : null}
        </details>
      </div>
    </article>
  );
}

function ApprovalModal({
  job,
  busy,
  onDecision,
}: {
  job: TaskJob;
  busy: boolean;
  onDecision: (decision: string) => void;
}) {
  const approval = job.approval;
  if (!approval || approval.status !== "pending") return null;
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        aria-labelledby="approval-title"
        aria-modal="true"
        className="modal approval-modal"
        role="dialog"
      >
        <div className="modal-symbol warning">!</div>
        <p className="modal-kicker">Agent approval</p>
        <h2 id="approval-title">Codex needs your permission</h2>
        <p>
          Task <strong>{job.prompt}</strong> is paused at{" "}
          <strong>{approval.stage}</strong>.
        </p>
        {approval.command ? (
          <div className="approval-command">
            <span>Command</span>
            <code>{approval.command}</code>
          </div>
        ) : null}
        <div className="approval-command">
          <span>Reason</span>
          <p>{approval.reason || "This action crosses the current sandbox boundary."}</p>
        </div>
        <div className="modal-actions">
          <button
            className="secondary-button danger-text"
            disabled={busy}
            onClick={() => onDecision("cancel")}
            type="button"
          >
            Cancel task
          </button>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => onDecision("decline")}
            type="button"
          >
            Deny
          </button>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => onDecision("acceptForSession")}
            type="button"
          >
            Allow for run
          </button>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => onDecision("accept")}
            type="button"
          >
            Allow once
          </button>
        </div>
      </section>
    </div>
  );
}

export default function CouncilApp() {
  const [status, setStatus] = useState<Status | null>(null);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [tasks, setTasks] = useState<TaskJob[]>([]);
  const [contexts, setContexts] = useState<ContextJob[]>([]);
  const [settings, setSettings] = useState<Settings>(FALLBACK_SETTINGS);
  const [settingsOptions, setSettingsOptions] =
    useState<SettingsOptions>(FALLBACK_OPTIONS);
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionFeedback, setRevisionFeedback] = useState("");
  const [connectOpen, setConnectOpen] = useState(false);
  const [repoPendingDelete, setRepoPendingDelete] = useState<Repository | null>(
    null,
  );
  const [repoSidebarCollapsed, setRepoSidebarCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [connectMode, setConnectMode] = useState<"local" | "github">("local");
  const [repositoryInput, setRepositoryInput] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const selectedRepository = useMemo(
    () => repositories.find((repository) => repository.id === selectedRepoId) ?? null,
    [repositories, selectedRepoId],
  );
  const repositoryTasks = useMemo(
    () => tasks.filter((job) => job.repository === selectedRepository?.path),
    [tasks, selectedRepository],
  );
  const repositoryContexts = useMemo(
    () => contexts.filter((job) => job.repository === selectedRepository?.path),
    [contexts, selectedRepository],
  );
  const selectedTask = useMemo(
    () => {
      if (newTaskOpen) return null;
      return (
        tasks.find(
          (job) =>
            job.id === selectedTaskId &&
            job.repository === selectedRepository?.path,
        ) ??
        repositoryTasks[0] ??
        null
      );
    },
    [tasks, selectedTaskId, selectedRepository, repositoryTasks, newTaskOpen],
  );
  const codexModels = useMemo(
    () =>
      modelOptions(
        settingsOptions.codexCatalog,
        settingsOptions.codexModels,
        settings.codex.model,
      ),
    [settingsOptions, settings.codex.model],
  );
  const claudeModels = useMemo(
    () =>
      modelOptions(
        settingsOptions.claudeCatalog,
        settingsOptions.claudeModels,
        settings.claude.model,
      ),
    [settingsOptions, settings.claude.model],
  );
  const activeContext = repositoryContexts.find((job) =>
    ["queued", "running"].includes(job.status),
  );
  const pendingApproval = tasks.find(
    (job) => job.approval?.status === "pending",
  );
  const activeCount = tasks.filter((job) =>
    ["queued", "running", "awaiting_approval"].includes(job.status),
  ).length;
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
  const contextAgentReady =
    settings.context.provider === "codex" ? codexReady : claudeReady;

  function openNewTask() {
    setSelectedTaskId(null);
    setNewTaskOpen(true);
    setRevisionOpen(false);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  function selectRepository(id: string) {
    setSelectedRepoId(id);
    setSelectedTaskId(null);
    setNewTaskOpen(false);
    setRevisionOpen(false);
  }

  async function refreshAll() {
    const [repositoryResult, taskResult, contextResult] = await Promise.all([
      localRequest<{ repositories: Repository[] }>("/v1/repositories"),
      localRequest<{ jobs: TaskJob[] }>("/v1/tasks"),
      localRequest<{ jobs: ContextJob[] }>("/v1/context/jobs"),
    ]);
    setRepositories(repositoryResult.repositories);
    setTasks((current) =>
      taskResult.jobs.map((job) => {
        const existing = current.find((candidate) => candidate.id === job.id);
        if (
          job.review &&
          !job.review.diff &&
          existing?.review?.diff
        ) {
          return { ...job, review: existing.review };
        }
        return job;
      }),
    );
    setContexts(contextResult.jobs);
    setSelectedRepoId((current) => {
      const saved = window.localStorage.getItem("council.repositoryId");
      const legacyPath = window.localStorage.getItem("council.repositoryPath");
      const valid = repositoryResult.repositories.find(
        (repository) =>
          repository.id === current ||
          repository.id === saved ||
          repository.path === legacyPath,
      );
      return valid?.id ?? repositoryResult.repositories[0]?.id ?? null;
    });
  }

  async function refreshTask(taskId: string) {
    const result = await localRequest<{ job: TaskJob }>(`/v1/tasks/${taskId}`);
    setTasks((current) =>
      current.map((job) => (job.id === result.job.id ? result.job : job)),
    );
  }

  useEffect(() => {
    let canceled = false;
    queueMicrotask(() => {
      Promise.all([
        localRequest<Status>("/v1/status"),
        localRequest<{ settings: Settings; options: SettingsOptions }>("/v1/settings"),
        refreshAll(),
      ])
        .then(([nextStatus, settingsResult]) => {
          if (canceled) return;
          setStatus(nextStatus);
          setSettings(settingsResult.settings);
          setSettingsOptions(settingsResult.options);
        })
        .catch((reason) => {
          if (!canceled) setError(String(reason.message ?? reason));
        });
    });
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void localRequest<Status>("/v1/status")
        .then(setStatus)
        .catch(() => {});
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void refreshAll().catch((reason) =>
        setError(String(reason.message ?? reason)),
      );
      if (selectedTask?.id) {
        void refreshTask(selectedTask.id).catch(() => {});
      }
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [selectedTask?.id]);

  useEffect(() => {
    if (!selectedRepository) return;
    window.localStorage.setItem("council.repositoryId", selectedRepository.id);
  }, [selectedRepository]);

  async function saveSettings(next: Settings) {
    setSettings(next);
    setError("");
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

  async function connectRepository(event: React.FormEvent) {
    event.preventDefault();
    setBusy("connect");
    setError("");
    try {
      const payload =
        connectMode === "github"
          ? { url: repositoryInput }
          : { path: repositoryInput };
      const result = await localRequest<{
        repository: Repository;
        contextJob?: ContextJob;
      }>("/v1/repositories/connect", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setSelectedRepoId(result.repository.id);
      setNewTaskOpen(true);
      setConnectOpen(false);
      setRepositoryInput("");
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
    setError("");
    try {
      await localRequest("/v1/context/generate", {
        method: "POST",
        body: JSON.stringify({ path: selectedRepository.path, reason: "manual" }),
      });
      await refreshAll();
    } catch (reason) {
      setError(String((reason as Error).message ?? reason));
    } finally {
      setBusy("");
    }
  }

  async function disconnectRepository(repository: Repository) {
    setBusy("disconnect");
    setError("");
    try {
      await localRequest(`/v1/repositories/${repository.id}`, {
        method: "DELETE",
      });
      setRepoPendingDelete(null);
      if (repository.id === selectedRepoId) {
        window.localStorage.removeItem("council.repositoryId");
        setSelectedRepoId(null);
        setSelectedTaskId(null);
        setNewTaskOpen(false);
      }
      await refreshAll();
    } catch (reason) {
      setError(String((reason as Error).message ?? reason));
    } finally {
      setBusy("");
    }
  }

  async function startTask() {
    if (!selectedRepository || !prompt.trim()) return;
    setBusy("start");
    setError("");
    try {
      const result = await localRequest<{ job: TaskJob }>("/v1/tasks/start", {
        method: "POST",
        body: JSON.stringify({
          path: selectedRepository.path,
          prompt,
          routingMode: settings.routingMode,
          strategy: settings.strategy,
          agentConfig: {
            codex: settings.codex,
            claude: settings.claude,
          },
        }),
      });
      setPrompt("");
      setSelectedTaskId(result.job.id);
      setNewTaskOpen(false);
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

  async function taskAction(action: "accept" | "reject" | "cancel") {
    if (!selectedTask) return;
    setBusy(action);
    setError("");
    try {
      await localRequest(`/v1/tasks/${selectedTask.id}/${action}`, {
        method: "POST",
      });
      await Promise.all([refreshAll(), refreshTask(selectedTask.id)]);
    } catch (reason) {
      setError(String((reason as Error).message ?? reason));
    } finally {
      setBusy("");
    }
  }

  async function requestChanges() {
    if (!selectedTask || !revisionFeedback.trim()) return;
    setBusy("revise");
    setError("");
    try {
      const result = await localRequest<{ job: TaskJob }>(
        `/v1/tasks/${selectedTask.id}/revise`,
        {
          method: "POST",
          body: JSON.stringify({ feedback: revisionFeedback }),
        },
      );
      setTasks((current) =>
        current.map((job) => (job.id === result.job.id ? result.job : job)),
      );
      setRevisionFeedback("");
      setRevisionOpen(false);
    } catch (reason) {
      setError(String((reason as Error).message ?? reason));
    } finally {
      setBusy("");
    }
  }

  async function openReviewFile(file: string, line: number) {
    if (!selectedTask || !status?.editors?.preferred) return;
    setBusy(`open-${file}`);
    setError("");
    try {
      await localRequest("/v1/editor/open", {
        method: "POST",
        body: JSON.stringify({
          taskId: selectedTask.id,
          file,
          line,
          editor: status.editors.preferred.id,
        }),
      });
    } catch (reason) {
      setError(String((reason as Error).message ?? reason));
    } finally {
      setBusy("");
    }
  }

  async function contextCancel() {
    if (!activeContext) return;
    setBusy("context-cancel");
    try {
      await localRequest(`/v1/context/jobs/${activeContext.id}/cancel`, {
        method: "POST",
      });
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

  async function installAgent(agent: "codex" | "claude") {
    setBusy(`install-${agent}`);
    try {
      await localRequest("/v1/agents/install", {
        method: "POST",
        body: JSON.stringify({ agent }),
      });
      setStatus(await localRequest<Status>("/v1/status"));
    } catch (reason) {
      setError(String((reason as Error).message ?? reason));
    } finally {
      setBusy("");
    }
  }

  return (
    <main
      className={`council-shell${repoSidebarCollapsed ? " repo-sidebar-collapsed" : ""}`}
    >
      <aside
        className={`repo-sidebar${repoSidebarCollapsed ? " is-collapsed" : ""}`}
        id="repository-sidebar"
      >
        <button
          aria-controls="repository-sidebar"
          aria-expanded={!repoSidebarCollapsed}
          aria-label={
            repoSidebarCollapsed
              ? "Expand repository sidebar"
              : "Collapse repository sidebar"
          }
          className="sidebar-toggle"
          onClick={() => setRepoSidebarCollapsed((collapsed) => !collapsed)}
          title={
            repoSidebarCollapsed
              ? "Expand repository sidebar"
              : "Collapse repository sidebar"
          }
          type="button"
        >
          <span aria-hidden="true">{repoSidebarCollapsed ? "›" : "‹"}</span>
        </button>
        <div className="brand-row">
          <img
            alt=""
            className="brand-mark"
            height="30"
            src="/code-council-logo.png"
            width="30"
          />
          <div>
            <strong>code-council</strong>
            <small>Local agent workspaces</small>
          </div>
        </div>
        <button
          className="new-repo-button"
          onClick={() => setConnectOpen(true)}
          type="button"
        >
          <span>＋</span> Connect repository
        </button>
        <div className="sidebar-heading">
          <span>Repositories</span>
          <small>{repositories.length}</small>
        </div>
        <nav className="repo-list" aria-label="Connected repositories">
          {repositories.map((repository) => {
            const repoActive = tasks.filter(
              (job) =>
                job.repository === repository.path &&
                ["queued", "running", "awaiting_approval"].includes(job.status),
            ).length;
            const contextActive = contexts.some(
              (job) =>
                job.repository === repository.path &&
                ["queued", "running"].includes(job.status),
            );
            return (
              <div
                className={`repo-list-item${repository.id === selectedRepoId ? " active" : ""}`}
                key={repository.id}
              >
                <button
                  aria-label={`Select ${repository.name}`}
                  className="repo-select"
                  onClick={() => selectRepository(repository.id)}
                  title={repository.name}
                  type="button"
                >
                  <RepoGlyph name={repository.name} />
                  <span>
                    <strong>{repository.name}</strong>
                    <small>
                      {contextActive
                        ? "Building context"
                        : repository.context?.status === "fresh"
                          ? `${repository.context.documents} context files`
                          : repository.context?.status ?? "Unavailable"}
                    </small>
                  </span>
                  {repoActive ? <em>{repoActive}</em> : null}
                </button>
                <button
                  aria-label={`Disconnect ${repository.name}`}
                  className="repo-delete"
                  onClick={() => setRepoPendingDelete(repository)}
                  title={`Disconnect ${repository.name}`}
                  type="button"
                >
                  <svg
                    aria-hidden="true"
                    fill="none"
                    height="14"
                    viewBox="0 0 16 16"
                    width="14"
                  >
                    <path d="M3.5 4.5h9M6 4.5V3h4v1.5m-5.5 0 .6 8h5.8l.6-8M7 7v3.5m2-3.5v3.5" />
                  </svg>
                </button>
              </div>
            );
          })}
          {!repositories.length ? (
            <p className="empty-sidebar">Connect a local folder or GitHub repository.</p>
          ) : null}
        </nav>
        <section className="usage-panel" aria-label="Agent usage">
          <div className="usage-heading">
            <span>Usage remaining</span>
            <small>Updates every minute</small>
          </div>
          <UsageCard agent="codex" label="Codex" usage={status?.usage?.codex} />
          <UsageCard
            agent="claude"
            label="Claude"
            usage={status?.usage?.claude}
          />
        </section>
        <div className="sidebar-bottom">
          <button
            aria-label="Agent settings"
            onClick={() => setSettingsOpen(true)}
            title="Agent settings"
            type="button"
          >
            <span>⚙</span>
            <span>
              <strong>Agent settings</strong>
              <small>Models & reasoning</small>
            </span>
          </button>
          <div className="runtime-row">
            <span className={status?.ready ? "online" : ""} />
            Local runtime
            {activeCount ? <strong>{activeCount} active</strong> : null}
          </div>
        </div>
      </aside>

      <aside className="task-sidebar">
        <header>
          <div>
            <span className="section-label">Workspaces</span>
            <h1>Tasks can run in parallel.</h1>
          </div>
          <button
            className="new-task-button"
            disabled={!selectedRepository}
            onClick={openNewTask}
            type="button"
          >
            <span>＋</span> New task
          </button>
        </header>
        <div className="task-list">
          {repositoryTasks.map((job) => (
            <button
              className={!newTaskOpen && selectedTask?.id === job.id ? "active" : ""}
              key={job.id}
              onClick={() => {
                setSelectedTaskId(job.id);
                setNewTaskOpen(false);
                setRevisionOpen(false);
              }}
              type="button"
            >
              <span className={`job-dot ${job.status}`} />
              <span className="task-copy">
                <strong>{job.prompt}</strong>
                <small>
                  {job.decision.strategy === "codex_only"
                    ? "Codex"
                    : job.decision.strategy === "claude_only"
                      ? "Claude"
                      : "code-council"}
                  <span>·</span>
                  {jobLabel(job)}
                </small>
              </span>
              <time>{shortTime(job.createdAt)}</time>
            </button>
          ))}
          {!repositoryTasks.length ? (
            <div className="empty-task-list">
              <span>⌘</span>
              <strong>No workspaces yet</strong>
              <p>Start a task without blocking another run.</p>
            </div>
          ) : null}
        </div>
      </aside>

      <section className="main-workspace">
        <header className="workspace-header">
          {selectedRepository ? (
            <>
              <div className="repo-title">
                <RepoGlyph name={selectedRepository.name} />
                <div>
                  <h2>{selectedRepository.name}</h2>
                  <p title={selectedRepository.path}>
                    {selectedRepository.branch} · {selectedRepository.sha.slice(0, 7)}
                    {selectedRepository.dirty ? " · local changes" : ""}
                  </p>
                </div>
              </div>
              <div className="header-actions">
                <span
                  className={`memory-state ${selectedRepository.context?.status ?? "missing"}`}
                  title={
                    selectedRepository.context?.status === "stale"
                      ? "Source changed after this snapshot. Accepted code-council patches refresh context automatically; changes made elsewhere need one manual update."
                      : `${settings.context.provider === "codex" ? "Codex" : "Claude Code"} · ${settings.context.model} · ${settings.context.reasoning}`
                  }
                >
                  <i />
                  {activeContext
                    ? "Context running"
                    : selectedRepository.context?.status === "fresh"
                      ? "Context ready"
                      : selectedRepository.context?.status === "stale"
                        ? "Context out of date"
                        : "No context"}
                </span>
                <button
                  className="secondary-button"
                  disabled={Boolean(activeContext) || !contextAgentReady || busy === "context"}
                  onClick={() => void buildContext()}
                  type="button"
                >
                  {selectedRepository.context?.status === "missing"
                    ? "Build context"
                    : selectedRepository.context?.status === "stale"
                      ? "Update context"
                      : "Regenerate"}
                </button>
              </div>
            </>
          ) : (
            <div className="repo-title">
              <div>
                <h2>Connect your first repository</h2>
                <p>Local folders and GitHub repositories stay on this machine.</p>
              </div>
            </div>
          )}
        </header>

        {error ? (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button onClick={() => setError("")} type="button">Dismiss</button>
          </div>
        ) : null}

        {!codexReady || !claudeReady ? (
          <div className="setup-banner">
            <div>
              <strong>Connect coding agents</strong>
              <span>Install missing CLIs here, then authenticate in their native terminal.</span>
            </div>
            {!status?.tools.codex?.available ? (
              <button
                disabled={busy === "install-codex"}
                onClick={() => void installAgent("codex")}
                type="button"
              >
                Install Codex
              </button>
            ) : null}
            {!status?.tools.claude?.available ? (
              <button
                disabled={busy === "install-claude"}
                onClick={() => void installAgent("claude")}
                type="button"
              >
                Install Claude
              </button>
            ) : null}
            {status?.tools.claude?.authenticated === false ? (
              <code>{status.tools.claude.loginCommand}</code>
            ) : null}
          </div>
        ) : null}

        <div className="workspace-scroll">
          {activeContext ? (
            <section className="context-run-card">
              <header>
                <div>
                  <span className="live-dot" />
                  <strong>Building repository context</strong>
                  <small>
                    {activeContext.provider === "codex" ? "Codex" : "Claude Code"} ·{" "}
                    {activeContext.model} · {activeContext.effort} · persists across refreshes
                  </small>
                </div>
                <button
                  disabled={busy === "context-cancel"}
                  onClick={() => void contextCancel()}
                  type="button"
                >
                  Cancel
                </button>
              </header>
              {activeContext.processes?.map((process) => (
                <ProcessCard key={process.id} now={now} process={process} />
              ))}
              {!activeContext.processes?.length ? (
                <p className="queued-note">
                  Queued. Waiting for{" "}
                  {activeContext.provider === "codex" ? "Codex" : "Claude Code"} to start…
                </p>
              ) : null}
            </section>
          ) : null}

          {selectedTask ? (
            <article className="task-detail">
              <header className="task-title-row">
                <div>
                  <span className={`status-chip ${selectedTask.status}`}>
                    {jobLabel(selectedTask)}
                  </span>
                  <h2>{selectedTask.prompt}</h2>
                  <p>
                    {selectedTask.decision.label} ·{" "}
                    {selectedTask.decision.strategy === "claude_only"
                      ? `${selectedTask.agentConfig?.claude.model ?? settings.claude.model} / ${selectedTask.agentConfig?.claude.reasoning ?? settings.claude.reasoning}`
                      : `${selectedTask.agentConfig?.codex.model ?? settings.codex.model} / ${selectedTask.agentConfig?.codex.reasoning ?? settings.codex.reasoning}`}
                    {selectedTask.decision.strategy ===
                    "council_plan_codex_execute"
                      ? ` · ${selectedTask.agentConfig?.claude.model ?? settings.claude.model} / ${selectedTask.agentConfig?.claude.reasoning ?? settings.claude.reasoning}`
                      : ""}
                  </p>
                </div>
                {["queued", "running", "awaiting_approval"].includes(
                  selectedTask.status,
                ) ? (
                  <button
                    className="cancel-button"
                    disabled={selectedTask.cancelRequested || busy === "cancel"}
                    onClick={() => void taskAction("cancel")}
                    type="button"
                  >
                    {selectedTask.cancelRequested ? "Stopping…" : "Cancel task"}
                  </button>
                ) : null}
              </header>

              {selectedTask.error && selectedTask.status === "failed" ? (
                <div className="task-error">
                  <strong>Task stopped</strong>
                  <p>{selectedTask.error}</p>
                </div>
              ) : null}

              {selectedTask.processes?.length ? (
                <section className="detail-section">
                  <div className="detail-section-title">
                    <h3>Agent activity</h3>
                    <span>
                      {selectedTask.processes.filter((process) => process.status === "running").length}{" "}
                      live
                    </span>
                  </div>
                  <div className="process-grid">
                    {[...selectedTask.processes]
                      .reverse()
                      .slice(0, 6)
                      .map((process) => (
                        <ProcessCard key={process.id} now={now} process={process} />
                      ))}
                  </div>
                </section>
              ) : null}

              <section className="detail-section progress-section">
                <div className="detail-section-title">
                  <h3>Progress</h3>
                  {selectedTask.workspace ? <span>Isolated worktree</span> : null}
                </div>
                <ol>
                  {selectedTask.events.map((event, index) => (
                    <li key={`${event.at}-${index}`}>
                      <i className={index === selectedTask.events.length - 1 ? "current" : ""} />
                      <div>
                        <strong>{event.stage.replaceAll("_", " ")}</strong>
                        <p>{event.message}</p>
                      </div>
                      <time>{shortTime(event.at)}</time>
                    </li>
                  ))}
                </ol>
              </section>

              {selectedTask.contextPack ? (
                <details className="artifact-details">
                  <summary>
                    Shared task context
                    <span>
                      ≈ {selectedTask.contextPack.estimatedTokens.toLocaleString()} tokens
                      per call
                    </span>
                  </summary>
                  <p>
                    {selectedTask.contextPack.selectedPaths.length} relevant files from{" "}
                    <code>agent_context/</code>. The lean council uses four model
                    calls; direct mode uses one.
                  </p>
                  <ul>
                    {selectedTask.contextPack.selectedPaths.map((file) => (
                      <li key={file}>{file}</li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {selectedTask.review ? (
                <section className="detail-section review-section">
                  <div className="detail-section-title">
                    <h3>Patch review</h3>
                    <span>
                      Iteration {selectedTask.reviewIteration ?? 1} ·{" "}
                      {selectedTask.review.files.length} files
                    </span>
                  </div>
                  <div className="review-evidence">
                    <p className="check-result">✓ {selectedTask.review.checks}</p>
                    {selectedTask.review.diffTruncated ? (
                      <p className="diff-warning">
                        Large diff truncated in the UI. Review the isolated worktree for the full patch.
                      </p>
                    ) : null}
                  </div>
                  {selectedTask.reviewHistory?.length ? (
                    <details className="review-history">
                      <summary>
                        Requested changes ({selectedTask.reviewHistory.length})
                      </summary>
                      <ol>
                        {selectedTask.reviewHistory.map((entry) => (
                          <li key={`${entry.iteration}-${entry.at}`}>
                            <span>After iteration {entry.iteration}</span>
                            <p>{entry.feedback}</p>
                          </li>
                        ))}
                      </ol>
                    </details>
                  ) : null}
                  <DiffViewer
                    diff={selectedTask.review.diff}
                    editorName={status?.editors?.preferred?.name}
                    onOpenFile={
                      status?.editors?.available
                        ? (file, line) => void openReviewFile(file, line)
                        : undefined
                    }
                  />
                </section>
              ) : null}

              {selectedTask.result?.plan || selectedTask.result?.judgment ? (
                <details className="artifact-details">
                  <summary>Reviewed council plan</summary>
                  <pre>
                    {selectedTask.result.plan ?? selectedTask.result.judgment}
                  </pre>
                </details>
              ) : null}
              {selectedTask.result?.execution ? (
                <details className="artifact-details">
                  <summary>Codex report</summary>
                  <pre>{selectedTask.result.execution}</pre>
                </details>
              ) : null}

              {selectedTask.status === "awaiting_review" ? (
                <>
                  {revisionOpen ? (
                    <section className="revision-request">
                      <label htmlFor="revision-feedback">
                        What should Codex change?
                      </label>
                      <textarea
                        autoFocus
                        id="revision-feedback"
                        onChange={(event) => setRevisionFeedback(event.target.value)}
                        placeholder="Be specific about the file, behavior, or test evidence you need."
                        rows={4}
                        value={revisionFeedback}
                      />
                      <div>
                        <button
                          className="secondary-button"
                          disabled={busy === "revise"}
                          onClick={() => {
                            setRevisionOpen(false);
                            setRevisionFeedback("");
                          }}
                          type="button"
                        >
                          Cancel
                        </button>
                        <button
                          className="primary-button"
                          disabled={!revisionFeedback.trim() || busy === "revise"}
                          onClick={() => void requestChanges()}
                          type="button"
                        >
                          {busy === "revise" ? "Sending…" : "Send to Codex"}
                        </button>
                      </div>
                    </section>
                  ) : null}
                  <div className="review-bar">
                    <div>
                      <strong>Ready for your review</strong>
                      <small>The connected repository is unchanged until you accept.</small>
                    </div>
                    <button
                      className="secondary-button danger-text"
                      disabled={Boolean(busy)}
                      onClick={() => void taskAction("reject")}
                      type="button"
                    >
                      Decline
                    </button>
                    <button
                      className="secondary-button"
                      disabled={Boolean(busy)}
                      onClick={() => setRevisionOpen(true)}
                      type="button"
                    >
                      Request changes
                    </button>
                    <button
                      className="primary-button"
                      disabled={Boolean(busy)}
                      onClick={() => void taskAction("accept")}
                      type="button"
                    >
                      Accept changes
                    </button>
                  </div>
                </>
              ) : null}
            </article>
          ) : (
            <section className="empty-workspace">
              <div className="empty-orbit"><span>C</span><span>A</span></div>
              <h2>{selectedRepository ? "Start a coding task" : "Your local coding council"}</h2>
              <p>
                {selectedRepository
                  ? "Choose Codex only or a Codex × Claude planning council below."
                  : "Connect a repository to build reusable context and run isolated tasks."}
              </p>
              {!selectedRepository ? (
                <button
                  className="primary-button"
                  onClick={() => setConnectOpen(true)}
                  type="button"
                >
                  Connect repository
                </button>
              ) : null}
            </section>
          )}
        </div>

        <section className="composer-dock">
          <textarea
            aria-label="What should change?"
            disabled={!selectedRepository}
            ref={composerRef}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void startTask();
              }
            }}
            placeholder="What should change?"
            rows={3}
            value={prompt}
          />
          <div className="composer-controls">
            <div className="mode-control">
              <button
                className={settings.routingMode === "manual" ? "active" : ""}
                onClick={() =>
                  void saveSettings({ ...settings, routingMode: "manual" })
                }
                type="button"
              >
                Manual
              </button>
              <button
                className={settings.routingMode === "auto" ? "active" : ""}
                onClick={() => void saveSettings({ ...settings, routingMode: "auto" })}
                type="button"
              >
                Auto
              </button>
            </div>
            {settings.routingMode === "manual" ? (
              <select
                aria-label="code-council strategy"
                onChange={(event) =>
                  void saveSettings({
                    ...settings,
                    strategy: event.target.value as Settings["strategy"],
                  })
                }
                value={settings.strategy}
              >
                <option value="codex_only">Codex only</option>
                <option value="claude_only">Claude only</option>
                <option value="council_plan_codex_execute">Use council</option>
              </select>
            ) : (
              <span className="auto-note">Escalates only when confidence is low</span>
            )}
            <button
              className="model-summary"
              onClick={() => setSettingsOpen(true)}
              type="button"
            >
              {settings.strategy !== "claude_only" ||
              settings.routingMode === "auto" ? (
                <>
                  <AgentBadge agent="codex" />
                  {settings.codex.model} · {settings.codex.reasoning}
                </>
              ) : null}
              {settings.strategy === "council_plan_codex_execute" ||
              settings.strategy === "claude_only" ||
              settings.routingMode === "auto" ? (
                <>
                  <AgentBadge agent="claude" />
                  {settings.claude.model} · {settings.claude.reasoning}
                </>
              ) : null}
            </button>
            <button
              className="run-button"
              disabled={
                !selectedRepository ||
                !prompt.trim() ||
                busy === "start" ||
                !agentsReady
              }
              onClick={() => void startTask()}
              type="button"
            >
              {busy === "start" ? "Starting…" : "Run"}
              <span>⌘↵</span>
            </button>
          </div>
        </section>
      </section>

      {connectOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section
            aria-labelledby="connect-title"
            aria-modal="true"
            className="modal"
            role="dialog"
          >
            <button
              aria-label="Close"
              className="modal-close"
              onClick={() => setConnectOpen(false)}
              type="button"
            >
              ×
            </button>
            <p className="modal-kicker">New workspace</p>
            <h2 id="connect-title">Connect a repository</h2>
            <p>code-council remembers it locally and reuses fresh context on every return.</p>
            <div className="tab-control">
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
                  spellCheck={false}
                  value={repositoryInput}
                />
              </label>
              <label className="check-label">
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
                Build context with{" "}
                {settings.context.provider === "codex" ? "Codex" : "Claude Code"} ·{" "}
                {settings.context.model} · {settings.context.reasoning}
              </label>
              <div className="modal-actions">
                <button
                  className="secondary-button"
                  onClick={() => setConnectOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="primary-button"
                  disabled={busy === "connect"}
                  type="submit"
                >
                  {busy === "connect"
                    ? connectMode === "github"
                      ? "Cloning…"
                      : "Connecting…"
                    : "Connect"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {repoPendingDelete ? (
        <div className="modal-backdrop" role="presentation">
          <section
            aria-labelledby="disconnect-title"
            aria-modal="true"
            className="modal disconnect-modal"
            role="dialog"
          >
            <div className="modal-symbol warning">!</div>
            <p className="modal-kicker">Repository connection</p>
            <h2 id="disconnect-title">Disconnect {repoPendingDelete.name}?</h2>
            <p>
              code-council will forget this repository. Your local files and Git history
              will not be deleted.
            </p>
            <div className="modal-actions">
              <button
                className="secondary-button"
                disabled={busy === "disconnect"}
                onClick={() => setRepoPendingDelete(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="primary-button danger-button"
                disabled={busy === "disconnect"}
                onClick={() => void disconnectRepository(repoPendingDelete)}
                type="button"
              >
                {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section
            aria-labelledby="settings-title"
            aria-modal="true"
            className="modal settings-modal"
            role="dialog"
          >
            <button
              aria-label="Close"
              className="modal-close"
              onClick={() => setSettingsOpen(false)}
              type="button"
            >
              ×
            </button>
            <p className="modal-kicker">Runtime</p>
            <h2 id="settings-title">Models & reasoning</h2>
            <p>These defaults are saved locally and captured on each new task.</p>
            <div className="agent-setting">
              <header>
                <AgentBadge agent="codex" />
                <div><strong>Codex</strong><small>Critiques plans and executes</small></div>
              </header>
              <div>
                <label>
                  Model
                  <select
                    onChange={(event) => {
                      const model = event.target.value;
                      void saveSettings({
                        ...settings,
                        codex: {
                          model,
                          reasoning: compatibleReasoning(
                            settingsOptions.codexCatalog,
                            model,
                            settings.codex.reasoning,
                            settingsOptions.codexReasoning,
                          ),
                        },
                      });
                    }}
                    value={settings.codex.model}
                  >
                    {codexModels.map((entry) => (
                      <option key={entry.model} value={entry.model}>
                        {entry.label} · {entry.model}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Reasoning
                  <select
                    onChange={(event) =>
                      void saveSettings({
                        ...settings,
                        codex: { ...settings.codex, reasoning: event.target.value },
                      })
                    }
                    value={settings.codex.reasoning}
                  >
                    {reasoningOptions(
                      settingsOptions.codexCatalog,
                      settings.codex.model,
                      settingsOptions.codexReasoning,
                    ).map((level) => (
                      <option key={level}>{level}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <div className="agent-setting">
              <header>
                <AgentBadge agent="claude" />
                <div><strong>Claude Code</strong><small>Proposes and revises plans</small></div>
              </header>
              <div>
                <label>
                  Model
                  <select
                    onChange={(event) => {
                      const model = event.target.value;
                      void saveSettings({
                        ...settings,
                        claude: {
                          model,
                          reasoning: compatibleReasoning(
                            settingsOptions.claudeCatalog,
                            model,
                            settings.claude.reasoning,
                            settingsOptions.claudeReasoning,
                          ),
                        },
                      });
                    }}
                    value={settings.claude.model}
                  >
                    {claudeModels.map((entry) => (
                      <option key={entry.model} value={entry.model}>
                        {entry.label} · {entry.model}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Reasoning
                  <select
                    onChange={(event) =>
                      void saveSettings({
                        ...settings,
                        claude: { ...settings.claude, reasoning: event.target.value },
                      })
                    }
                    value={settings.claude.reasoning}
                  >
                    {reasoningOptions(
                      settingsOptions.claudeCatalog,
                      settings.claude.model,
                      settingsOptions.claudeReasoning,
                    ).map((level) => (
                      <option key={level}>{level}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <div className="agent-setting context-setting">
              <header>
                <span className="memory-setting-icon">M</span>
                <div>
                  <strong>Repository context</strong>
                  <small>Builds reusable Markdown memory after connect and accept</small>
                </div>
              </header>
              <div>
                <label>
                  Agent
                  <select
                    onChange={(event) => {
                      const provider = event.target.value as "claude" | "codex";
                      void saveSettings({
                        ...settings,
                        context: {
                          provider,
                          model:
                            provider === "codex"
                              ? codexModels[0]?.model
                              : claudeModels[0]?.model,
                          reasoning: "high",
                        },
                      });
                    }}
                    value={settings.context.provider}
                  >
                    <option value="claude">Claude Code</option>
                    <option value="codex">Codex / GPT</option>
                  </select>
                </label>
                <label>
                  Model
                  <select
                    onChange={(event) => {
                      const model = event.target.value;
                      const catalog =
                        settings.context.provider === "codex"
                          ? settingsOptions.codexCatalog
                          : settingsOptions.claudeCatalog;
                      const fallback =
                        settings.context.provider === "codex"
                          ? settingsOptions.codexReasoning
                          : settingsOptions.claudeReasoning;
                      void saveSettings({
                        ...settings,
                        context: {
                          ...settings.context,
                          model,
                          reasoning: compatibleReasoning(
                            catalog,
                            model,
                            settings.context.reasoning,
                            fallback,
                          ),
                        },
                      });
                    }}
                    value={settings.context.model}
                  >
                    {modelOptions(
                      settings.context.provider === "codex"
                        ? settingsOptions.codexCatalog
                        : settingsOptions.claudeCatalog,
                      settings.context.provider === "codex"
                        ? settingsOptions.codexModels
                        : settingsOptions.claudeModels,
                      settings.context.model,
                    ).map((entry) => (
                      <option key={entry.model} value={entry.model}>
                        {entry.label} · {entry.model}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Reasoning
                  <select
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
                    {reasoningOptions(
                      settings.context.provider === "codex"
                        ? settingsOptions.codexCatalog
                        : settingsOptions.claudeCatalog,
                      settings.context.model,
                      settings.context.provider === "codex"
                        ? settingsOptions.codexReasoning
                        : settingsOptions.claudeReasoning,
                    ).map((level) => (
                      <option key={level}>{level}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <p className="settings-note">
              Model choices are discovered from the installed Codex and Claude
              CLIs, with safe fallbacks when discovery is unavailable. Context
              runs read-only, and code-council alone writes validated files under{" "}
              <code>agent_context/</code>. Fable is disabled.
            </p>
            <div className="modal-actions">
              <button
                className="primary-button"
                onClick={() => setSettingsOpen(false)}
                type="button"
              >
                Done
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {pendingApproval ? (
        <ApprovalModal
          busy={busy === "approval"}
          job={pendingApproval}
          onDecision={(decision) => void decideApproval(decision)}
        />
      ) : null}
    </main>
  );
}
