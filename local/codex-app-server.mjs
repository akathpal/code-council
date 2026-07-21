import { spawn } from "node:child_process";
import readline from "node:readline";

function sandboxPolicy(mode, cwd) {
  if (mode === "workspace-write") {
    return {
      type: "workspaceWrite",
      writableRoots: [cwd],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    };
  }
  if (mode === "danger-full-access") return { type: "dangerFullAccess" };
  return { type: "readOnly", networkAccess: false };
}

function approvalKind(method) {
  if (method === "item/commandExecution/requestApproval") return "command";
  if (method === "item/fileChange/requestApproval") return "file_change";
  if (method === "item/permissions/requestApproval") return "permissions";
  return "unknown";
}

export async function runCodexAppServer(options) {
  const startedAt = Date.now();
  const child = spawn("codex", ["app-server", "--listen", "stdio://"], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  options.onSpawn?.({
    child,
    pid: child.pid,
    executable: "codex",
    args: ["app-server", "--listen", "stdio://"],
  });

  let requestId = 100;
  let settled = false;
  let stderr = "";
  let outputBytes = 0;
  const maxBuffer = options.maxBuffer ?? 50 * 1024 * 1024;
  const pending = new Map();
  const agentMessages = [];
  let tokenUsage = null;
  let completedTurn = null;
  let completeTurn;
  let failTurn;
  const turnCompletion = new Promise((resolve, reject) => {
    completeTurn = resolve;
    failTurn = reject;
  });

  function send(message) {
    if (!child.stdin.destroyed) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }
  }

  function request(method, params) {
    const id = requestId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      send({ method, id, params });
    });
  }

  async function answerApproval(message) {
    const kind = approvalKind(message.method);
    const approval = {
      id: String(message.id),
      kind,
      method: message.method,
      command: message.params?.command ?? null,
      reason: message.params?.reason ?? null,
      cwd: message.params?.cwd ?? options.cwd,
      itemId: message.params?.itemId ?? null,
      availableDecisions: message.params?.availableDecisions ?? null,
      requestedAt: new Date().toISOString(),
    };
    try {
      const decision = await options.onApproval?.(approval);
      if (kind === "permissions") {
        send({
          id: message.id,
          error: {
            code: -32000,
            message:
              "code-council does not grant expanded permission profiles. Denied by user policy.",
          },
        });
        return;
      }
      send({
        id: message.id,
        result: { decision: decision ?? "decline" },
      });
    } catch {
      send({ id: message.id, result: { decision: "cancel" } });
    }
  }

  const stdoutLines = readline.createInterface({ input: child.stdout });
  stdoutLines.on("line", (line) => {
    outputBytes += Buffer.byteLength(line) + 1;
    options.onOutput?.({ stream: "stdout", text: `${line}\n` });
    if (outputBytes > maxBuffer) {
      failTurn(new Error(`Codex output exceeded ${maxBuffer} bytes.`));
      child.kill("SIGTERM");
      return;
    }
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (message.method && message.id != null) {
      void answerApproval(message);
      return;
    }
    if (message.id != null) {
      const waiting = pending.get(message.id);
      if (!waiting) return;
      pending.delete(message.id);
      if (message.error) {
        waiting.reject(
          new Error(message.error.message ?? "Codex app-server request failed."),
        );
      } else {
        waiting.resolve(message.result);
      }
      return;
    }
    if (message.method === "item/completed") {
      const item = message.params?.item;
      if (item?.type === "agentMessage" && item.text) {
        agentMessages.push(item.text);
      }
    }
    if (message.method === "thread/tokenUsage/updated") {
      tokenUsage =
        message.params?.tokenUsage?.total ??
        message.params?.tokenUsage?.last ??
        tokenUsage;
    }
    if (message.method === "turn/completed") {
      completedTurn = message.params?.turn ?? null;
      completeTurn(completedTurn);
    }
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderr += text;
    outputBytes += chunk.length;
    options.onOutput?.({ stream: "stderr", text });
    if (outputBytes > maxBuffer) {
      failTurn(new Error(`Codex output exceeded ${maxBuffer} bytes.`));
      child.kill("SIGTERM");
    }
  });

  const closed = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => {
      options.onExit?.({ code, signal });
      if (!settled && !completedTurn) {
        reject(
          new Error(
            stderr ||
              `Codex app-server exited with ${code ?? signal ?? "unknown status"}.`,
          ),
        );
      } else {
        resolve();
      }
    });
  });

  const timer = setTimeout(() => {
    failTurn(
      new Error(
        `Codex app-server timed out after ${options.timeout ?? 45 * 60_000}ms.`,
      ),
    );
    child.kill("SIGTERM");
  }, options.timeout ?? 45 * 60_000);

  try {
    await request("initialize", {
      clientInfo: {
        name: "council",
        title: "code-council",
        version: "0.1.0",
      },
      capabilities: { experimentalApi: true },
    });
    send({ method: "initialized", params: {} });
    const thread = await request("thread/start", {
      model: options.model,
      cwd: options.cwd,
      sandbox: options.sandbox ?? "read-only",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      ephemeral: true,
    });
    const turnParams = {
      threadId: thread.thread.id,
      input: [{ type: "text", text: options.prompt }],
      cwd: options.cwd,
      model: options.model,
      effort: options.effort,
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandboxPolicy: sandboxPolicy(options.sandbox, options.cwd),
    };
    if (options.outputSchema) turnParams.outputSchema = options.outputSchema;
    await request("turn/start", turnParams);
    const turn = await Promise.race([turnCompletion, closed]);
    if (!turn || turn.status !== "completed") {
      const detail =
        turn?.error?.message ??
        turn?.error?.additionalDetails ??
        `Codex turn ${turn?.status ?? "stopped"}.`;
      throw new Error(detail);
    }
    const finalMessage =
      [...(turn.items ?? [])]
        .reverse()
        .find((item) => item.type === "agentMessage" && item.text)?.text ??
      agentMessages.at(-1) ??
      "";
    settled = true;
    child.kill("SIGTERM");
    return {
      text: finalMessage,
      durationMs: Date.now() - startedAt,
      turnId: turn.id,
      usage: tokenUsage
        ? {
            inputTokens: Number(tokenUsage.inputTokens ?? 0),
            cachedInputTokens: Number(tokenUsage.cachedInputTokens ?? 0),
            outputTokens: Number(tokenUsage.outputTokens ?? 0),
            reasoningTokens: Number(tokenUsage.reasoningOutputTokens ?? 0),
            totalTokens: Number(
              tokenUsage.totalTokens ??
                Number(tokenUsage.inputTokens ?? 0) +
                  Number(tokenUsage.outputTokens ?? 0),
            ),
            costUsd: null,
          }
        : null,
    };
  } finally {
    settled = true;
    clearTimeout(timer);
    for (const waiting of pending.values()) {
      waiting.reject(new Error("Codex app-server stopped."));
    }
    pending.clear();
    if (!child.killed) child.kill("SIGTERM");
  }
}

async function readCodexAppServer(method, params, options = {}) {
  const child = spawn("codex", ["app-server", "--listen", "stdio://"], {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  const stdoutLines = readline.createInterface({ input: child.stdout });
  const timeoutMs = options.timeout ?? 12_000;
  let requestId = 1;
  let stderr = "";
  let stopping = false;

  function send(message) {
    if (!child.stdin.destroyed) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }
  }

  function request(method, params) {
    const id = requestId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      send({ method, id, params });
    });
  }

  stdoutLines.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id == null || message.method) return;
    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    if (message.error) {
      waiting.reject(
        new Error(message.error.message ?? "Codex usage request failed."),
      );
    } else {
      waiting.resolve(message.result);
    }
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const exited = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (stopping) {
        resolve();
        return;
      }
      reject(
        new Error(
          stderr ||
            `Codex app-server exited with ${code ?? signal ?? "unknown status"}.`,
        ),
      );
    });
  });
  let rejectTimeout;
  const timedOut = new Promise((_, reject) => {
    rejectTimeout = setTimeout(
      () => reject(new Error(`Codex usage request timed out after ${timeoutMs}ms.`)),
      timeoutMs,
    );
  });
  const waitFor = (promise) => Promise.race([promise, exited, timedOut]);

  try {
    await waitFor(
      request("initialize", {
        clientInfo: {
          name: "council",
          title: "code-council",
          version: "0.1.0",
        },
        capabilities: { experimentalApi: true },
      }),
    );
    send({ method: "initialized", params: {} });
    return await waitFor(request(method, params));
  } finally {
    stopping = true;
    clearTimeout(rejectTimeout);
    for (const waiting of pending.values()) {
      waiting.reject(new Error("Codex usage request stopped."));
    }
    pending.clear();
    stdoutLines.close();
    if (!child.killed) child.kill("SIGTERM");
  }
}

export function readCodexRateLimits(options = {}) {
  return readCodexAppServer("account/rateLimits/read", {}, options);
}

export function readCodexModels(options = {}) {
  return readCodexAppServer(
    "model/list",
    {
      includeHidden: Boolean(options.includeHidden),
      limit: options.limit ?? 100,
    },
    options,
  );
}
