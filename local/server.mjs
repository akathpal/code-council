#!/usr/bin/env node

import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import {
  acceptTaskJob,
  answerTaskClarification,
  cancelTaskJob,
  cloneGitHubRepository,
  createChatJob,
  createContextJob,
  createTaskCommit,
  createTaskDraftPullRequest,
  createTaskJob,
  deleteTaskJob,
  detectEditors,
  detectLocalTools,
  dismissTaskClarification,
  executeChatJob,
  executeTaskJob,
  generateContext,
  installAgent,
  inferPromptIntent,
  inspectRepository,
  listRepositoryFiles,
  manualTaskDecision,
  normalizeTaskJob,
  openFileInEditor,
  openRepositoryInEditor,
  readAgentUsage,
  readAgentModelCatalog,
  readClaudeSkills,
  readGitHubWorkspace,
  readRepositoryFile,
  rejectTaskJob,
  retryChatJob,
  retryTaskJob,
  resumeTaskJob,
  reviseTaskJob,
  routeTask,
  pauseTaskJob,
  pushTaskCommit,
  taskCommitMessage,
  updateActiveTaskJob,
  updateGraphifyIndex,
  validateAgentConfig,
  validateContextConfig,
  validateTaskContextPolicy,
} from "./core.mjs";
import {
  clearCodexGoal,
  readCodexSkills,
  setCodexGoal,
} from "./codex-app-server.mjs";
import {
  agentActivityFromLine,
  mergeAgentActivity,
} from "./agent-activity.mjs";
import {
  councilStatePaths,
  DEFAULT_SETTINGS,
  loadCouncilState,
  saveCouncilState,
} from "./store.mjs";
import { buildSetupDoctorReport } from "./doctor.mjs";
import {
  createReplayPlan,
  replayMetadata,
  summarizeReplayJobs,
} from "./replay.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.COUNCIL_LOCAL_PORT ?? 4781);
const OPENHANDS_URL =
  process.env.COUNCIL_OPENHANDS_URL ?? "http://127.0.0.1:8001";

const stored = await loadCouncilState();
const taskJobs = new Map(
  stored.tasks.map((job) => {
    const normalized = normalizeTaskJob(job);
    return [normalized.id, normalized];
  }),
);
const contextJobs = new Map(
  stored.contextJobs.map((job) => [job.id, job]),
);
const repositories = new Map(
  stored.repositories.map((repository) => [repository.id, repository]),
);
let settings = stored.settings ?? DEFAULT_SETTINGS;
const activeProcesses = new Map();
const activeAgentControls = new Map();
const approvalWaiters = new Map();
let persistQueue = Promise.resolve();
let outputPersistTimer = null;
let usageCache = null;
let usageCacheAt = 0;
let usageRequest = null;
let modelCatalogCache = null;
let modelCatalogCacheAt = 0;
let modelCatalogRequest = null;
let editorCache = null;
let editorCacheAt = 0;
const skillsCache = new Map();

async function codexSkills(repositoryPath, forceReload = false) {
  const cacheKey = `codex:${repositoryPath}`;
  const cached = skillsCache.get(cacheKey);
  if (!forceReload && cached && Date.now() - cached.at < 30_000) {
    return cached.value;
  }
  let result;
  try {
    result = await readCodexSkills({
      cwd: repositoryPath,
      forceReload,
    });
  } catch (error) {
    const value = {
      provider: "codex",
      cwd: repositoryPath,
      skills: [],
      errors: [
        {
          path: repositoryPath,
          message: `Codex skill discovery is unavailable: ${String(error.message ?? error)}`,
        },
      ],
    };
    skillsCache.set(cacheKey, { at: Date.now(), value });
    return value;
  }
  const entry =
    result?.data?.find((candidate) => candidate.cwd === repositoryPath) ??
    result?.data?.[0] ??
    { cwd: repositoryPath, skills: [], errors: [] };
  const value = {
    provider: "codex",
    cwd: repositoryPath,
    skills: (entry.skills ?? []).map((skill) => ({
      provider: "codex",
      name: skill.name,
      invocation: skill.name,
      path: skill.path,
      scope: skill.scope,
      description:
        skill.interface?.shortDescription ??
        skill.shortDescription ??
        skill.description,
      enabled: skill.enabled !== false,
      dependencies: skill.dependencies ?? null,
    })),
    errors: entry.errors ?? [],
  };
  skillsCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

async function claudeSkills(repositoryPath, forceReload = false) {
  const cacheKey = `claude:${repositoryPath}`;
  const cached = skillsCache.get(cacheKey);
  if (!forceReload && cached && Date.now() - cached.at < 30_000) {
    return cached.value;
  }
  let value;
  try {
    value = await readClaudeSkills(repositoryPath);
  } catch (error) {
    value = {
      provider: "claude",
      cwd: repositoryPath,
      skills: [],
      errors: [
        {
          path: repositoryPath,
          message: `Claude skill discovery is unavailable: ${String(error.message ?? error)}`,
        },
      ],
    };
  }
  skillsCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

async function agentSkills(repositoryPath, forceReload = false) {
  const [codex, claude] = await Promise.all([
    codexSkills(repositoryPath, forceReload),
    claudeSkills(repositoryPath, forceReload),
  ]);
  return {
    provider: "all",
    cwd: repositoryPath,
    skills: [...codex.skills, ...claude.skills].sort(
      (left, right) =>
        left.provider.localeCompare(right.provider) ||
        left.name.localeCompare(right.name),
    ),
    errors: [...codex.errors, ...claude.errors],
    providers: { codex, claude },
  };
}

async function validatedSkillSelection(repositoryPath, value) {
  const mode = value?.mode === "explicit" ? "explicit" : "auto";
  if (mode === "auto") return { mode, selected: [] };
  const requested = Array.isArray(value?.selected) ? value.selected : [];
  if (requested.length > 20) {
    throw new Error("Choose no more than 20 skills for one task.");
  }
  const catalog = await agentSkills(repositoryPath);
  const available = new Map(
    catalog.skills
      .filter((skill) => skill.enabled)
      .map((skill) => [`${skill.provider}:${skill.path}`, skill]),
  );
  const selected = requested.map((skill) => {
    const provider = skill?.provider === "claude" ? "claude" : "codex";
    const match = available.get(
      `${provider}:${String(skill?.path ?? "")}`,
    );
    if (!match || match.name !== String(skill?.name ?? "")) {
      throw new Error(
        `The selected ${provider === "claude" ? "Claude" : "Codex"} skill ${String(skill?.name ?? skill?.path ?? "")} is no longer available. Refresh skills and try again.`,
      );
    }
    return match;
  });
  return { mode, selected };
}

async function cachedAgentUsage(tools) {
  const maxAge = 60_000;
  if (usageCache && Date.now() - usageCacheAt < maxAge) return usageCache;
  if (usageRequest) return usageRequest;
  usageRequest = readAgentUsage(tools)
    .then((usage) => {
      usageCache = usage;
      usageCacheAt = Date.now();
      return usage;
    })
    .finally(() => {
      usageRequest = null;
    });
  return usageRequest;
}

async function cachedModelCatalog() {
  const maxAge = 10 * 60_000;
  if (modelCatalogCache && Date.now() - modelCatalogCacheAt < maxAge) {
    return modelCatalogCache;
  }
  if (modelCatalogRequest) return modelCatalogRequest;
  modelCatalogRequest = detectLocalTools()
    .then(readAgentModelCatalog)
    .then((catalog) => {
      modelCatalogCache = catalog;
      modelCatalogCacheAt = Date.now();
      return catalog;
    })
    .finally(() => {
      modelCatalogRequest = null;
    });
  return modelCatalogRequest;
}

async function cachedEditors() {
  if (editorCache && Date.now() - editorCacheAt < 5 * 60_000) {
    return editorCache;
  }
  editorCache = await detectEditors();
  editorCacheAt = Date.now();
  return editorCache;
}

function interrupted(job, message) {
  if (
    !["queued", "running", "awaiting_approval"].includes(job.status) &&
    job.stage !== "accepting"
  ) {
    return;
  }
  const now = new Date().toISOString();
  job.status = "failed";
  job.stage = "interrupted";
  job.error = message;
  job.updatedAt = now;
  job.events ??= [];
  job.processes ??= [];
  for (const process of job.processes) {
    if (process.status === "running") {
      process.status = "interrupted";
      process.endedAt = now;
    }
  }
  job.events.push({ stage: "interrupted", message, at: now });
}

for (const job of taskJobs.values()) {
  if (
    job.goal?.enabled &&
    ["queued", "running", "awaiting_approval"].includes(job.status)
  ) {
    const now = new Date().toISOString();
    job.pausedStage = job.stage;
    job.status = "paused";
    job.stage = "paused";
    job.pauseRequested = false;
    job.cancelRequested = false;
    job.goal.status = "paused";
    job.goal.updatedAt = now;
    job.updatedAt = now;
    const attempt = job.attempts?.at(-1);
    if (attempt) {
      attempt.status = "paused";
      attempt.stage = "paused";
      attempt.updatedAt = now;
      attempt.endedAt = null;
    }
    job.events.push({
      stage: "paused",
      message:
        "The local service restarted. The durable goal, agent thread, and isolated worktree were preserved; choose Resume to continue.",
      at: now,
    });
  } else {
    interrupted(
      job,
      "The local service restarted while this task was running. Restart the task; its original repository was not changed.",
    );
  }
}
for (const job of contextJobs.values()) {
  interrupted(
    job,
    "The local service restarted while context was building. Regenerate to resume with a fresh model run.",
  );
}

function persist() {
  const snapshot = {
    repositories: [...repositories.values()],
    settings,
    tasks: [...taskJobs.values()],
    contextJobs: [...contextJobs.values()],
  };
  persistQueue = persistQueue
    .catch(() => {})
    .then(() => saveCouncilState(snapshot))
    .catch((error) => {
      console.error("Could not persist code-council state:", error);
    });
  return persistQueue;
}
await persist();

function scheduleOutputPersist() {
  if (outputPersistTimer) return;
  outputPersistTimer = setTimeout(() => {
    outputPersistTimer = null;
    void persist();
  }, 250);
}

function appendTail(value, text, maxChars = 80_000) {
  const next = `${value ?? ""}${text}`;
  return next.length > maxChars ? next.slice(-maxChars) : next;
}

function processRuntime(job, agent, stage) {
  let processRecord = null;
  let activityBuffer = "";
  const goalUsageBaseline =
    agent === "claude" &&
    stage === "execute" &&
    job.goal?.provider === "claude"
      ? Number(job.goal.tokensUsed ?? 0)
      : null;
  return {
    onSpawn({ child, pid, executable, args }) {
      const now = new Date().toISOString();
      processRecord = {
        id: `${job.id}:${pid}:${Date.now()}`,
        pid,
        agent,
        stage,
        command: [executable, ...args].join(" "),
        status: "running",
        startedAt: now,
        endedAt: null,
        exitCode: null,
        signal: null,
        outputTail: "",
        activity: [],
      };
      job.processes ??= [];
      job.processes.push(processRecord);
      job.updatedAt = now;
      let children = activeProcesses.get(job.id);
      if (!children) {
        children = new Map();
        activeProcesses.set(job.id, children);
      }
      children.set(pid, child);
      void persist();
    },
    onOutput({ stream, text }) {
      if (!processRecord) return;
      processRecord.outputTail = appendTail(
        processRecord.outputTail,
        stream === "stderr" ? `[stderr] ${text}` : text,
      );
      if (stream === "stdout" && ["codex", "claude"].includes(agent)) {
        activityBuffer += text;
        const lines = activityBuffer.split(/\r?\n/);
        activityBuffer = lines.pop() ?? "";
        for (const line of lines) {
          const updates = agentActivityFromLine(agent, line);
          if (!updates.length) continue;
          processRecord.activity = mergeAgentActivity(
            processRecord.activity,
            updates,
          );
        }
      }
      scheduleOutputPersist();
    },
    onUsage({ tokens }) {
      if (goalUsageBaseline == null || !job.goal) return;
      job.goal.tokensUsed = Math.max(
        Number(job.goal.tokensUsed ?? 0),
        goalUsageBaseline + Math.max(0, Number(tokens ?? 0)),
      );
      job.goal.updatedAt = new Date().toISOString();
      scheduleOutputPersist();
    },
    onExit({ code, signal }) {
      if (!processRecord) return;
      if (activityBuffer.trim() && ["codex", "claude"].includes(agent)) {
        processRecord.activity = mergeAgentActivity(
          processRecord.activity,
          agentActivityFromLine(agent, activityBuffer.trim()),
        );
        activityBuffer = "";
      }
      processRecord.status =
        job.cancelRequested || signal ? "stopped" : code === 0 ? "complete" : "failed";
      processRecord.endedAt = new Date().toISOString();
      processRecord.exitCode = code;
      processRecord.signal = signal;
      const endedAt = processRecord.endedAt;
      processRecord.activity = (processRecord.activity ?? []).map((entry) =>
        entry.status === "running"
          ? {
              ...entry,
              status: code === 0 && !signal ? "complete" : "failed",
              updatedAt: endedAt,
              endedAt,
            }
          : entry,
      );
      activeProcesses.get(job.id)?.delete(processRecord.pid);
      if (activeProcesses.get(job.id)?.size === 0) {
        activeProcesses.delete(job.id);
      }
      const control = activeAgentControls.get(job.id);
      if (control?.pid === processRecord.pid) {
        activeAgentControls.delete(job.id);
      }
      if (
        job.agentSessions?.[agent]?.threadId ||
        job.agentSessions?.[agent]?.sessionId
      ) {
        job.agentSessions[agent] = {
          ...job.agentSessions[agent],
          status: "idle",
          updatedAt: processRecord.endedAt,
        };
      }
      void persist();
    },
    async onThread({ threadId, resumed }) {
      const now = new Date().toISOString();
      job.agentSessions ??= {};
      job.agentSessions[agent] = {
        ...(job.agentSessions[agent] ?? {}),
        threadId,
        turnId: null,
        stage,
        status: "running",
        resumed,
        updatedAt: now,
      };
      job.updatedAt = now;
      await persist();
    },
    async onGoal(goal) {
      if (!goal && !job.goal) return;
      const now = new Date().toISOString();
      job.goal = goal
        ? {
            ...(job.goal ?? {}),
            ...goal,
            enabled: true,
            provider: "codex",
            native: true,
            updatedAt: now,
          }
        : null;
      job.updatedAt = now;
      await persist();
    },
    async onControl(controller) {
      if (!processRecord) return;
      if (!controller) {
        const active = activeAgentControls.get(job.id);
        if (active?.pid === processRecord.pid) {
          activeAgentControls.delete(job.id);
        }
        return;
      }
      job.agentSessions ??= {};
      job.agentSessions[agent] = {
        ...(job.agentSessions[agent] ?? {}),
        ...(controller.threadId
          ? {
              threadId: controller.threadId,
              turnId: controller.turnId ?? null,
            }
          : {}),
        ...(controller.sessionId
          ? { sessionId: controller.sessionId }
          : {}),
        stage,
        status: "running",
        updatedAt: new Date().toISOString(),
      };
      activeAgentControls.set(job.id, {
        pid: processRecord.pid,
        agent,
        stage,
        controller,
      });
      await persist();
    },
    async onApproval(approval) {
      const key = `${job.id}:${approval.id}`;
      const requestedAt = new Date().toISOString();
      job.approval = {
        ...approval,
        status: "pending",
        requestedAt,
        decidedAt: null,
        decision: null,
        agent,
        stage,
      };
      job.status = "awaiting_approval";
      job.updatedAt = requestedAt;
      job.events ??= [];
      job.events.push({
        stage: "awaiting_approval",
        message:
          approval.reason ||
          `${agent} needs permission before it can continue.`,
        at: requestedAt,
      });
      await persist();
      return new Promise((resolve) => {
        approvalWaiters.set(key, resolve);
      });
    },
  };
}

function stopProcesses(jobId, signal = "SIGTERM") {
  const children = activeProcesses.get(jobId);
  if (!children) return;
  for (const child of children.values()) child.kill(signal);
  setTimeout(() => {
    for (const child of children.values()) {
      if (child.exitCode == null) child.kill("SIGKILL");
    }
  }, 2_000).unref();
}

function stopProcess(jobId, pid) {
  const child = activeProcesses.get(jobId)?.get(pid);
  if (!child || child.exitCode != null) return;
  child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode == null) child.kill("SIGKILL");
  }, 2_000).unref();
}

async function interruptTask(job, options = {}) {
  const active = activeAgentControls.get(job.id);
  if (active?.controller) {
    try {
      if (options.pauseGoal && active.controller.setGoal && job.goal) {
        await active.controller.setGoal({
          objective: job.goal.objective,
          status: "paused",
          tokenBudget: job.goal.tokenBudget,
        });
      }
      await active.controller.interrupt();
      setTimeout(() => stopProcess(job.id, active.pid), 1_500).unref();
      return true;
    } catch {
      // Fall through to terminating the provider process.
    }
  }
  stopProcesses(
    job.id,
    options.pauseGoal && job.goal?.provider === "claude"
      ? "SIGINT"
      : "SIGTERM",
  );
  return false;
}

function repositoryId(repositoryPath) {
  return createHash("sha256").update(repositoryPath).digest("hex").slice(0, 16);
}

async function registerRepository(repository, source, sourceUrl = null) {
  const id = repositoryId(repository.path);
  const existing = repositories.get(id);
  const now = new Date().toISOString();
  const record = {
    id,
    name: repository.name,
    path: repository.path,
    source,
    sourceUrl,
    addedAt: existing?.addedAt ?? now,
    lastOpenedAt: now,
  };
  repositories.set(id, record);
  await persist();
  return { ...record, ...repository };
}

async function repositoryForResponse(record) {
  try {
    return { ...record, ...(await inspectRepository(record.path)), error: null };
  } catch (error) {
    return { ...record, error: String(error.message ?? error), context: null };
  }
}

function corsHeaders(origin) {
  const allowed =
    !origin ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return allowed
    ? {
        "access-control-allow-origin": origin ?? "http://localhost:3000",
        "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
        "access-control-allow-headers": "content-type",
        vary: "origin",
      }
    : {};
}

function send(response, status, responseBody, origin) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...corsHeaders(origin),
  });
  response.end(JSON.stringify(responseBody));
}

async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function openHandsStatus() {
  try {
    const response = await fetch(`${OPENHANDS_URL}/ready`, {
      signal: AbortSignal.timeout(1_500),
    });
    return {
      ready: response.ok,
      url: OPENHANDS_URL,
      version: "agent-canvas@1.5.0 / agent-server@1.36.1",
    };
  } catch {
    return {
      ready: false,
      url: OPENHANDS_URL,
      version: "agent-canvas@1.5.0 / agent-server@1.36.1",
    };
  }
}

function taskForResponse(job, compact = false) {
  const safe = {
    ...job,
    patch: undefined,
    reviewHistory: (job.reviewHistory ?? []).map((entry) => ({
      iteration: entry.iteration,
      feedback: entry.feedback,
      at: entry.at,
    })),
  };
  if (!compact) return safe;
  return {
    ...safe,
    result: null,
    processes: (safe.processes ?? []).map((process) => ({
      ...process,
      outputTail: "",
      command: undefined,
      activity: (process.activity ?? []).slice(-40),
    })),
    review: safe.review
      ? {
          ...safe.review,
          diff: "",
        }
      : null,
  };
}

function contextForResponse(job) {
  return job;
}

function jobsForRepository(jobs, repositoryPath) {
  return [...jobs.values()]
    .filter((job) => !repositoryPath || job.repository === repositoryPath)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function updateContextJob(job, stage, message) {
  const now = new Date().toISOString();
  job.stage = stage;
  job.status =
    stage === "complete"
      ? "complete"
      : stage === "failed"
        ? "failed"
        : stage === "canceled"
          ? "canceled"
          : "running";
  job.updatedAt = now;
  job.events.push({ stage, message, at: now });
  await persist();
}

async function runContextJob(job, options = {}) {
  try {
    const contextConfig = validateContextConfig({
      provider: job.provider,
      model: job.model,
      reasoning: job.effort,
      tokenBudget: job.tokenBudget,
      enabledByDefault: job.enabledByDefault,
      graphify: job.graphifyEnabled,
    });
    let graphify = {
      status: contextConfig.graphify ? "not_started" : "disabled",
      graphPath: null,
    };
    if (contextConfig.graphify) {
      await updateContextJob(
        job,
        "graphify",
        "Updating the local code graph without an LLM call.",
      );
      graphify = await updateGraphifyIndex(job.repository, {
        runtime: processRuntime(job, "graphify", "graphify"),
      });
      job.graphify = graphify;
      await persist();
    }
    const agentLabel =
      contextConfig.provider === "codex" ? "Codex" : "Claude Code";
    await updateContextJob(
      job,
      "investigate",
      `${agentLabel} ${contextConfig.model} is investigating changed source and impacted memory.`,
    );
    const result = await generateContext(job.repository, {
      ...contextConfig,
      maxBudgetUsd: options.maxBudgetUsd ?? 5,
      graphifyRuntime: processRuntime(job, "graphify", "retrieve"),
      ...processRuntime(job, contextConfig.provider, "context"),
    });
    job.result = {
      generation: result.manifest.generation,
      documents: result.manifest.documents.length,
      updatedDocuments: result.updatedDocuments,
      deletedDocuments: result.deletedDocuments,
      durationMs: result.durationMs,
      usage: result.usage,
      graphify,
    };
    await updateContextJob(
      job,
      "complete",
      `${result.manifest.generation === "incremental" ? "Incremental context refresh" : "Initial context build"} complete.`,
    );
  } catch (error) {
    if (job.cancelRequested) {
      await updateContextJob(job, "canceled", "Context build canceled.");
    } else {
      job.error = String(error.stderr || error.message || error);
      await updateContextJob(job, "failed", job.error);
    }
  }
  return job;
}

async function runContextJobAfter(job, previousJob, options = {}) {
  while (["queued", "running"].includes(previousJob.status)) {
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  await runContextJob(job, options);
}

async function enqueueContextJob(repositoryPath, options = {}) {
  const repository = await inspectRepository(repositoryPath);
  const repositoryJobs = jobsForRepository(contextJobs, repository.path);
  const waitingRefresh = repositoryJobs.find(
    (job) =>
      job.status === "queued" &&
      job.stage === "waiting" &&
      job.reason === "accepted_task",
  );
  if (options.queueAfterActive && waitingRefresh) {
    waitingRefresh.taskId = options.taskId ?? waitingRefresh.taskId;
    waitingRefresh.updatedAt = new Date().toISOString();
    waitingRefresh.events.push({
      stage: "coalesced",
      message:
        "Included another accepted patch in this pending incremental refresh.",
      at: waitingRefresh.updatedAt,
    });
    await persist();
    return { job: waitingRefresh, existing: true };
  }
  const existing = repositoryJobs.find(
    (job) => ["queued", "running"].includes(job.status),
  );
  if (existing && !options.queueAfterActive) {
    return { job: existing, existing: true };
  }
  const job = createContextJob(repository, options);
  if (existing) {
    job.stage = "waiting";
    job.events.push({
      stage: "waiting",
      message: "Waiting for the current context build before refreshing accepted changes.",
      at: job.createdAt,
    });
  }
  contextJobs.set(job.id, job);
  await persist();
  if (existing) void runContextJobAfter(job, existing, options);
  else void runContextJob(job, options);
  return { job, existing: false };
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (
    origin &&
    !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  ) {
    return send(response, 403, { error: "Local origins only." }, origin);
  }
  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders(origin));
    return response.end();
  }

  const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);

  try {
    if (request.method === "GET" && url.pathname === "/v1/status") {
      const [tools, runtime, editors] = await Promise.all([
        detectLocalTools(),
        openHandsStatus(),
        cachedEditors(),
      ]);
      const usage = await cachedAgentUsage(tools);
      return send(
        response,
        200,
        {
          ready: true,
          local: true,
          tools,
          runtime,
          usage,
          editors,
          capabilities: {
            persistentJobs: true,
            persistentRepositories: true,
            isolatedWorktrees: true,
            liveProcesses: true,
            interactiveApprovals: true,
            cancellation: true,
            liveSteering: true,
            resumableAgentThreads: true,
            skills: true,
            durableGoals: true,
            manualRoutingDefault: true,
            acceptedPatchContextRefresh: true,
            contextProvider: settings.context.provider,
            contextModel: settings.context.model,
            contextEffort: settings.context.reasoning,
            contextTokenBudget: settings.context.tokenBudget,
            contextEnabledByDefault: settings.context.enabledByDefault,
            graphify: settings.context.graphify,
          },
        },
        origin,
      );
    }

    if (request.method === "GET" && url.pathname === "/v1/doctor") {
      const [tools, runtime] = await Promise.all([
        detectLocalTools(),
        openHandsStatus(),
      ]);
      return send(
        response,
        200,
        buildSetupDoctorReport({ tools, openHands: runtime }),
        origin,
      );
    }

    if (request.method === "POST" && url.pathname === "/v1/agents/install") {
      const payload = await body(request);
      const result = await installAgent(payload.agent);
      return send(response, 200, result, origin);
    }

    if (request.method === "GET" && url.pathname === "/v1/settings") {
      const catalog = await cachedModelCatalog();
      return send(
        response,
        200,
        {
          settings,
          options: {
            codexModels: catalog.codex.map((entry) => entry.model),
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
            claudeModels: catalog.claude.map((entry) => entry.model),
            claudeReasoning: ["low", "medium", "high", "xhigh", "max"],
            codexCatalog: catalog.codex,
            claudeCatalog: catalog.claude,
            discoveredAt: catalog.discoveredAt,
            contextProviders: ["claude", "codex"],
          },
        },
        origin,
      );
    }

    if (request.method === "POST" && url.pathname === "/v1/settings") {
      const payload = await body(request);
      const agentConfig = validateAgentConfig(payload);
      const contextConfig = validateContextConfig(
        payload.context ?? settings.context,
      );
      settings = {
        ...settings,
        routingMode:
          payload.routingMode === "auto" ? "auto" : "manual",
        strategy:
          ["codex_only", "claude_only", "council_plan_codex_execute"].includes(
            payload.strategy,
          )
            ? payload.strategy
            : "codex_only",
        autoBuildContext: payload.autoBuildContext !== false,
        ...agentConfig,
        context: contextConfig,
      };
      await persist();
      return send(response, 200, { settings }, origin);
    }

    if (request.method === "GET" && url.pathname === "/v1/repositories") {
      const connected = await Promise.all(
        [...repositories.values()]
          .sort((left, right) =>
            right.lastOpenedAt.localeCompare(left.lastOpenedAt),
          )
          .map(repositoryForResponse),
      );
      return send(response, 200, { repositories: connected }, origin);
    }

    const repositoryTreeMatch = url.pathname.match(
      /^\/v1\/repositories\/([^/]+)\/tree$/,
    );
    if (request.method === "GET" && repositoryTreeMatch) {
      const repository = repositories.get(repositoryTreeMatch[1]);
      if (!repository) {
        return send(response, 404, { error: "Repository not found." }, origin);
      }
      const result = await listRepositoryFiles(repository.path);
      return send(response, 200, result, origin);
    }

    const repositoryFileMatch = url.pathname.match(
      /^\/v1\/repositories\/([^/]+)\/file$/,
    );
    if (request.method === "GET" && repositoryFileMatch) {
      const repository = repositories.get(repositoryFileMatch[1]);
      if (!repository) {
        return send(response, 404, { error: "Repository not found." }, origin);
      }
      const result = await readRepositoryFile(
        repository.path,
        url.searchParams.get("file"),
      );
      return send(response, 200, result, origin);
    }

    const disconnectMatch = url.pathname.match(
      /^\/v1\/repositories\/([^/]+)$/,
    );
    if (request.method === "DELETE" && disconnectMatch) {
      const removed = repositories.delete(disconnectMatch[1]);
      if (!removed) {
        return send(response, 404, { error: "Repository not found." }, origin);
      }
      await persist();
      return send(response, 200, { disconnected: true }, origin);
    }

    if (
      request.method === "POST" &&
      url.pathname === "/v1/repositories/connect"
    ) {
      const payload = await body(request);
      let inspected;
      let source;
      let sourceUrl = null;
      if (payload.url) {
        const cloned = await cloneGitHubRepository(
          payload.url,
          councilStatePaths().repositories,
        );
        inspected = cloned.repository;
        source = "github";
        sourceUrl = cloned.sourceUrl;
      } else {
        inspected = await inspectRepository(payload.path);
        source = "local";
      }
      const repository = await registerRepository(
        inspected,
        source,
        sourceUrl,
      );
      let contextJob = null;
      if (
        settings.autoBuildContext &&
        repository.context.status !== "fresh"
      ) {
        const queued = await enqueueContextJob(repository.path, {
          reason: "repository_connected",
          ...settings.context,
        });
        contextJob = queued.job;
      }
      return send(response, 200, { repository, contextJob }, origin);
    }

    if (
      request.method === "POST" &&
      url.pathname === "/v1/context/generate"
    ) {
      const payload = await body(request);
      const contextConfig = validateContextConfig(
        payload.context ?? settings.context,
      );
      if (payload.dryRun) {
        const result = await generateContext(payload.path, {
          dryRun: true,
          ...contextConfig,
          maxBudgetUsd: payload.maxBudgetUsd ?? 5,
        });
        return send(response, 200, result, origin);
      }
      const queued = await enqueueContextJob(payload.path, {
        maxBudgetUsd: payload.maxBudgetUsd ?? 5,
        reason: payload.reason ?? "manual",
        taskId: payload.taskId ?? null,
        ...contextConfig,
      });
      return send(
        response,
        202,
        {
          job: contextForResponse(queued.job),
          existing: queued.existing,
        },
        origin,
      );
    }

    const repositorySkillsMatch = url.pathname.match(
      /^\/v1\/repositories\/([^/]+)\/skills$/,
    );
    if (request.method === "GET" && repositorySkillsMatch) {
      const repository = repositories.get(repositorySkillsMatch[1]);
      if (!repository) {
        return send(response, 404, { error: "Repository not found." }, origin);
      }
      const result = await agentSkills(
        repository.path,
        url.searchParams.get("refresh") === "1",
      );
      return send(response, 200, result, origin);
    }

    const repositoryGitHubMatch = url.pathname.match(
      /^\/v1\/repositories\/([^/]+)\/github$/,
    );
    if (request.method === "GET" && repositoryGitHubMatch) {
      const repository = repositories.get(repositoryGitHubMatch[1]);
      if (!repository) {
        return send(response, 404, { error: "Repository not found." }, origin);
      }
      const result = await readGitHubWorkspace(repository.path);
      return send(response, 200, result, origin);
    }

    if (
      request.method === "GET" &&
      url.pathname === "/v1/context/jobs"
    ) {
      const jobs = jobsForRepository(
        contextJobs,
        url.searchParams.get("path"),
      ).map(contextForResponse);
      return send(response, 200, { jobs }, origin);
    }

    if (
      request.method === "GET" &&
      url.pathname.startsWith("/v1/context/jobs/")
    ) {
      const id = url.pathname.slice("/v1/context/jobs/".length);
      const job = contextJobs.get(id);
      return job
        ? send(response, 200, { job: contextForResponse(job) }, origin)
        : send(response, 404, { error: "Context job not found." }, origin);
    }

    const cancelContextMatch = url.pathname.match(
      /^\/v1\/context\/jobs\/([^/]+)\/cancel$/,
    );
    if (request.method === "POST" && cancelContextMatch) {
      const job = contextJobs.get(cancelContextMatch[1]);
      if (!job) {
        return send(response, 404, { error: "Context job not found." }, origin);
      }
      if (!["queued", "running"].includes(job.status)) {
        throw new Error("Only an active context build can be canceled.");
      }
      job.cancelRequested = true;
      job.updatedAt = new Date().toISOString();
      job.events.push({
        stage: "cancel_requested",
        message: `Stopping ${job.provider === "codex" ? "Codex" : "Claude Code"} context generation.`,
        at: job.updatedAt,
      });
      stopProcesses(job.id);
      await persist();
      return send(response, 202, { job: contextForResponse(job) }, origin);
    }

    if (request.method === "POST" && url.pathname === "/v1/tasks/route") {
      const payload = await body(request);
      const repository = await inspectRepository(payload.path);
      const intent = inferPromptIntent(payload.prompt, payload.intent);
      const decision = routeTask(payload.prompt, {
        estimatedFiles: payload.estimatedFiles,
        risk: payload.risk,
        memoryFresh: repository.context.status === "fresh",
      });
      return send(response, 200, { repository, decision, intent }, origin);
    }

    if (request.method === "GET" && url.pathname === "/v1/tasks") {
      const jobs = jobsForRepository(
        taskJobs,
        url.searchParams.get("path"),
      ).map((job) => taskForResponse(job, true));
      return send(response, 200, { jobs }, origin);
    }

    if (request.method === "GET" && url.pathname === "/v1/replays") {
      const repositoryPath = url.searchParams.get("path");
      const jobs = [...taskJobs.values()].filter(
        (job) => !repositoryPath || job.repository === repositoryPath,
      );
      return send(
        response,
        200,
        { replays: summarizeReplayJobs(jobs) },
        origin,
      );
    }

    if (request.method === "POST" && url.pathname === "/v1/replays/start") {
      const payload = await body(request);
      const repository = await inspectRepository(payload.path);
      const intent = inferPromptIntent(payload.prompt, payload.intent);
      const plan = createReplayPlan({ ...payload, intent }, settings.context);
      const agentConfig = validateAgentConfig(
        payload.agentConfig ?? settings,
      );
      const jobs = plan.variants.map((variant, index) => {
        const variantAgentConfig = validateAgentConfig({
          codex: {
            ...agentConfig.codex,
            model: variant.models.codex ?? agentConfig.codex.model,
            reasoning:
              variant.reasoning.codex ?? agentConfig.codex.reasoning,
          },
          claude: {
            ...agentConfig.claude,
            model: variant.models.claude ?? agentConfig.claude.model,
            reasoning:
              variant.reasoning.claude ?? agentConfig.claude.reasoning,
          },
        });
        const job =
          intent === "chat"
            ? createChatJob(
                repository,
                plan.prompt,
                variant.strategy,
                variantAgentConfig,
                variant.contextPolicy,
              )
            : createTaskJob(
                repository,
                plan.prompt,
                manualTaskDecision(variant.strategy, {
                  memoryFresh: repository.context.status === "fresh",
                }),
                variantAgentConfig,
                variant.contextPolicy,
              );
        job.replay = replayMetadata(plan, variant, index, repository);
        taskJobs.set(job.id, job);
        return job;
      });
      await persist();
      const runtimeOptions = {
        onUpdate: persist,
        worktreeRoot: process.env.COUNCIL_WORKTREE_ROOT,
        agentRuntime: processRuntime,
      };
      for (const job of jobs) {
        if (job.kind === "chat") {
          void executeChatJob(job, null, runtimeOptions);
        } else if (job.status !== "awaiting_input") {
          void executeTaskJob(job, runtimeOptions);
        }
      }
      return send(
        response,
        202,
        {
          intent,
          replay: summarizeReplayJobs(jobs)[0],
          jobs: jobs.map((job) => taskForResponse(job)),
        },
        origin,
      );
    }

    if (request.method === "POST" && url.pathname === "/v1/editor/open") {
      const payload = await body(request);
      const job = taskJobs.get(String(payload.taskId ?? ""));
      if (!job?.review || !job.workspace) {
        return send(response, 404, { error: "Task review not found." }, origin);
      }
      const requestedFile = String(payload.file ?? "");
      if (!job.review.files.includes(requestedFile)) {
        throw new Error("Only files in this task review can be opened.");
      }
      const root =
        job.status === "accepted" ? job.repository : job.workspace.path;
      const result = await openFileInEditor(root, requestedFile, {
        editor: payload.editor,
        line: payload.line,
      });
      return send(response, 200, result, origin);
    }

    const repositoryEditorMatch = url.pathname.match(
      /^\/v1\/repositories\/([^/]+)\/editor$/,
    );
    if (request.method === "POST" && repositoryEditorMatch) {
      const repository = repositories.get(repositoryEditorMatch[1]);
      if (!repository) {
        return send(response, 404, { error: "Repository not found." }, origin);
      }
      const payload = await body(request);
      const result = await openRepositoryInEditor(repository.path, {
        editor: payload.editor,
      });
      return send(response, 200, result, origin);
    }

    if (request.method === "POST" && url.pathname === "/v1/tasks/start") {
      const payload = await body(request);
      const repository = await inspectRepository(payload.path);
      const goalRequested = payload.goal?.enabled === true;
      const intent = goalRequested
        ? "code"
        : inferPromptIntent(payload.prompt, payload.intent);
      const routingMode = payload.routingMode === "auto" ? "auto" : "manual";
      let decision =
        routingMode === "auto"
          ? routeTask(payload.prompt, {
              estimatedFiles: payload.estimatedFiles,
              risk: payload.risk,
              memoryFresh: repository.context.status === "fresh",
            })
          : manualTaskDecision(payload.strategy ?? "codex_only", {
              memoryFresh: repository.context.status === "fresh",
            });
      const skills = await validatedSkillSelection(
        repository.path,
        payload.skills,
      );
      const selectedProviders = new Set(
        skills.selected.map((skill) => skill.provider),
      );
      if (routingMode === "auto" && selectedProviders.has("claude")) {
        decision = manualTaskDecision(
          selectedProviders.has("codex")
            ? "council_plan_codex_execute"
            : "claude_only",
          { memoryFresh: repository.context.status === "fresh" },
        );
      } else if (routingMode === "manual" && skills.mode === "explicit") {
        const supportedProviders =
          decision.strategy === "council_plan_codex_execute"
            ? new Set(["codex", "claude"])
            : decision.strategy === "claude_only"
              ? new Set(["claude"])
              : new Set(["codex"]);
        const unsupported = skills.selected.find(
          (skill) => !supportedProviders.has(skill.provider),
        );
        if (unsupported) {
          throw new Error(
            `The selected ${unsupported.provider === "claude" ? "Claude" : "Codex"} skill requires a routing option that uses that provider.`,
          );
        }
      }
      const contextPolicy = validateTaskContextPolicy(
        payload.contextPolicy ?? {},
        settings.context,
      );
      if (payload.dryRun) {
        return send(
          response,
          200,
          {
            dryRun: true,
            repository,
            decision,
            intent,
            contextPolicy,
            skills,
            safety:
              "No agent was called and no repository files were changed.",
          },
          origin,
        );
      }
      const agentConfig = validateAgentConfig(
        payload.agentConfig ?? settings,
      );
      const job =
        intent === "chat"
          ? createChatJob(
              repository,
              payload.prompt,
              payload.strategy ?? settings.strategy,
              agentConfig,
              contextPolicy,
              { skills },
            )
          : createTaskJob(
              repository,
              payload.prompt,
              decision,
              agentConfig,
              contextPolicy,
              {
                skills,
                goal: goalRequested
                  ? {
                      enabled: true,
                      objective: payload.goal.objective ?? payload.prompt,
                      tokenBudget: payload.goal.tokenBudget,
                      autoContinue: payload.goal.autoContinue,
                      maxContinuations: payload.goal.maxContinuations,
                    }
                  : null,
              },
            );
      taskJobs.set(job.id, job);
      await persist();
      const runtimeOptions = {
        onUpdate: persist,
        worktreeRoot: process.env.COUNCIL_WORKTREE_ROOT,
        agentRuntime: processRuntime,
      };
      if (intent === "chat") {
        void executeChatJob(job, null, runtimeOptions);
      } else if (job.status !== "awaiting_input") {
        void executeTaskJob(job, runtimeOptions);
      }
      return send(
        response,
        202,
        { dryRun: false, intent, job: taskForResponse(job) },
        origin,
      );
    }

    const messageMatch = url.pathname.match(
      /^\/v1\/tasks\/([^/]+)\/message$/,
    );
    if (request.method === "POST" && messageMatch) {
      const job = taskJobs.get(messageMatch[1]);
      if (!job) {
        return send(response, 404, { error: "Task not found." }, origin);
      }
      const payload = await body(request);
      const message = String(payload.message ?? "").trim();
      if (!message) throw new Error("Enter a message.");
      const runtimeOptions = {
        onUpdate: persist,
        worktreeRoot: process.env.COUNCIL_WORKTREE_ROOT,
        agentRuntime: processRuntime,
      };
      if (["queued", "running", "awaiting_approval"].includes(job.status)) {
        const active = activeAgentControls.get(job.id);
        if (active?.controller?.steer) {
          let delivered = false;
          try {
            await active.controller.steer(
              message,
              job.skills?.mode === "explicit"
                ? job.skills.selected.filter(
                    (skill) => skill.provider === active.agent,
                  )
                : [],
            );
            delivered = true;
            await updateActiveTaskJob(job, message, { onUpdate: persist });
          } catch {
            if (delivered) {
              const now = new Date().toISOString();
              job.conversation ??= [];
              if (job.conversation.at(-1)?.content !== message) {
                job.conversation.push({
                  id: randomUUID(),
                  role: "user",
                  content: message,
                  kind: "steering",
                  at: now,
                });
              }
              job.events.push({
                stage: "steered",
                message: "The update reached the agent as its turn completed.",
                at: now,
              });
              job.updatedAt = now;
              await persist();
            } else {
              await updateActiveTaskJob(job, message, {
                restart: true,
                onUpdate: persist,
              });
              await interruptTask(job);
            }
          }
        } else {
          await updateActiveTaskJob(job, message, {
            restart: true,
            onUpdate: persist,
          });
          await interruptTask(job);
        }
      } else if (job.kind === "chat") {
        void executeChatJob(job, message, runtimeOptions);
      } else if (job.status === "awaiting_input") {
        await answerTaskClarification(job, message, { onUpdate: persist });
        void executeTaskJob(job, runtimeOptions);
      } else {
        throw new Error(
          "This coding task is not waiting for a reply. Use review feedback for patch changes or start a new task.",
        );
      }
      return send(
        response,
        202,
        { job: taskForResponse(job) },
        origin,
      );
    }

    const dismissClarificationMatch = url.pathname.match(
      /^\/v1\/tasks\/([^/]+)\/clarification\/dismiss$/,
    );
    if (request.method === "POST" && dismissClarificationMatch) {
      const job = taskJobs.get(dismissClarificationMatch[1]);
      if (!job) {
        return send(response, 404, { error: "Task not found." }, origin);
      }
      await dismissTaskClarification(job, { onUpdate: persist });
      return send(response, 200, { job: taskForResponse(job) }, origin);
    }

    const cancelMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/cancel$/);
    if (request.method === "POST" && cancelMatch) {
      const job = taskJobs.get(cancelMatch[1]);
      if (!job) {
        return send(response, 404, { error: "Task run not found." }, origin);
      }
      await cancelTaskJob(job, { onUpdate: persist });
      await interruptTask(job);
      const waiting = job.approval
        ? approvalWaiters.get(`${job.id}:${job.approval.id}`)
        : null;
      if (waiting) {
        approvalWaiters.delete(`${job.id}:${job.approval.id}`);
        waiting("cancel");
      }
      return send(response, 202, { job: taskForResponse(job) }, origin);
    }

    const retryMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/retry$/);
    if (request.method === "POST" && retryMatch) {
      const job = taskJobs.get(retryMatch[1]);
      if (!job) {
        return send(response, 404, { error: "Task run not found." }, origin);
      }
      if (!["failed", "canceled", "conflict"].includes(job.status)) {
        throw new Error("Only a failed, canceled, or conflicted task can be retried.");
      }
      const payload = await body(request);
      const runtimeOptions = {
        onUpdate: persist,
        worktreeRoot: process.env.COUNCIL_WORKTREE_ROOT,
        agentRuntime: processRuntime,
      };
      const retryOptions = {
        ...runtimeOptions,
        updatedPrompt: payload.prompt,
      };
      if (job.kind === "chat") void retryChatJob(job, retryOptions);
      else void retryTaskJob(job, payload.stage, retryOptions);
      return send(response, 202, { job: taskForResponse(job) }, origin);
    }

    const pauseMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/pause$/);
    if (request.method === "POST" && pauseMatch) {
      const job = taskJobs.get(pauseMatch[1]);
      if (!job) {
        return send(response, 404, { error: "Task run not found." }, origin);
      }
      await pauseTaskJob(job, { onUpdate: persist });
      await interruptTask(job, { pauseGoal: true });
      return send(response, 202, { job: taskForResponse(job) }, origin);
    }

    const resumeMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/resume$/);
    if (request.method === "POST" && resumeMatch) {
      const job = taskJobs.get(resumeMatch[1]);
      if (!job) {
        return send(response, 404, { error: "Task run not found." }, origin);
      }
      const threadId = job.agentSessions?.codex?.threadId;
      if (threadId && job.goal?.provider === "codex") {
        const result = await setCodexGoal(threadId, {
          objective: job.goal.objective,
          status: "active",
          tokenBudget: job.goal.tokenBudget,
        }, { cwd: job.workspace?.path ?? job.repository });
        if (result?.goal) {
          job.goal = {
            ...job.goal,
            ...result.goal,
            enabled: true,
            provider: "codex",
            native: true,
          };
        }
      }
      const runtimeOptions = {
        onUpdate: persist,
        worktreeRoot: process.env.COUNCIL_WORKTREE_ROOT,
        agentRuntime: processRuntime,
      };
      void resumeTaskJob(job, runtimeOptions);
      return send(response, 202, { job: taskForResponse(job) }, origin);
    }

    const goalMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/goal$/);
    if (request.method === "POST" && goalMatch) {
      const job = taskJobs.get(goalMatch[1]);
      if (!job) {
        return send(response, 404, { error: "Task run not found." }, origin);
      }
      if (!job.goal?.enabled) {
        throw new Error("This task was not started in Goal mode.");
      }
      const payload = await body(request);
      const objective = String(
        payload.objective ?? job.goal.objective,
      ).trim();
      if (!objective) throw new Error("Enter a goal objective.");
      const tokenBudget = Math.max(
        1_000,
        Math.min(
          1_000_000,
          Math.round(Number(payload.tokenBudget ?? job.goal.tokenBudget)) ||
            job.goal.tokenBudget,
        ),
      );
      const nextGoal = {
        ...job.goal,
        objective: objective.slice(0, 20_000),
        tokenBudget,
        updatedAt: new Date().toISOString(),
      };
      const active = activeAgentControls.get(job.id);
      let nativeGoal = null;
      if (job.goal.provider === "codex" && active?.controller?.setGoal) {
        nativeGoal = await active.controller.setGoal(nextGoal);
      } else if (
        job.goal.provider === "codex" &&
        job.agentSessions?.codex?.threadId
      ) {
        nativeGoal = (
          await setCodexGoal(
            job.agentSessions.codex.threadId,
            nextGoal,
            { cwd: job.workspace?.path ?? job.repository },
          )
        )?.goal;
      }
      if (
        job.goal.provider === "claude" &&
        nextGoal.objective !== job.goal.objective
      ) {
        delete job.agentSessions?.claude;
      }
      job.goal = {
        ...nextGoal,
        ...(nativeGoal ?? {}),
        enabled: true,
        provider: job.goal.provider,
        native:
          job.goal.provider === "claude"
            ? true
            : Boolean(nativeGoal) || job.goal.native,
      };
      job.updatedAt = new Date().toISOString();
      job.events.push({
        stage: "goal_updated",
        message: "Goal objective and budget updated.",
        at: job.updatedAt,
      });
      await persist();
      return send(response, 200, { job: taskForResponse(job) }, origin);
    }

    if (request.method === "DELETE" && goalMatch) {
      const job = taskJobs.get(goalMatch[1]);
      if (!job) {
        return send(response, 404, { error: "Task run not found." }, origin);
      }
      if (["queued", "running", "awaiting_approval"].includes(job.status)) {
        throw new Error("Pause or stop the active goal before clearing it.");
      }
      const threadId = job.agentSessions?.codex?.threadId;
      if (threadId && job.goal?.provider === "codex") {
        await clearCodexGoal(threadId, {
          cwd: job.workspace?.path ?? job.repository,
        });
      }
      if (job.goal?.provider === "claude") {
        delete job.agentSessions?.claude;
      }
      job.goal = null;
      job.updatedAt = new Date().toISOString();
      job.events.push({
        stage: "goal_cleared",
        message: "Durable goal metadata cleared.",
        at: job.updatedAt,
      });
      if (job.status === "paused") {
        job.status = "failed";
        job.stage = "failed";
        job.failedStage = job.pausedStage ?? "execute";
        job.error = "Goal mode was cleared. Restart the task to continue without it.";
      }
      await persist();
      return send(response, 200, { job: taskForResponse(job) }, origin);
    }

    const approvalMatch = url.pathname.match(
      /^\/v1\/tasks\/([^/]+)\/approval$/,
    );
    if (request.method === "POST" && approvalMatch) {
      const job = taskJobs.get(approvalMatch[1]);
      if (!job?.approval || job.approval.status !== "pending") {
        return send(
          response,
          404,
          { error: "No pending approval for this task." },
          origin,
        );
      }
      const payload = await body(request);
      const allowed = new Set([
        "accept",
        "acceptForSession",
        "decline",
        "cancel",
      ]);
      const decision = allowed.has(payload.decision)
        ? payload.decision
        : "decline";
      const key = `${job.id}:${job.approval.id}`;
      const waiter = approvalWaiters.get(key);
      if (!waiter) {
        throw new Error("The agent approval session is no longer active.");
      }
      approvalWaiters.delete(key);
      job.approval.status = "decided";
      job.approval.decision = decision;
      job.approval.decidedAt = new Date().toISOString();
      job.status = decision === "cancel" ? "running" : "running";
      job.updatedAt = job.approval.decidedAt;
      job.events.push({
        stage: "approval_decided",
        message:
          decision === "accept" || decision === "acceptForSession"
            ? "Permission granted. The agent is continuing."
            : "Permission denied.",
        at: job.updatedAt,
      });
      if (decision === "cancel") job.cancelRequested = true;
      await persist();
      waiter(decision);
      return send(response, 200, { job: taskForResponse(job) }, origin);
    }

    const archiveMatch = url.pathname.match(
      /^\/v1\/tasks\/([^/]+)\/archive$/,
    );
    if (request.method === "POST" && archiveMatch) {
      const job = taskJobs.get(archiveMatch[1]);
      if (!job) {
        return send(response, 404, { error: "Task run not found." }, origin);
      }
      if (
        ["queued", "running", "awaiting_approval"].includes(job.status) ||
        job.stage === "accepting"
      ) {
        throw new Error("Cancel the active task before archiving it.");
      }
      const payload = await body(request);
      const archived = payload.archived !== false;
      const now = new Date().toISOString();
      job.archivedAt = archived ? now : null;
      job.updatedAt = now;
      job.events ??= [];
      job.events.push({
        stage: archived ? "archived" : "restored",
        message: archived
          ? "Task archived. Its history is preserved."
          : "Task restored to the active task list.",
        at: now,
      });
      await persist();
      return send(
        response,
        200,
        { job: taskForResponse(job), archived },
        origin,
      );
    }

    const deleteTaskMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)$/);
    if (request.method === "DELETE" && deleteTaskMatch) {
      const job = taskJobs.get(deleteTaskMatch[1]);
      if (!job) {
        return send(response, 404, { error: "Task run not found." }, origin);
      }
      await deleteTaskJob(job);
      taskJobs.delete(job.id);
      await persist();
      return send(response, 200, { deleted: true, id: job.id }, origin);
    }

    const acceptMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/accept$/);
    if (request.method === "POST" && acceptMatch) {
      const job = taskJobs.get(acceptMatch[1]);
      if (!job) {
        return send(response, 404, { error: "Task run not found." }, origin);
      }
      await acceptTaskJob(job, { onUpdate: persist });
      if (job.status === "conflict") {
        return send(
          response,
          200,
          {
            job: taskForResponse(job),
            conflict: true,
            contextJob: null,
          },
          origin,
        );
      }
      const queued = await enqueueContextJob(job.repository, {
        reason: "accepted_task",
        taskId: job.id,
        queueAfterActive: true,
        ...settings.context,
      });
      job.contextRefreshJobId = queued.job.id;
      await persist();
      return send(
        response,
        200,
        {
          job: taskForResponse(job),
          contextJob: contextForResponse(queued.job),
        },
        origin,
      );
    }

    const rejectMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/reject$/);
    if (request.method === "POST" && rejectMatch) {
      const job = taskJobs.get(rejectMatch[1]);
      if (!job) {
        return send(response, 404, { error: "Task run not found." }, origin);
      }
      await rejectTaskJob(job, { onUpdate: persist });
      return send(
        response,
        200,
        { job: taskForResponse(job) },
        origin,
      );
    }

    const reviseMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/revise$/);
    if (request.method === "POST" && reviseMatch) {
      const job = taskJobs.get(reviseMatch[1]);
      if (!job) {
        return send(response, 404, { error: "Task run not found." }, origin);
      }
      const payload = await body(request);
      if (job.status !== "awaiting_review") {
        throw new Error("Only a task awaiting review can receive change requests.");
      }
      const feedback = String(payload.feedback ?? "").trim();
      if (!feedback) throw new Error("Describe the additional changes you need.");
      void reviseTaskJob(job, feedback, {
        onUpdate: persist,
        agentRuntime: processRuntime,
      });
      return send(
        response,
        202,
        { job: taskForResponse(job) },
        origin,
      );
    }

    const taskGitMatch = url.pathname.match(
      /^\/v1\/tasks\/([^/]+)\/git\/(commit|push|draft-pr)$/,
    );
    if (request.method === "POST" && taskGitMatch) {
      const job = taskJobs.get(taskGitMatch[1]);
      if (!job) {
        return send(response, 404, { error: "Task run not found." }, origin);
      }
      const payload = await body(request);
      if (taskGitMatch[2] === "commit") {
        const result = await createTaskCommit(
          job,
          payload.message ?? taskCommitMessage(job),
          { onUpdate: persist },
        );
        return send(
          response,
          200,
          { job: taskForResponse(result.job), repository: result.repository },
          origin,
        );
      }
      if (taskGitMatch[2] === "push") {
        await pushTaskCommit(job, payload.confirmed, { onUpdate: persist });
        return send(response, 200, { job: taskForResponse(job) }, origin);
      }
      await createTaskDraftPullRequest(job, payload, { onUpdate: persist });
      return send(response, 200, { job: taskForResponse(job) }, origin);
    }

    const taskGitPreviewMatch = url.pathname.match(
      /^\/v1\/tasks\/([^/]+)\/git$/,
    );
    if (request.method === "GET" && taskGitPreviewMatch) {
      const job = taskJobs.get(taskGitPreviewMatch[1]);
      if (!job) {
        return send(response, 404, { error: "Task run not found." }, origin);
      }
      const repository = await inspectRepository(job.repository);
      return send(
        response,
        200,
        {
          repository,
          git: job.git,
          defaultCommitMessage: taskCommitMessage(job),
        },
        origin,
      );
    }

    if (
      request.method === "GET" &&
      url.pathname.startsWith("/v1/tasks/")
    ) {
      const id = url.pathname.slice("/v1/tasks/".length);
      const job = taskJobs.get(id);
      return job
        ? send(response, 200, { job: taskForResponse(job) }, origin)
        : send(response, 404, { error: "Task run not found." }, origin);
    }

    return send(response, 404, { error: "Not found." }, origin);
  } catch (error) {
    return send(
      response,
      400,
      { error: String(error.stderr || error.message || error) },
      origin,
    );
  }
});

server.listen(PORT, HOST, () => {
  console.log(`code-council local service ready at http://${HOST}:${PORT}`);
});
