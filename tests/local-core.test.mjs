import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  acceptTaskJob,
  answerTaskClarification,
  buildTaskContextPack,
  cancelTaskJob,
  clarificationFromOutput,
  cloneGitHubRepository,
  createChatJob,
  createContextJob,
  createTaskCommit,
  createTaskJob,
  deleteTaskJob,
  executeChatJob,
  executeTaskJob,
  generateContext,
  inferPromptIntent,
  inspectRepository,
  listRepositoryFiles,
  manualTaskDecision,
  normalizeTaskJob,
  normalizeCodexUsage,
  openFileInEditor,
  parseClaudeModelList,
  parseClaudeUsageOutput,
  readRepositoryFile,
  retryTaskJob,
  reviseTaskJob,
  routeTask,
  validateAgentConfig,
  validateContextConfig,
  validateTaskContextPolicy,
} from "../local/core.mjs";

const execFileAsync = promisify(execFile);
const repositoryPath = path.resolve(
  new URL("..", import.meta.url).pathname,
);

test("local repository inspection returns a real Git SHA", async () => {
  const repository = await inspectRepository(repositoryPath);
  assert.equal(repository.name.toLowerCase(), "code-council");
  assert.match(repository.sha, /^[0-9a-f]{40}$/);
  assert.ok(repository.trackedFiles > 0);
});

test("repository browser lists text files and rejects unsafe reads", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "council-browser-"));
  await execFileAsync("git", ["init", "-q"], { cwd: temporary });
  await mkdir(path.join(temporary, "src"), { recursive: true });
  await writeFile(path.join(temporary, "src", "index.ts"), "export const value = 1;\n");
  await writeFile(path.join(temporary, "README.md"), "# Browser\n");
  await execFileAsync("git", ["add", "src/index.ts", "README.md"], {
    cwd: temporary,
  });
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=Council test",
      "-c",
      "user.email=test@council.local",
      "commit",
      "-q",
      "-m",
      "initial",
    ],
    { cwd: temporary },
  );
  await writeFile(path.join(temporary, "notes.txt"), "untracked\n");
  await writeFile(path.join(temporary, "binary.bin"), Buffer.from([0, 1, 2]));
  await symlink(
    path.join(os.tmpdir(), "outside-council-file"),
    path.join(temporary, "outside-link"),
  );

  try {
    const listing = await listRepositoryFiles(temporary);
    assert.ok(listing.files.includes("README.md"));
    assert.ok(listing.files.includes("src/index.ts"));
    assert.ok(listing.files.includes("notes.txt"));

    const source = await readRepositoryFile(temporary, "src/index.ts");
    assert.equal(source.language, "ts");
    assert.equal(source.content, "export const value = 1;\n");
    assert.equal(source.lines, 2);

    await assert.rejects(
      readRepositoryFile(temporary, "../outside.txt"),
      /inside the connected repository/,
    );
    await assert.rejects(
      readRepositoryFile(temporary, "binary.bin"),
      /Binary files/,
    );
    await assert.rejects(
      readRepositoryFile(temporary, "outside-link"),
      /does not exist/,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("repository fingerprint stays stable when identical working content is committed", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "council-fingerprint-"));
  await execFileAsync("git", ["init", "-q"], { cwd: temporary });
  await writeFile(path.join(temporary, "app.js"), "export const value = 1;\n");
  await execFileAsync("git", ["add", "app.js"], { cwd: temporary });
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=Council test",
      "-c",
      "user.email=test@council.local",
      "commit",
      "-q",
      "-m",
      "initial",
    ],
    { cwd: temporary },
  );
  try {
    await writeFile(path.join(temporary, "app.js"), "export const value = 2;\n");
    const beforeCommit = await inspectRepository(temporary);
    assert.equal(beforeCommit.dirty, true);
    await execFileAsync("git", ["add", "app.js"], { cwd: temporary });
    await execFileAsync(
      "git",
      [
        "-c",
        "user.name=Council test",
        "-c",
        "user.email=test@council.local",
        "commit",
        "-q",
        "-m",
        "update",
      ],
      { cwd: temporary },
    );
    const afterCommit = await inspectRepository(temporary);
    assert.equal(afterCommit.dirty, false);
    assert.equal(afterCommit.fingerprint, beforeCommit.fingerprint);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("fresh-memory typo routes to Codex only", () => {
  const decision = routeTask("Fix a typo in README", {
    memoryFresh: true,
  });
  assert.equal(decision.strategy, "codex_only");
  assert.deepEqual(decision.agents, ["codex"]);
});

test("a clearly small task stays single-agent without repository memory", () => {
  const decision = routeTask("Rename one heading in README");
  assert.equal(decision.strategy, "codex_only");
});

test("high-risk task routes through a council", () => {
  const decision = routeTask("Migrate the authentication schema safely", {
    memoryFresh: true,
  });
  assert.equal(decision.strategy, "council_plan_codex_execute");
  assert.deepEqual(decision.agents, ["codex", "claude"]);
});

test("auto intent separates read-only chat from coding work", () => {
  assert.equal(inferPromptIntent("hi"), "chat");
  assert.equal(
    inferPromptIntent("Can you explain how repository context is used?"),
    "chat",
  );
  assert.equal(inferPromptIntent("Fix the context refresh bug"), "code");
  assert.equal(inferPromptIntent("hi", "code"), "chat");
  assert.equal(inferPromptIntent("Fix the context refresh bug", "code"), "code");
});

test("legacy zero-change chat results migrate into the main conversation", () => {
  const legacy = normalizeTaskJob({
    id: "legacy-chat",
    prompt: "hi",
    decision: manualTaskDecision("codex_only"),
    status: "awaiting_review",
    stage: "awaiting_review",
    createdAt: "2026-07-20T12:00:00.000Z",
    result: { execution: "Hi! What would you like to work on?" },
    review: { files: [], stat: "No source changes" },
  });
  assert.equal(legacy.kind, "chat");
  assert.equal(legacy.status, "completed");
  assert.equal(legacy.review, null);
  assert.equal(legacy.conversation.length, 2);
  assert.equal(
    legacy.conversation.at(-1).content,
    "Hi! What would you like to work on?",
  );
  assert.equal(legacy.agentConfig.codex.model, "gpt-5.6-sol");
  assert.equal(legacy.agentConfig.claude.model, "claude-opus-4-8");
});

test("legacy patch-apply failures migrate to a recoverable conflict state", () => {
  const legacy = normalizeTaskJob({
    id: "legacy-conflict",
    prompt: "Fix the light theme",
    decision: manualTaskDecision("codex_only"),
    status: "failed",
    stage: "failed",
    createdAt: "2026-07-20T12:00:00.000Z",
    updatedAt: "2026-07-20T12:05:00.000Z",
    error:
      "error: patch failed: app/council-ide.css:573\nerror: app/council-ide.css: patch does not apply",
    review: {
      files: ["app/council-ide.css"],
      stat: "1 file changed",
    },
    workspace: { path: "/tmp/council-task", branch: "council/task" },
  });
  assert.equal(legacy.status, "conflict");
  assert.equal(legacy.failedStage, "accept");
  assert.deepEqual(legacy.conflict.files, ["app/council-ide.css"]);
  assert.match(legacy.error, /No files were changed/);
});

test("ambiguous coding tasks pause for clarification before agents run", async () => {
  const repository = await inspectRepository(repositoryPath);
  const job = createTaskJob(
    repository,
    "make it better",
    manualTaskDecision("codex_only"),
  );
  assert.equal(job.status, "awaiting_input");
  assert.equal(job.clarification.status, "pending");
  assert.equal(job.conversation.at(-1).kind, "clarification");

  await answerTaskClarification(
    job,
    "Improve the README installation section and verify its commands.",
  );
  assert.equal(job.status, "queued");
  assert.match(job.prompt, /Improve the README installation section/);
  assert.equal(job.conversation.at(-1).role, "user");
});

test("agents can explicitly pause a task for a discovered clarification", () => {
  assert.equal(
    clarificationFromOutput(
      "COUNCIL_CLARIFICATION: Should this preserve the legacy API response shape?",
    ),
    "Should this preserve the legacy API response shape?",
  );
  assert.equal(clarificationFromOutput("Implementation is ready."), null);
});

test("council planning stays read-only and creates no worktree before clarification", async () => {
  const repository = await inspectRepository(repositoryPath);
  const job = createTaskJob(
    repository,
    "Update the repository authentication behavior",
    manualTaskDecision("council_plan_codex_execute"),
  );
  await executeTaskJob(job, {
    worktreeRoot: path.join(
      os.tmpdir(),
      `council-lazy-worktree-${Date.now()}`,
    ),
    claudeRunner: async (cwd, prompt, sandbox) => {
      assert.equal(cwd, repositoryPath);
      assert.equal(sandbox, "read-only");
      assert.match(prompt, /Propose a concrete coding plan/);
      return {
        text: "COUNCIL_CLARIFICATION: Which authentication flow should change?",
        durationMs: 1,
      };
    },
    codexRunner: async () => {
      throw new Error("Codex should not run before the clarification is answered.");
    },
  });
  assert.equal(job.status, "awaiting_input");
  assert.equal(job.workspace, null);
});

test("chat tasks answer read-only and preserve a conversation", async () => {
  const repository = await inspectRepository(repositoryPath);
  const job = createChatJob(
    repository,
    "What does this repository do?",
    "codex_only",
  );
  let sandboxMode = "";
  await executeChatJob(job, null, {
    codexRunner: async (cwd, prompt, sandbox) => {
      assert.equal(cwd, repositoryPath);
      assert.match(prompt, /read-only chat/);
      sandboxMode = sandbox;
      return { text: "Council coordinates coding agents.", durationMs: 1 };
    },
  });
  assert.equal(sandboxMode, "read-only");
  assert.equal(job.status, "completed");
  assert.equal(job.conversation.length, 2);
  assert.equal(job.conversation.at(-1).content, "Council coordinates coding agents.");
});

test("a zero-change code run completes as a conversation instead of empty review", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "council-no-change-"));
  const repositoryRoot = path.join(temporary, "repository");
  const worktreeRoot = path.join(temporary, "worktrees");
  await mkdir(repositoryRoot);
  await execFileAsync("git", ["init", "-q"], { cwd: repositoryRoot });
  await writeFile(path.join(repositoryRoot, "README.md"), "# Unchanged\n");
  await execFileAsync("git", ["add", "README.md"], { cwd: repositoryRoot });
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=Council test",
      "-c",
      "user.email=test@council.local",
      "commit",
      "-q",
      "-m",
      "initial",
    ],
    { cwd: repositoryRoot },
  );
  try {
    const repository = await inspectRepository(repositoryRoot);
    const job = createTaskJob(
      repository,
      "Inspect the README and report whether a change is needed",
      manualTaskDecision("codex_only"),
    );
    await executeTaskJob(job, {
      worktreeRoot,
      codexRunner: async () => ({
        text: "The README is already correct; no changes are needed.",
        durationMs: 1,
      }),
    });
    assert.equal(job.status, "completed");
    assert.equal(job.review, null);
    assert.equal(
      job.conversation.at(-1).content,
      "The README is already correct; no changes are needed.",
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("Codex rate-limit windows are exposed as remaining session and weekly usage", () => {
  const usage = normalizeCodexUsage({
    rateLimitsByLimitId: {
      codex: {
        planType: "pro",
        primary: {
          usedPercent: 18,
          resetsAt: 1_800_000_000,
          windowDurationMins: 300,
        },
        secondary: {
          usedPercent: 41,
          resetsAt: 1_800_500_000,
          windowDurationMins: 10_080,
        },
      },
    },
  });
  assert.equal(usage.plan, "pro");
  assert.equal(usage.session.remainingPercent, 82);
  assert.equal(usage.weekly.remainingPercent, 59);
  assert.equal(usage.session.durationMinutes, 300);
});

test("a weekly-only Codex limit is not mislabeled as session usage", () => {
  const usage = normalizeCodexUsage({
    rateLimits: {
      primary: { usedPercent: 81, windowDurationMins: 10_080 },
    },
  });
  assert.equal(usage.session, null);
  assert.equal(usage.weekly.remainingPercent, 19);
});

test("Claude /usage output is parsed without making a model request", () => {
  const usage = parseClaudeUsageOutput(`
    Current session
    █████ 24% used
    Current week (all models)
    █████████ 61% used
  `);
  assert.equal(usage.session.remainingPercent, 76);
  assert.equal(usage.weekly.remainingPercent, 39);
});

test("context dry run uses Opus at high effort without calling a model", async () => {
  const result = await generateContext(repositoryPath, { dryRun: true });
  assert.equal(result.command.model, "claude-opus-4-8");
  assert.equal(result.command.effort, "high");
  assert.equal(result.command.permissionMode, "plan");
});

test("context dry run supports Codex with structured read-only generation", async () => {
  const result = await generateContext(repositoryPath, {
    dryRun: true,
    provider: "codex",
    model: "gpt-5.6-sol",
    reasoning: "xhigh",
  });
  assert.equal(result.command.executable, "codex");
  assert.equal(result.command.provider, "codex");
  assert.equal(result.command.model, "gpt-5.6-sol");
  assert.equal(result.command.effort, "xhigh");
  assert.equal(result.command.permissionMode, "read-only");
});

test("context generation receives compact Graphify evidence instead of the full graph", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "council-context-graph-"));
  const repositoryRoot = path.join(temporary, "repository");
  await mkdir(path.join(repositoryRoot, "graphify-out"), { recursive: true });
  await execFileAsync("git", ["init", "-q"], { cwd: repositoryRoot });
  await writeFile(
    path.join(repositoryRoot, "index.ts"),
    "export function startServer() { return true; }\n",
  );
  await execFileAsync("git", ["add", "index.ts"], { cwd: repositoryRoot });
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=Council test",
      "-c",
      "user.email=test@council.local",
      "commit",
      "-q",
      "-m",
      "initial",
    ],
    { cwd: repositoryRoot },
  );
  await writeFile(
    path.join(repositoryRoot, "graphify-out", "graph.json"),
    "{}\n",
  );
  let receivedPrompt = "";

  try {
    await generateContext(repositoryRoot, {
      provider: "codex",
      model: "gpt-5.6-sol",
      reasoning: "high",
      graphifyRunner: async () => ({
        stdout:
          "Traversal: BFS depth=2 | Start: ['startServer'] | 1 nodes found\n\nNODE startServer [src=index.ts loc=L1 community=]",
        durationMs: 1,
      }),
      codexRunner: async (_cwd, prompt) => {
        receivedPrompt = prompt;
        return {
          text: JSON.stringify({
            summary: "A small server.",
            documents: [
              {
                path: "agent_context/repository.md",
                title: "Repository",
                body: "# Repository\n\n`startServer` is defined in `index.ts`.",
                sources: ["index.ts"],
              },
            ],
            deletePaths: [],
          }),
          durationMs: 1,
          usage: null,
        };
      },
    });

    assert.match(receivedPrompt, /<graphify_evidence>/);
    assert.match(receivedPrompt, /NODE startServer \[src=index\.ts/);
    assert.match(receivedPrompt, /Do not read or copy the full graphify-out/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("manual routing preserves the user's explicit council choice", () => {
  const decision = manualTaskDecision("council_plan_codex_execute");
  assert.equal(decision.routingMode, "manual");
  assert.deepEqual(decision.agents, ["codex", "claude"]);
  assert.deepEqual(decision.stages, [
    "prepare",
    "propose",
    "critique",
    "revise",
    "execute",
    "verify",
    "review",
  ]);
  assert.ok(decision.stages.includes("review"));
});

test("manual routing supports a direct Claude Code task", () => {
  const decision = manualTaskDecision("claude_only");
  assert.equal(decision.label, "Claude only");
  assert.deepEqual(decision.agents, ["claude"]);
  assert.deepEqual(decision.stages, [
    "prepare",
    "execute",
    "verify",
    "review",
  ]);
});

test("Claude model discovery preserves supported aliases and excludes Fable", () => {
  assert.deepEqual(
    parseClaudeModelList(
      "Available: sonnet, opus, haiku, fable, best, sonnet[1m], opus[1m], opusplan, default, or a full model ID.",
    ),
    [
      "sonnet",
      "opus",
      "haiku",
      "best",
      "sonnet[1m]",
      "opus[1m]",
      "opusplan",
      "default",
    ],
  );
});

test("task context is bounded and records the selected memory files", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "council-context-pack-"));
  const repositoryRoot = path.join(temporary, "repository");
  await mkdir(path.join(repositoryRoot, "agent_context"), { recursive: true });
  await execFileAsync("git", ["init", "-q"], { cwd: repositoryRoot });
  await writeFile(
    path.join(repositoryRoot, "server.mjs"),
    "export function persistTask() { return true; }\n",
  );
  await execFileAsync("git", ["add", "server.mjs"], { cwd: repositoryRoot });
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=Council test",
      "-c",
      "user.email=test@council.local",
      "commit",
      "-q",
      "-m",
      "initial",
    ],
    { cwd: repositoryRoot },
  );
  await writeFile(
    path.join(repositoryRoot, "agent_context", "repository.md"),
    "# Repository\n\nThe local server persists task worktrees and context jobs.\n",
  );
  await writeFile(
    path.join(repositoryRoot, "agent_context", "manifest.json"),
    JSON.stringify({
      schemaVersion: 2,
      documents: ["agent_context/repository.md"],
    }),
  );

  try {
    const pack = await buildTaskContextPack(
      repositoryRoot,
      "Persist task worktrees and context jobs in the local server",
      { maxChars: 6_000 },
    );
    assert.ok(pack.selectedPaths.length > 0);
    assert.ok(pack.selectedPaths.includes("agent_context/repository.md"));
    assert.ok(pack.chars <= 6_500);
    assert.equal(pack.estimatedTokens, Math.ceil(pack.chars / 4));
    assert.match(pack.text, /TASK CONTEXT CAPSULE/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("task context can be disabled and its token budget is user-controlled", async () => {
  const disabled = await buildTaskContextPack(
    repositoryPath,
    "Inspect the local server",
    { enabled: false, tokenBudget: 12_000 },
  );
  assert.equal(disabled.status, "disabled");
  assert.equal(disabled.text, "");
  assert.equal(disabled.estimatedTokens, 0);

  const bounded = await buildTaskContextPack(
    repositoryPath,
    "Inspect the local server",
    { tokenBudget: 1_000, graphify: false },
  );
  assert.equal(bounded.budgetTokens, 1_000);
  assert.ok(bounded.estimatedTokens <= 1_100);
});

test("Graphify evidence ranks related memory and caches identical scoped queries", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "council-graph-rank-"));
  const repositoryRoot = path.join(temporary, "repository");
  await mkdir(path.join(repositoryRoot, "src"), { recursive: true });
  await mkdir(path.join(repositoryRoot, "agent_context", "symbols", "src"), {
    recursive: true,
  });
  await mkdir(path.join(repositoryRoot, "graphify-out"), { recursive: true });
  await execFileAsync("git", ["init", "-q"], { cwd: repositoryRoot });
  await writeFile(
    path.join(repositoryRoot, "src", "payments.ts"),
    "export function processRefund() { return true; }\n",
  );
  await writeFile(
    path.join(repositoryRoot, "src", "unrelated.ts"),
    "export function unrelated() { return true; }\n",
  );
  await execFileAsync("git", ["add", "src"], { cwd: repositoryRoot });
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=Council test",
      "-c",
      "user.email=test@council.local",
      "commit",
      "-q",
      "-m",
      "initial",
    ],
    { cwd: repositoryRoot },
  );
  const sha = (
    await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot })
  ).stdout.trim();
  await writeFile(
    path.join(repositoryRoot, "graphify-out", "graph.json"),
    "{}\n",
  );
  await writeFile(
    path.join(repositoryRoot, "agent_context", "repository.md"),
    "# Repository\n\nA sample service.\n",
  );
  await writeFile(
    path.join(
      repositoryRoot,
      "agent_context",
      "symbols",
      "src",
      "processRefund.md",
    ),
    "---\nsources: [\"src/payments.ts\"]\n---\n# processRefund\n",
  );
  await writeFile(
    path.join(
      repositoryRoot,
      "agent_context",
      "symbols",
      "src",
      "unrelated.md",
    ),
    "---\nsources: [\"src/unrelated.ts\"]\n---\n# unrelated\n",
  );
  await writeFile(
    path.join(repositoryRoot, "agent_context", "manifest.json"),
    JSON.stringify({
      schemaVersion: 2,
      sourceSha: sha,
      documents: [
        "agent_context/repository.md",
        "agent_context/symbols/src/processRefund.md",
        "agent_context/symbols/src/unrelated.md",
      ],
    }),
  );

  let queries = 0;
  const graphifyRunner = async () => {
    queries += 1;
    return {
      stdout: `Traversal: BFS depth=2 | Start: ['processRefund'] | 1 nodes found

NODE processRefund [src=src/payments.ts loc=L1 community=]`,
      durationMs: 1,
    };
  };

  try {
    const first = await buildTaskContextPack(
      repositoryRoot,
      "adjust the behavior safely",
      { tokenBudget: 1_500, graphifyRunner },
    );
    const second = await buildTaskContextPack(
      repositoryRoot,
      "adjust the behavior safely",
      { tokenBudget: 1_500, graphifyRunner },
    );

    assert.equal(queries, 1);
    assert.equal(first.graphify.status, "used");
    assert.deepEqual(first.graphify.matchedPaths, ["src/payments.ts"]);
    assert.ok(
      first.selectedPaths.includes(
        "agent_context/symbols/src/processRefund.md",
      ),
    );
    assert.ok(
      first.selectedEvidence.find(
        (entry) =>
          entry.path === "agent_context/symbols/src/processRefund.md",
      ).graphScore > 0,
    );
    assert.ok(
      !first.selectedPaths.includes(
        "agent_context/symbols/src/unrelated.md",
      ),
    );
    assert.equal(second.graphify.cacheHit, true);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("sparse Graphify evidence gets one bounded adaptive follow-up with a persisted manifest", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "council-graph-adaptive-"));
  const repositoryRoot = path.join(temporary, "repository");
  await mkdir(path.join(repositoryRoot, "src", "auth"), { recursive: true });
  await mkdir(path.join(repositoryRoot, "agent_context", "modules"), {
    recursive: true,
  });
  await mkdir(path.join(repositoryRoot, "graphify-out"), { recursive: true });
  await execFileAsync("git", ["init", "-q"], { cwd: repositoryRoot });
  await writeFile(
    path.join(repositoryRoot, "src", "auth", "controller.ts"),
    "export function authenticate() { return true; }\n",
  );
  await writeFile(
    path.join(repositoryRoot, "src", "auth", "session.ts"),
    "export const sessionStore = new Map();\n",
  );
  await writeFile(
    path.join(repositoryRoot, "src", "auth", "routes.ts"),
    "export const loginRoute = '/login';\n",
  );
  await execFileAsync("git", ["add", "src"], { cwd: repositoryRoot });
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=Council test",
      "-c",
      "user.email=test@council.local",
      "commit",
      "-q",
      "-m",
      "initial",
    ],
    { cwd: repositoryRoot },
  );
  const sha = (
    await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot })
  ).stdout.trim();
  await writeFile(
    path.join(repositoryRoot, "graphify-out", "graph.json"),
    "{}\n",
  );
  await writeFile(
    path.join(repositoryRoot, "agent_context", "repository.md"),
    "# Repository\n\nAuthentication service.\n",
  );
  await writeFile(
    path.join(repositoryRoot, "agent_context", "modules", "auth.md"),
    "# Authentication\n\nSources: src/auth/controller.ts, src/auth/session.ts, src/auth/routes.ts.\n",
  );
  await writeFile(
    path.join(repositoryRoot, "agent_context", "manifest.json"),
    JSON.stringify({
      schemaVersion: 2,
      sourceSha: sha,
      documents: [
        "agent_context/repository.md",
        "agent_context/modules/auth.md",
      ],
    }),
  );

  const operations = [];
  try {
    const pack = await buildTaskContextPack(
      repositoryRoot,
      "change authentication session handling",
      {
        tokenBudget: 4_000,
        cache: false,
        graphifyRunner: async (_executable, args) => {
          operations.push(args[0]);
          if (args[0] === "affected") {
            return {
              stdout: `Affected nodes for authenticate()
- SessionStore() [calls] src/auth/session.ts:L1
- loginRoute [calls] src/auth/routes.ts:L1
- authTest [calls] tests/auth.test.ts:L1`,
              durationMs: 7,
            };
          }
          return {
            stdout:
              "Traversal: BFS depth=2 | Start: ['authenticate'] | 1 nodes found\n\nNODE authenticate() [src=src/auth/controller.ts loc=L1 community=]",
            durationMs: 5,
          };
        },
      },
    );

    assert.equal(operations.filter((operation) => operation === "affected").length, 1);
    assert.equal(operations.at(-1), "affected");
    assert.equal(pack.graphify.escalated, true);
    assert.equal(pack.graphify.executedCalls, operations.length);
    assert.equal(pack.graphify.operations.at(-1).followup, true);
    assert.equal(pack.graphify.operations.at(-1).operation, "affected");
    assert.equal(pack.graphify.confidence.level, "high");
    assert.equal(pack.retrieval.adaptiveFollowup, true);
    assert.equal(pack.retrieval.graphifyDurationMs, 17);
    assert.equal(pack.manifest.graph.operations.length, operations.length);
    assert.ok(pack.manifest.graph.matchedPaths.includes("src/auth/session.ts"));
    assert.ok(
      pack.manifest.memory.some(
        (entry) => entry.path === "agent_context/modules/auth.md",
      ),
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("Graphify provides a bounded structural fallback before memory exists", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "council-graph-only-"));
  const repositoryRoot = path.join(temporary, "repository");
  await mkdir(path.join(repositoryRoot, "graphify-out"), { recursive: true });
  await execFileAsync("git", ["init", "-q"], { cwd: repositoryRoot });
  await writeFile(
    path.join(repositoryRoot, "index.ts"),
    "export const entry = true;\n",
  );
  await execFileAsync("git", ["add", "index.ts"], { cwd: repositoryRoot });
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=Council test",
      "-c",
      "user.email=test@council.local",
      "commit",
      "-q",
      "-m",
      "initial",
    ],
    { cwd: repositoryRoot },
  );
  await writeFile(
    path.join(repositoryRoot, "graphify-out", "graph.json"),
    "{}\n",
  );

  try {
    const pack = await buildTaskContextPack(
      repositoryRoot,
      "find the entry point",
      {
        tokenBudget: 700,
        graphifyRunner: async () => ({
          stdout:
            "Traversal: BFS depth=2 | Start: ['entry'] | 1 nodes found\n\nNODE entry [src=index.ts loc=L1 community=]",
          durationMs: 1,
        }),
      },
    );
    assert.equal(pack.strategy, "graph_only");
    assert.equal(pack.graphify.status, "used");
    assert.deepEqual(pack.graphify.matchedPaths, ["index.ts"]);
    assert.match(pack.text, /Graphify scoped dependency query/);
    assert.ok(pack.estimatedTokens <= 700);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("context jobs snapshot the selected model and survive JSON persistence", async () => {
  const repository = await inspectRepository(repositoryPath);
  const job = createContextJob(repository, {
    reason: "accepted_task",
    taskId: "task-1",
    provider: "codex",
    model: "gpt-5.6-sol",
    reasoning: "xhigh",
  });
  const restored = JSON.parse(JSON.stringify(job));
  assert.equal(restored.provider, "codex");
  assert.equal(restored.model, "gpt-5.6-sol");
  assert.equal(restored.effort, "xhigh");
  assert.equal(restored.reason, "accepted_task");
  assert.equal(restored.taskId, "task-1");
});

test("agent configuration validates model and reasoning choices", () => {
  assert.deepEqual(
    validateAgentConfig({
      codex: { model: "gpt-5.6-sol", reasoning: "xhigh" },
      claude: { model: "claude-opus-4-8", reasoning: "max" },
    }),
    {
      codex: { model: "gpt-5.6-sol", reasoning: "xhigh" },
      claude: { model: "claude-opus-4-8", reasoning: "max" },
    },
  );
  assert.throws(
    () =>
      validateAgentConfig({
        claude: { model: "claude-fable-5", reasoning: "high" },
      }),
    /Fable is disabled/,
  );
  assert.deepEqual(
    validateAgentConfig({
      codex: { model: "gpt-5.6-luna", reasoning: "max" },
      claude: { model: "opus[1m]", reasoning: "xhigh" },
    }),
    {
      codex: { model: "gpt-5.6-luna", reasoning: "max" },
      claude: { model: "opus[1m]", reasoning: "xhigh" },
    },
  );
});

test("editor handoff rejects paths outside the review workspace", async () => {
  await assert.rejects(
    openFileInEditor(repositoryPath, "../outside.txt"),
    /inside the task workspace/,
  );
});

test("repository context configuration validates each provider independently", () => {
  assert.deepEqual(
    validateContextConfig({
      provider: "codex",
      model: "gpt-5.6-sol",
      reasoning: "minimal",
    }),
    {
      provider: "codex",
      model: "gpt-5.6-sol",
      reasoning: "minimal",
      tokenBudget: 4_000,
      enabledByDefault: true,
      graphify: true,
    },
  );
  assert.deepEqual(validateContextConfig(), {
    provider: "claude",
    model: "claude-opus-4-8",
    reasoning: "high",
    tokenBudget: 4_000,
    enabledByDefault: true,
    graphify: true,
  });
  assert.throws(
    () =>
      validateContextConfig({
        provider: "claude",
        model: "claude-fable-5",
        reasoning: "high",
      }),
    /Fable is disabled/,
  );
  assert.deepEqual(
    validateTaskContextPolicy(
      { enabled: false, tokenBudget: 12_000, graphify: false },
      validateContextConfig(),
    ),
    { enabled: false, tokenBudget: 12_000, graphify: false },
  );
});

test("GitHub connections reject non-GitHub and ambiguous repository URLs", async () => {
  await assert.rejects(
    cloneGitHubRepository(
      "https://gitlab.com/example/project",
      path.join(os.tmpdir(), "council-github-invalid"),
    ),
    /github\.com URLs/,
  );
  await assert.rejects(
    cloneGitHubRepository(
      "https://github.com/owner/too/many/parts",
      path.join(os.tmpdir(), "council-github-invalid"),
    ),
    /owner\/repository/,
  );
});

test("task jobs snapshot selected models for durable background execution", async () => {
  const repository = await inspectRepository(repositoryPath);
  const job = createTaskJob(
    repository,
    "Inspect a focused module",
    manualTaskDecision("codex_only"),
    {
      codex: { model: "gpt-5.6-terra", reasoning: "medium" },
      claude: { model: "claude-opus-4-8", reasoning: "xhigh" },
    },
  );
  assert.equal(job.agentConfig.codex.model, "gpt-5.6-terra");
  assert.equal(job.agentConfig.codex.reasoning, "medium");
  assert.equal(job.agentConfig.claude.reasoning, "xhigh");
  assert.deepEqual(job.processes, []);
  assert.equal(job.approval, null);
});

test("task execution stays isolated until its patch is accepted", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "council-task-"));
  const repositoryRoot = path.join(temporary, "repository");
  const worktreeRoot = path.join(temporary, "worktrees");
  await mkdir(repositoryRoot);
  await execFileAsync("git", ["init", "-q"], { cwd: repositoryRoot });
  await writeFile(
    path.join(repositoryRoot, "README.md"),
    "# Before\n",
    "utf8",
  );
  await execFileAsync("git", ["add", "README.md"], { cwd: repositoryRoot });
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=Council test",
      "-c",
      "user.email=test@council.local",
      "commit",
      "-q",
      "-m",
      "initial",
    ],
    { cwd: repositoryRoot },
  );

  try {
    const repository = await inspectRepository(repositoryRoot);
    const job = createTaskJob(
      repository,
      "Update the README heading",
      manualTaskDecision("codex_only"),
    );
    await executeTaskJob(job, {
      worktreeRoot,
      codexRunner: async (cwd) => {
        await writeFile(path.join(cwd, "README.md"), "# After\n", "utf8");
        return { text: "Changed README.md", durationMs: 1 };
      },
    });

    assert.equal(job.status, "awaiting_review");
    assert.deepEqual(job.review.files, ["README.md"]);
    assert.equal(
      await readFile(path.join(repositoryRoot, "README.md"), "utf8"),
      "# Before\n",
    );

    await acceptTaskJob(job);
    assert.equal(job.status, "accepted");
    assert.equal(
      await readFile(path.join(repositoryRoot, "README.md"), "utf8"),
      "# After\n",
    );
    const staged = await execFileAsync(
      "git",
      ["diff", "--cached", "--name-only"],
      { cwd: repositoryRoot },
    );
    assert.equal(staged.stdout, "");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("accepted task commits include only task hunks and preserve unrelated work", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "council-commit-"));
  const repositoryRoot = path.join(temporary, "repository");
  const worktreeRoot = path.join(temporary, "worktrees");
  await mkdir(repositoryRoot);
  await execFileAsync("git", ["init", "-q"], { cwd: repositoryRoot });
  await execFileAsync("git", ["config", "user.name", "Council test"], {
    cwd: repositoryRoot,
  });
  await execFileAsync("git", ["config", "user.email", "test@council.local"], {
    cwd: repositoryRoot,
  });
  await writeFile(path.join(repositoryRoot, "README.md"), "# Before\n", "utf8");
  await writeFile(path.join(repositoryRoot, "notes.txt"), "original\n", "utf8");
  await execFileAsync("git", ["add", "README.md", "notes.txt"], {
    cwd: repositoryRoot,
  });
  await execFileAsync("git", ["commit", "-q", "-m", "initial"], {
    cwd: repositoryRoot,
  });

  try {
    const repository = await inspectRepository(repositoryRoot);
    const job = createTaskJob(
      repository,
      "Update the README heading",
      manualTaskDecision("codex_only"),
    );
    await executeTaskJob(job, {
      worktreeRoot,
      codexRunner: async (cwd) => {
        await writeFile(path.join(cwd, "README.md"), "# After\n", "utf8");
        return { text: "Changed README.md", durationMs: 1 };
      },
    });
    await acceptTaskJob(job);

    await writeFile(path.join(repositoryRoot, "notes.txt"), "user work\n", "utf8");
    await execFileAsync("git", ["add", "notes.txt"], { cwd: repositoryRoot });
    await assert.rejects(
      createTaskCommit(job, "Council: update README"),
      /will not mix.*staged work/i,
    );
    const stagedBefore = await execFileAsync(
      "git",
      ["diff", "--cached", "--name-only"],
      { cwd: repositoryRoot },
    );
    assert.equal(stagedBefore.stdout.trim(), "notes.txt");

    await execFileAsync("git", ["reset", "-q", "HEAD", "--", "notes.txt"], {
      cwd: repositoryRoot,
    });
    await createTaskCommit(job, "Council: update README");
    const committed = await execFileAsync(
      "git",
      ["show", "--pretty=format:", "--name-only", "HEAD"],
      { cwd: repositoryRoot },
    );
    assert.equal(committed.stdout.trim(), "README.md");
    assert.equal(
      await readFile(path.join(repositoryRoot, "notes.txt"), "utf8"),
      "user work\n",
    );
    const status = await execFileAsync("git", ["status", "--short"], {
      cwd: repositoryRoot,
    });
    assert.match(status.stdout, / M notes\.txt/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("accepting a stale parallel patch preserves the repository and records a conflict", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "council-conflict-"));
  const repositoryRoot = path.join(temporary, "repository");
  const worktreeRoot = path.join(temporary, "worktrees");
  await mkdir(repositoryRoot);
  await execFileAsync("git", ["init", "-q"], { cwd: repositoryRoot });
  await writeFile(path.join(repositoryRoot, "README.md"), "# Before\n", "utf8");
  await execFileAsync("git", ["add", "README.md"], { cwd: repositoryRoot });
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=Council test",
      "-c",
      "user.email=test@council.local",
      "commit",
      "-q",
      "-m",
      "initial",
    ],
    { cwd: repositoryRoot },
  );

  try {
    const repository = await inspectRepository(repositoryRoot);
    const olderTask = createTaskJob(
      repository,
      "Use the older heading",
      manualTaskDecision("codex_only"),
    );
    const newerTask = createTaskJob(
      repository,
      "Use the newer heading",
      manualTaskDecision("codex_only"),
    );
    await executeTaskJob(olderTask, {
      worktreeRoot,
      codexRunner: async (cwd) => {
        await writeFile(path.join(cwd, "README.md"), "# Older\n", "utf8");
        return { text: "Older patch", durationMs: 1 };
      },
    });
    await executeTaskJob(newerTask, {
      worktreeRoot,
      codexRunner: async (cwd) => {
        await writeFile(path.join(cwd, "README.md"), "# Newer\n", "utf8");
        return { text: "Newer patch", durationMs: 1 };
      },
    });

    await acceptTaskJob(newerTask);
    await acceptTaskJob(olderTask);

    assert.equal(olderTask.status, "conflict");
    assert.equal(olderTask.stage, "conflict");
    assert.equal(olderTask.failedStage, "accept");
    assert.deepEqual(olderTask.conflict.files, ["README.md"]);
    assert.match(olderTask.error, /No files were changed/);
    assert.equal(
      await readFile(path.join(repositoryRoot, "README.md"), "utf8"),
      "# Newer\n",
    );
    const staleWorkspace = olderTask.workspace.path;
    await deleteTaskJob(olderTask);
    await assert.rejects(
      readFile(path.join(staleWorkspace, "README.md"), "utf8"),
      /ENOENT/,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("a failed activity can retry from its durable task stage", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "council-retry-"));
  const repositoryRoot = path.join(temporary, "repository");
  const worktreeRoot = path.join(temporary, "worktrees");
  await mkdir(repositoryRoot);
  await execFileAsync("git", ["init", "-q"], { cwd: repositoryRoot });
  await writeFile(path.join(repositoryRoot, "README.md"), "# Before\n");
  await execFileAsync("git", ["add", "README.md"], { cwd: repositoryRoot });
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=Council test",
      "-c",
      "user.email=test@council.local",
      "commit",
      "-q",
      "-m",
      "initial",
    ],
    { cwd: repositoryRoot },
  );

  let calls = 0;
  const runner = async (cwd) => {
    calls += 1;
    if (calls === 1) throw new Error("temporary agent failure");
    await writeFile(path.join(cwd, "README.md"), "# Retried\n");
    return { text: "Retry succeeded", durationMs: 1 };
  };

  try {
    const repository = await inspectRepository(repositoryRoot);
    const job = createTaskJob(
      repository,
      "Update the README after a temporary failure",
      manualTaskDecision("codex_only"),
    );
    await executeTaskJob(job, { worktreeRoot, codexRunner: runner });
    assert.equal(job.status, "failed");
    assert.equal(job.failedStage, "execute");

    await retryTaskJob(job, "execute", {
      worktreeRoot,
      codexRunner: runner,
    });
    assert.equal(job.attempt, 2);
    assert.equal(job.status, "awaiting_review");
    assert.deepEqual(job.review.files, ["README.md"]);
    assert.equal(calls, 2);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("Claude-only execution writes in an isolated worktree", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "council-claude-task-"));
  const repositoryRoot = path.join(temporary, "repository");
  const worktreeRoot = path.join(temporary, "worktrees");
  await mkdir(repositoryRoot);
  await execFileAsync("git", ["init", "-q"], { cwd: repositoryRoot });
  await writeFile(path.join(repositoryRoot, "README.md"), "# Before\n");
  await execFileAsync("git", ["add", "README.md"], { cwd: repositoryRoot });
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=Council test",
      "-c",
      "user.email=test@council.local",
      "commit",
      "-q",
      "-m",
      "initial",
    ],
    { cwd: repositoryRoot },
  );

  try {
    const repository = await inspectRepository(repositoryRoot);
    const job = createTaskJob(
      repository,
      "Update the README with Claude",
      manualTaskDecision("claude_only"),
    );
    let sandboxMode = "";
    await executeTaskJob(job, {
      worktreeRoot,
      claudeRunner: async (cwd, prompt, sandbox) => {
        sandboxMode = sandbox;
        assert.match(prompt, /Update the README with Claude/);
        await writeFile(path.join(cwd, "README.md"), "# Claude\n");
        return { text: "Changed README.md", durationMs: 1 };
      },
    });

    assert.equal(sandboxMode, "workspace-write");
    assert.equal(job.status, "awaiting_review");
    assert.deepEqual(job.review.files, ["README.md"]);
    assert.equal(await readFile(path.join(repositoryRoot, "README.md"), "utf8"), "# Before\n");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("human change requests revise the same isolated patch before acceptance", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "council-revise-"));
  const repositoryRoot = path.join(temporary, "repository");
  const worktreeRoot = path.join(temporary, "worktrees");
  await mkdir(repositoryRoot);
  await execFileAsync("git", ["init", "-q"], { cwd: repositoryRoot });
  await writeFile(path.join(repositoryRoot, "README.md"), "# Before\n", "utf8");
  await execFileAsync("git", ["add", "README.md"], { cwd: repositoryRoot });
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=Council test",
      "-c",
      "user.email=test@council.local",
      "commit",
      "-q",
      "-m",
      "initial",
    ],
    { cwd: repositoryRoot },
  );

  try {
    const repository = await inspectRepository(repositoryRoot);
    const job = createTaskJob(
      repository,
      "Improve the README heading",
      manualTaskDecision("codex_only"),
    );
    await executeTaskJob(job, {
      worktreeRoot,
      codexRunner: async (cwd) => {
        await writeFile(path.join(cwd, "README.md"), "# First pass\n", "utf8");
        return { text: "First pass", durationMs: 1 };
      },
    });

    const workspacePath = job.workspace.path;
    await reviseTaskJob(job, "Use the heading Final instead.", {
      codexRunner: async (cwd, prompt) => {
        assert.equal(cwd, workspacePath);
        assert.match(prompt, /Use the heading Final instead/);
        await writeFile(path.join(cwd, "README.md"), "# Final\n", "utf8");
        return { text: "Applied review feedback", durationMs: 1 };
      },
    });

    assert.equal(job.status, "awaiting_review");
    assert.equal(job.reviewIteration, 2);
    assert.equal(job.reviewHistory.length, 1);
    assert.equal(
      await readFile(path.join(repositoryRoot, "README.md"), "utf8"),
      "# Before\n",
    );

    await acceptTaskJob(job);
    assert.equal(
      await readFile(path.join(repositoryRoot, "README.md"), "utf8"),
      "# Final\n",
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("council receives one bounded capsule and reuses durable artifacts", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "council-pack-"));
  const repositoryRoot = path.join(temporary, "repository");
  const worktreeRoot = path.join(temporary, "worktrees");
  await mkdir(path.join(repositoryRoot, "agent_context"), { recursive: true });
  await execFileAsync("git", ["init", "-q"], { cwd: repositoryRoot });
  await writeFile(
    path.join(repositoryRoot, "app.js"),
    "export const value = 1;\n",
    "utf8",
  );
  await execFileAsync("git", ["add", "app.js"], { cwd: repositoryRoot });
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=Council test",
      "-c",
      "user.email=test@council.local",
      "commit",
      "-q",
      "-m",
      "initial",
    ],
    { cwd: repositoryRoot },
  );
  const sha = (
    await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot })
  ).stdout.trim();
  await writeFile(
    path.join(repositoryRoot, "agent_context", "repository.md"),
    "# Repository\n\nThe exported value lives in `app.js`.\n",
    "utf8",
  );
  await writeFile(
    path.join(repositoryRoot, "agent_context", "manifest.json"),
    JSON.stringify({
      schemaVersion: 2,
      sourceSha: sha,
      documents: ["agent_context/repository.md"],
    }),
    "utf8",
  );

  const prompts = [];
  const fakeRunner = async (cwd, prompt, sandbox) => {
    prompts.push(prompt);
    if (sandbox === "workspace-write") {
      await writeFile(path.join(cwd, "result.txt"), "done\n", "utf8");
    }
    return { text: "Evidence-backed response", durationMs: 1 };
  };

  try {
    const repository = await inspectRepository(repositoryRoot);
    const job = createTaskJob(
      repository,
      "Update the exported value",
      manualTaskDecision("council_plan_codex_execute"),
    );
    await executeTaskJob(job, {
      worktreeRoot,
      codexRunner: fakeRunner,
      claudeRunner: fakeRunner,
    });

    assert.equal(job.status, "awaiting_review");
    assert.equal(prompts.length, 4);
    assert.match(prompts[0], /TASK CONTEXT CAPSULE/);
    assert.match(prompts[0], /agent_context\/repository\.md/);
    assert.ok(
      prompts.slice(1).every((prompt) => !prompt.includes("TASK CONTEXT CAPSULE")),
    );
    assert.deepEqual(job.contextPack.selectedPaths, [
      "agent_context/repository.md",
    ]);
    assert.equal(job.result.proposal, "Evidence-backed response");
    assert.equal(job.result.critique, "Evidence-backed response");
    assert.equal(job.result.plan, "Evidence-backed response");
    assert.equal(job.result.execution, "Evidence-backed response");
    assert.equal(job.usage.totals.calls, 4);
    assert.equal(job.usage.totals.contextTokens, job.contextPack.estimatedTokens);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("canceling a running task stops before review and cleans its worktree", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "council-cancel-"));
  const repositoryRoot = path.join(temporary, "repository");
  const worktreeRoot = path.join(temporary, "worktrees");
  await mkdir(repositoryRoot);
  await execFileAsync("git", ["init", "-q"], { cwd: repositoryRoot });
  await writeFile(path.join(repositoryRoot, "app.js"), "export const value = 1;\n");
  await execFileAsync("git", ["add", "app.js"], { cwd: repositoryRoot });
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=Council test",
      "-c",
      "user.email=test@council.local",
      "commit",
      "-q",
      "-m",
      "initial",
    ],
    { cwd: repositoryRoot },
  );

  let releaseRunner;
  let runnerStarted;
  const started = new Promise((resolve) => {
    runnerStarted = resolve;
  });
  const blockedRunner = async () => {
    runnerStarted();
    await new Promise((resolve) => {
      releaseRunner = resolve;
    });
    return { text: "Stopped", durationMs: 1 };
  };

  try {
    const repository = await inspectRepository(repositoryRoot);
    const job = createTaskJob(
      repository,
      "Inspect the module",
      manualTaskDecision("codex_only"),
    );
    const execution = executeTaskJob(job, {
      worktreeRoot,
      codexRunner: blockedRunner,
    });
    await started;
    await cancelTaskJob(job);
    releaseRunner();
    await execution;
    assert.equal(job.status, "canceled");
    assert.ok(job.workspace.cleanedAt);
    assert.equal(job.review, null);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
