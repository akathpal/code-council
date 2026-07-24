import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import * as vscode from "vscode";

type ToolState = {
  available?: boolean;
  authenticated?: boolean;
  version?: string;
};

type CouncilStatus = {
  ready: boolean;
  tools: {
    codex?: ToolState;
    claude?: ToolState;
    gh?: ToolState;
  };
};

type RepositoryRecord = {
  id: string;
  name: string;
  path: string;
  branch?: string;
  dirty?: boolean;
};

type TaskRecord = {
  id: string;
  prompt: string;
  repository: string;
  status: string;
  updatedAt: string;
  cancelRequested?: boolean;
};

type CouncilSnapshot = {
  online: boolean;
  status: CouncilStatus | null;
  repositories: RepositoryRecord[];
  tasks: TaskRecord[];
  error?: string;
};

type ManagerHandoff = {
  prompt?: string;
  repository?: string;
  view?: string;
};

const ATTENTION_STATES = new Set([
  "awaiting_input",
  "awaiting_approval",
  "awaiting_review",
  "paused",
  "failed",
  "conflict",
]);
const ACTIVE_STATES = new Set(["queued", "running", "awaiting_approval"]);

function configuration() {
  return vscode.workspace.getConfiguration("council");
}

function configuredApiUrl() {
  return configuration()
    .get<string>("localApiUrl", "http://127.0.0.1:4781")
    .replace(/\/+$/, "");
}

function configuredUiUrl() {
  return configuration()
    .get<string>("uiUrl", "http://127.0.0.1:3000")
    .replace(/\/+$/, "");
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function nonce() {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < 32; index += 1) {
    value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return value;
}

function displayStatus(status: string) {
  return status
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function truncate(value: string, length = 100) {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > length
    ? `${normalized.slice(0, length - 1)}…`
    : normalized;
}

function extensionById(id: string) {
  const normalized = id.toLowerCase();
  return vscode.extensions.all.find(
    (extension) => extension.id.toLowerCase() === normalized,
  );
}

class CouncilService implements vscode.Disposable {
  readonly output = vscode.window.createOutputChannel("Council");
  private readonly changed = new vscode.EventEmitter<CouncilSnapshot>();
  readonly onDidChange = this.changed.event;
  private runtimeProcess: ChildProcessWithoutNullStreams | null = null;
  private snapshotValue: CouncilSnapshot = {
    online: false,
    status: null,
    repositories: [],
    tasks: [],
  };
  private snapshotSignature = "";

  constructor(private readonly context: vscode.ExtensionContext) {}

  currentSnapshot() {
    return this.snapshotValue;
  }

  async request<T>(requestPath: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${configuredApiUrl()}${requestPath}`, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...options.headers,
      },
      signal: options.signal ?? AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    if (!text.trim()) {
      throw new Error(
        response.ok
          ? "Council returned an empty response."
          : `Council is unavailable (HTTP ${response.status}).`,
      );
    }
    let payload: T & { error?: string };
    try {
      payload = JSON.parse(text) as T & { error?: string };
    } catch {
      throw new Error(
        `Council returned invalid JSON (HTTP ${response.status}).`,
      );
    }
    if (!response.ok) {
      throw new Error(payload.error ?? `Council request failed (${response.status}).`);
    }
    return payload;
  }

  async refreshSnapshot(force = false): Promise<CouncilSnapshot> {
    let next: CouncilSnapshot;
    try {
      const status = await this.request<CouncilStatus>("/v1/status", {
        signal: AbortSignal.timeout(4_000),
      });
      const [repositoryResult, taskResult] = await Promise.all([
        this.request<{ repositories: RepositoryRecord[] }>("/v1/repositories"),
        this.request<{ jobs: TaskRecord[] }>("/v1/tasks"),
      ]);
      next = {
        online: true,
        status,
        repositories: repositoryResult.repositories,
        tasks: taskResult.jobs,
      };
    } catch (reason) {
      next = {
        online: false,
        status: null,
        repositories: [],
        tasks: [],
        error: String((reason as Error).message ?? reason),
      };
    }

    const signature = JSON.stringify({
      online: next.online,
      tools: next.status?.tools,
      repositories: next.repositories.map((repository) => [
        repository.id,
        repository.branch,
        repository.dirty,
      ]),
      tasks: next.tasks.map((task) => [
        task.id,
        task.status,
        task.updatedAt,
        task.cancelRequested,
      ]),
    });
    this.snapshotValue = next;
    if (force || signature !== this.snapshotSignature) {
      this.snapshotSignature = signature;
      this.changed.fire(next);
    }
    return next;
  }

  private runtimeRoot() {
    const configured = configuration().get<string>("runtimePath", "").trim();
    const workspaceCandidates =
      vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];
    const candidates = [
      configured,
      process.env.COUNCIL_HOME ?? "",
      path.join(this.context.extensionPath, "runtime"),
      path.resolve(this.context.extensionPath, "..", ".."),
      ...workspaceCandidates,
    ];
    return (
      candidates
        .filter(Boolean)
        .map((candidate) => path.resolve(candidate))
        .find((candidate) =>
          existsSync(path.join(candidate, "bin", "council.mjs")),
        ) ?? null
    );
  }

  private async requireRuntimeRoot() {
    const discovered = this.runtimeRoot();
    if (discovered) return discovered;
    const choice = await vscode.window.showErrorMessage(
      "Council could not find its local runtime. Configure the code-council checkout path.",
      "Configure runtime path",
    );
    if (choice === "Configure runtime path") {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "council.runtimePath",
      );
    }
    throw new Error("Council runtime path is not configured.");
  }

  async startRuntime(restart = false) {
    const online = await this.refreshSnapshot();
    if (online.online && !restart) return online;

    const root = await this.requireRuntimeRoot();
    const executable = configuration().get<string>("nodeExecutable", "node");
    const args = [
      path.join(root, "bin", "council.mjs"),
      ...(restart ? ["--restart"] : []),
    ];
    this.output.show(true);
    this.output.appendLine(
      `${restart ? "Restarting" : "Starting"} Council from ${root}`,
    );
    const child = spawn(executable, args, {
      cwd: root,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.runtimeProcess = child;
    child.stdout.on("data", (chunk) => this.output.append(chunk.toString()));
    child.stderr.on("data", (chunk) => this.output.append(chunk.toString()));
    child.on("error", (error) => {
      this.output.appendLine(`Council failed to start: ${error.message}`);
    });
    child.on("exit", (code, signal) => {
      if (this.runtimeProcess === child) this.runtimeProcess = null;
      this.output.appendLine(
        `Council launcher exited (${signal ?? `code ${code ?? "unknown"}`}).`,
      );
      void this.refreshSnapshot(true);
    });

    for (let attempt = 0; attempt < 50; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const current = await this.refreshSnapshot();
      if (current.online) return current;
      if (child.exitCode !== null && attempt > 3) break;
    }
    throw new Error(
      "Council did not become ready. Open the Council output for startup logs.",
    );
  }

  async stopRuntime() {
    const root = await this.requireRuntimeRoot();
    const executable = configuration().get<string>("nodeExecutable", "node");
    const child = spawn(
      executable,
      [path.join(root, "bin", "council.mjs"), "stop"],
      {
        cwd: root,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout.on("data", (chunk) => this.output.append(chunk.toString()));
    child.stderr.on("data", (chunk) => this.output.append(chunk.toString()));
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Council stop command exited with code ${code}.`));
      });
    });
    this.runtimeProcess = null;
    await this.refreshSnapshot(true);
  }

  async connectWorkspace() {
    const folder =
      vscode.workspace.workspaceFolders?.[
        vscode.window.activeTextEditor
          ? vscode.workspace.getWorkspaceFolder(
              vscode.window.activeTextEditor.document.uri,
            )?.index ?? 0
          : 0
      ];
    if (!folder) {
      throw new Error("Open a Git repository before connecting it to Council.");
    }
    await this.startRuntime();
    const result = await this.request<{ repository: RepositoryRecord }>(
      "/v1/repositories/connect",
      {
        method: "POST",
        body: JSON.stringify({ path: folder.uri.fsPath }),
      },
    );
    await this.refreshSnapshot(true);
    return result.repository;
  }

  dispose() {
    this.changed.dispose();
    this.output.dispose();
  }
}

class CouncilAgentManagerProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | null = null;
  private readonly changeSubscription: vscode.Disposable;

  constructor(
    private readonly service: CouncilService,
    private readonly dispatch: (command: string) => Promise<void>,
  ) {
    this.changeSubscription = service.onDidChange(() => {
      this.render();
    });
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage((message: { command?: unknown }) => {
      if (typeof message.command === "string") {
        void this.dispatch(message.command);
      }
    });
    this.render();
    void this.service.refreshSnapshot(true);
  }

  private providerCard(
    id: "codex" | "claude",
    title: string,
    description: string,
    tool: ToolState | undefined,
  ) {
    const extensionId =
      id === "codex" ? "openai.chatgpt" : "Anthropic.claude-code";
    const installed = Boolean(extensionById(extensionId));
    const ready = Boolean(tool?.available && tool.authenticated !== false);
    const state = installed
      ? ready
        ? "Ready"
        : "Extension installed"
      : "Install extension";
    return `
      <article class="provider ${id}">
        <div class="provider-mark">${id === "codex" ? "C" : "A"}</div>
        <div class="provider-copy">
          <strong>${title}</strong>
          <small>${escapeHtml(description)}</small>
        </div>
        <button data-command="${id}">${escapeHtml(state)}</button>
      </article>`;
  }

  private taskRows(snapshot: CouncilSnapshot) {
    const tasks = [...snapshot.tasks]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 8);
    if (!tasks.length) {
      return `<p class="empty">No Council tasks yet. Start one from the editor or Agent Manager.</p>`;
    }
    return tasks
      .map(
        (task) => `
          <button class="task" data-command="manager">
            <span class="task-state ${escapeHtml(task.status)}"></span>
            <span>
              <strong>${escapeHtml(truncate(task.prompt, 72))}</strong>
              <small>${escapeHtml(displayStatus(task.status))}</small>
            </span>
          </button>`,
      )
      .join("");
  }

  private render() {
    if (!this.view) return;
    const snapshot = this.service.currentSnapshot();
    const scriptNonce = nonce();
    const active = snapshot.tasks.filter((task) =>
      ACTIVE_STATES.has(task.status),
    ).length;
    const attention = snapshot.tasks.filter((task) =>
      ATTENTION_STATES.has(task.status),
    ).length;
    const runtimeLabel = snapshot.online
      ? active
        ? `${active} running`
        : attention
          ? `${attention} need attention`
          : "Ready"
      : "Offline";
    const runtimeAction = snapshot.online ? "stop" : "start";
    const workspaceOpen = Boolean(vscode.workspace.workspaceFolders?.length);

    this.view.webview.html = `<!doctype html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta
          http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src ${this.view.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${scriptNonce}';"
        >
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          * { box-sizing: border-box; }
          body {
            color: var(--vscode-foreground);
            background: var(--vscode-sideBar-background);
            font-family: var(--vscode-font-family);
            margin: 0;
            padding: 12px;
          }
          button {
            color: inherit;
            font: inherit;
          }
          .hero {
            border: 1px solid var(--vscode-widget-border);
            border-radius: 10px;
            background: color-mix(in srgb, var(--vscode-editor-background) 88%, transparent);
            padding: 14px;
          }
          .hero header, .section-title, .runtime {
            align-items: center;
            display: flex;
            justify-content: space-between;
            gap: 8px;
          }
          .brand {
            align-items: center;
            display: flex;
            gap: 9px;
          }
          .brand-mark {
            align-items: center;
            background: var(--vscode-button-background);
            border-radius: 7px;
            color: var(--vscode-button-foreground);
            display: flex;
            font-weight: 800;
            height: 30px;
            justify-content: center;
            width: 30px;
          }
          h1 { font-size: 14px; margin: 0; }
          p { color: var(--vscode-descriptionForeground); line-height: 1.45; }
          .hero > button, .primary {
            background: var(--vscode-button-background);
            border: 0;
            border-radius: 5px;
            color: var(--vscode-button-foreground);
            cursor: pointer;
            margin-top: 8px;
            padding: 8px 10px;
            width: 100%;
          }
          .hero > button:hover, .primary:hover {
            background: var(--vscode-button-hoverBackground);
          }
          .runtime {
            border-top: 1px solid var(--vscode-widget-border);
            margin-top: 12px;
            padding-top: 10px;
          }
          .runtime small, article small, .task small {
            color: var(--vscode-descriptionForeground);
            display: block;
            margin-top: 2px;
          }
          .runtime button, article button, .secondary {
            background: transparent;
            border: 1px solid var(--vscode-button-border, var(--vscode-widget-border));
            border-radius: 5px;
            cursor: pointer;
            padding: 5px 8px;
          }
          section { margin-top: 18px; }
          .section-title strong { font-size: 11px; text-transform: uppercase; }
          .section-title small { color: var(--vscode-descriptionForeground); }
          .provider {
            align-items: center;
            border: 1px solid var(--vscode-widget-border);
            border-radius: 8px;
            display: grid;
            gap: 9px;
            grid-template-columns: 30px 1fr auto;
            margin-top: 7px;
            padding: 9px;
          }
          .provider-mark {
            align-items: center;
            border-radius: 7px;
            display: flex;
            font-weight: 800;
            height: 30px;
            justify-content: center;
          }
          .codex .provider-mark { background: #1c7658; color: white; }
          .claude .provider-mark { background: #b96542; color: white; }
          .provider-copy { min-width: 0; }
          .task {
            align-items: start;
            background: transparent;
            border: 0;
            border-radius: 6px;
            cursor: pointer;
            display: grid;
            gap: 8px;
            grid-template-columns: 8px 1fr;
            padding: 7px 5px;
            text-align: left;
            width: 100%;
          }
          .task:hover { background: var(--vscode-list-hoverBackground); }
          .task-state {
            background: var(--vscode-descriptionForeground);
            border-radius: 999px;
            height: 7px;
            margin-top: 5px;
            width: 7px;
          }
          .task-state.running, .task-state.queued { background: #4a9eff; }
          .task-state.awaiting_review { background: #4dbb75; }
          .task-state.awaiting_input, .task-state.awaiting_approval, .task-state.paused { background: #e9a23b; }
          .task-state.failed, .task-state.conflict { background: #e05252; }
          .empty { font-size: 12px; }
          .actions { display: grid; gap: 6px; grid-template-columns: 1fr 1fr; margin-top: 8px; }
          .actions button { margin: 0; width: 100%; }
        </style>
      </head>
      <body>
        <div class="hero">
          <header>
            <div class="brand">
              <span class="brand-mark">CC</span>
              <div>
                <h1>Council Agent Manager</h1>
                <small>Review-gated multi-agent work</small>
              </div>
            </div>
          </header>
          <p>Run Codex, Claude, or a structured council against the repository open in this editor.</p>
          <button data-command="manager">Open full Agent Manager</button>
          <div class="actions">
            <button class="secondary" data-command="new-task">New task</button>
            <button class="secondary" data-command="connect" ${workspaceOpen ? "" : "disabled"}>Connect workspace</button>
            <button class="secondary" data-command="github" ${workspaceOpen ? "" : "disabled"}>GitHub work</button>
            <button class="secondary" data-command="refresh">Refresh state</button>
          </div>
          <div class="runtime">
            <span>
              <strong>Local runtime</strong>
              <small>${escapeHtml(runtimeLabel)}</small>
            </span>
            <button data-command="${runtimeAction}">${snapshot.online ? "Stop" : "Start"}</button>
          </div>
        </div>

        <section>
          <div class="section-title">
            <strong>Individual modes</strong>
            <small>Separate sessions</small>
          </div>
          ${this.providerCard(
            "codex",
            "Codex",
            "OpenAI's native interactive extension",
            snapshot.status?.tools.codex,
          )}
          ${this.providerCard(
            "claude",
            "Claude Code",
            "Anthropic's native interactive extension",
            snapshot.status?.tools.claude,
          )}
        </section>

        <section>
          <div class="section-title">
            <strong>Recent Council tasks</strong>
            <small>${snapshot.repositories.length} repos</small>
          </div>
          ${this.taskRows(snapshot)}
        </section>

        <script nonce="${scriptNonce}">
          const vscode = acquireVsCodeApi();
          document.addEventListener("click", (event) => {
            const target = event.target.closest("[data-command]");
            if (target && !target.disabled) {
              vscode.postMessage({ command: target.dataset.command });
            }
          });
        </script>
      </body>
      </html>`;
  }

  dispose() {
    this.changeSubscription.dispose();
  }
}

class CouncilTaskMonitor implements vscode.Disposable {
  private timer: ReturnType<typeof setInterval> | null = null;
  private previous = new Map<string, string>();
  private initialized = false;
  private readonly statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    35,
  );

  constructor(private readonly service: CouncilService) {
    this.statusBar.command = "council.openAgentManager";
    this.statusBar.name = "Council";
    this.statusBar.show();
  }

  start() {
    void this.tick();
    const interval = Math.max(
      1_000,
      Math.min(30_000, configuration().get<number>("pollIntervalMs", 3_000)),
    );
    this.timer = setInterval(() => void this.tick(), interval);
  }

  private async tick() {
    const snapshot = await this.service.refreshSnapshot();
    const active = snapshot.tasks.filter((task) =>
      ACTIVE_STATES.has(task.status),
    );
    const attention = snapshot.tasks.filter((task) =>
      ATTENTION_STATES.has(task.status),
    );
    if (!snapshot.online) {
      this.statusBar.text = "$(circle-slash) Council offline";
      this.statusBar.tooltip = "Start the local Council runtime";
    } else if (attention.length) {
      this.statusBar.text = `$(bell-dot) Council ${attention.length}`;
      this.statusBar.tooltip = `${attention.length} task${
        attention.length === 1 ? "" : "s"
      } need attention`;
    } else if (active.length) {
      this.statusBar.text = `$(sync~spin) Council ${active.length}`;
      this.statusBar.tooltip = `${active.length} active Council task${
        active.length === 1 ? "" : "s"
      }`;
    } else {
      this.statusBar.text = "$(organization) Council";
      this.statusBar.tooltip = "Open Council Agent Manager";
    }

    const current = new Map(snapshot.tasks.map((task) => [task.id, task.status]));
    if (this.initialized) {
      for (const task of snapshot.tasks) {
        if (
          ATTENTION_STATES.has(task.status) &&
          this.previous.get(task.id) !== task.status
        ) {
          const choice = await vscode.window.showInformationMessage(
            `Council: ${displayStatus(task.status)} — ${truncate(task.prompt)}`,
            "Open Agent Manager",
          );
          if (choice === "Open Agent Manager") {
            await vscode.commands.executeCommand("council.openAgentManager");
          }
        }
      }
    }
    this.initialized = true;
    this.previous = current;
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.statusBar.dispose();
  }
}

async function openManager(
  service: CouncilService,
  handoff: ManagerHandoff = {},
) {
  await service.startRuntime();
  const url = new URL(configuredUiUrl());
  if (handoff.prompt) url.searchParams.set("prompt", handoff.prompt);
  if (handoff.repository) {
    url.searchParams.set("repository", handoff.repository);
  }
  if (handoff.view) url.searchParams.set("view", handoff.view);
  try {
    await vscode.commands.executeCommand("simpleBrowser.show", url.toString());
  } catch {
    await vscode.env.openExternal(vscode.Uri.parse(url.toString()));
  }
}

async function runVisibleCommand(candidates: string[]) {
  const commands = new Set(await vscode.commands.getCommands(true));
  for (const candidate of candidates) {
    if (!commands.has(candidate)) continue;
    await vscode.commands.executeCommand(candidate);
    return true;
  }
  return false;
}

async function offerProviderInstall(
  label: string,
  extensionId: string,
  openVsxPath: string,
  cliCommand: string,
) {
  const choice = await vscode.window.showInformationMessage(
    `${label} is not installed in this editor.`,
    "Find extension",
    "Open Open VSX",
    `Run ${cliCommand}`,
  );
  if (choice === "Find extension") {
    await vscode.commands.executeCommand(
      "workbench.extensions.search",
      `@id:${extensionId}`,
    );
  } else if (choice === "Open Open VSX") {
    await vscode.env.openExternal(
      vscode.Uri.parse(`https://open-vsx.org/extension/${openVsxPath}`),
    );
  } else if (choice === `Run ${cliCommand}`) {
    const terminal = vscode.window.createTerminal(label);
    terminal.show();
    terminal.sendText(cliCommand, true);
  }
}

async function openProvider(
  provider: "codex" | "claude",
  includeSelection = false,
) {
  const descriptor =
    provider === "codex"
      ? {
          label: "Codex",
          extensionId: "openai.chatgpt",
          openVsxPath: "openai/chatgpt",
          cli: "codex",
          selectionCommands: ["chatgpt.addToThread"],
          openCommands: ["chatgpt.openSidebar", "chatgpt.newCodexPanel"],
        }
      : {
          label: "Claude Code",
          extensionId: "Anthropic.claude-code",
          openVsxPath: "Anthropic/claude-code",
          cli: "claude",
          selectionCommands: ["claude-vscode.insertAtMention"],
          openCommands: [
            "claude-vscode.editor.open",
            "claude-vscode.sidebar.open",
            "claude-vscode.focus",
          ],
        };
  const extension = extensionById(descriptor.extensionId);
  if (!extension) {
    await offerProviderInstall(
      descriptor.label,
      descriptor.extensionId,
      descriptor.openVsxPath,
      descriptor.cli,
    );
    return;
  }
  await extension.activate();
  if (includeSelection) {
    await runVisibleCommand(descriptor.selectionCommands);
  }
  if (!(await runVisibleCommand(descriptor.openCommands))) {
    throw new Error(
      `${descriptor.label} is installed but did not expose a supported open command.`,
    );
  }
}

function selectionPrompt() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;
  const document = editor.document;
  const selection = editor.selection;
  const selected = document.getText(selection).slice(0, 16_000);
  const workspace = vscode.workspace.getWorkspaceFolder(document.uri);
  const file = workspace
    ? path.relative(workspace.uri.fsPath, document.uri.fsPath)
    : document.uri.fsPath;
  const location = selection.isEmpty
    ? file
    : `${file}:${selection.start.line + 1}-${selection.end.line + 1}`;
  return selected
    ? `Review the selected code at ${location}. Explain relevant behavior, identify concrete risks, and implement changes only if the request requires them.\n\n${selected}`
    : `Review ${location} in the current repository. Explain the relevant behavior and identify concrete risks.`;
}

async function diagnosticPrompt() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) throw new Error("Open a source file containing diagnostics.");
  const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);
  if (!diagnostics.length) {
    throw new Error("The active file has no diagnostics.");
  }
  const cursor = editor.selection.active;
  const atCursor = diagnostics.filter((diagnostic) =>
    diagnostic.range.contains(cursor),
  );
  const candidates = atCursor.length ? atCursor : diagnostics;
  const items = candidates.map((diagnostic) => ({
    label: truncate(diagnostic.message, 100),
    description: `Line ${diagnostic.range.start.line + 1}`,
    diagnostic,
  }));
  const selected =
    items.length === 1
      ? items[0]
      : await vscode.window.showQuickPick(items, {
          placeHolder: "Choose a diagnostic to turn into a Council task",
        });
  if (!selected) return null;
  const workspace = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  const file = workspace
    ? path.relative(workspace.uri.fsPath, editor.document.uri.fsPath)
    : editor.document.uri.fsPath;
  const code =
    typeof selected.diagnostic.code === "object"
      ? selected.diagnostic.code.value
      : selected.diagnostic.code;
  return [
    `Fix the diagnostic in ${file}:${selected.diagnostic.range.start.line + 1}.`,
    code ? `Diagnostic code: ${String(code)}` : "",
    `Message: ${selected.diagnostic.message}`,
    "",
    "Inspect the surrounding implementation, make the smallest correct change, and run the relevant verification.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function commandGuard(action: () => Promise<void>) {
  try {
    await action();
  } catch (reason) {
    const message = String((reason as Error).message ?? reason);
    void vscode.window.showErrorMessage(message);
  }
}

export function activate(context: vscode.ExtensionContext) {
  const service = new CouncilService(context);

  const dispatch = async (command: string) => {
    if (command === "manager") {
      await vscode.commands.executeCommand("council.openAgentManager");
    } else if (command === "new-task") {
      await vscode.commands.executeCommand("council.newTask");
    } else if (command === "connect") {
      await vscode.commands.executeCommand("council.connectWorkspace");
    } else if (command === "github") {
      await vscode.commands.executeCommand("council.openGitHubWorkspace");
    } else if (command === "refresh") {
      await vscode.commands.executeCommand("council.refresh");
    } else if (command === "start") {
      await vscode.commands.executeCommand("council.startRuntime");
    } else if (command === "stop") {
      await vscode.commands.executeCommand("council.stopRuntime");
    } else if (command === "codex") {
      await vscode.commands.executeCommand("council.openCodex");
    } else if (command === "claude") {
      await vscode.commands.executeCommand("council.openClaude");
    }
  };
  const provider = new CouncilAgentManagerProvider(service, (command) =>
    commandGuard(() => dispatch(command)),
  );
  const monitor = new CouncilTaskMonitor(service);

  const register = (
    command: string,
    action: (...args: unknown[]) => Promise<void>,
  ) =>
    vscode.commands.registerCommand(command, (...args: unknown[]) =>
      commandGuard(() => action(...args)),
    );

  context.subscriptions.push(
    service,
    provider,
    monitor,
    vscode.window.registerWebviewViewProvider(
      "council.agentManager",
      provider,
    ),
    register("council.refresh", async () => {
      await service.refreshSnapshot(true);
    }),
    register("council.startRuntime", async () => {
      await service.startRuntime();
      void vscode.window.showInformationMessage("Council is ready.");
    }),
    register("council.stopRuntime", async () => {
      const active = service
        .currentSnapshot()
        .tasks.filter((task) => ACTIVE_STATES.has(task.status));
      if (active.length) {
        const choice = await vscode.window.showWarningMessage(
          `Stop Council services while ${active.length} task${
            active.length === 1 ? " is" : "s are"
          } active? Durable state is preserved, but active turns will stop.`,
          { modal: true },
          "Stop services",
        );
        if (choice !== "Stop services") return;
      }
      await service.stopRuntime();
    }),
    register("council.restartRuntime", async () => {
      await service.startRuntime(true);
      void vscode.window.showInformationMessage("Council restarted.");
    }),
    register("council.connectWorkspace", async () => {
      const repository = await service.connectWorkspace();
      void vscode.window.showInformationMessage(
        `${repository.name} is connected to Council.`,
      );
    }),
    register("council.openAgentManager", async () => {
      await openManager(service, {
        repository: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      });
    }),
    register("council.openGitHubWorkspace", async () => {
      let repository = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (repository) repository = (await service.connectWorkspace()).path;
      await openManager(service, { repository, view: "github" });
    }),
    register("council.newTask", async () => {
      const prompt = await vscode.window.showInputBox({
        prompt: "What should Council accomplish?",
        placeHolder:
          "Describe the behavior, file, issue, or verification evidence",
        ignoreFocusOut: true,
      });
      if (!prompt?.trim()) return;
      let repository = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (repository) {
        try {
          repository = (await service.connectWorkspace()).path;
        } catch {
          // The full manager will show the repository connection error.
        }
      }
      await openManager(service, { prompt: prompt.trim(), repository });
    }),
    register("council.openCodex", async () => openProvider("codex")),
    register("council.openClaude", async () => openProvider("claude")),
    register("council.sendSelectionToCodex", async () =>
      openProvider("codex", true),
    ),
    register("council.sendSelectionToClaude", async () =>
      openProvider("claude", true),
    ),
    register("council.sendSelection", async () => {
      const prompt =
        selectionPrompt() ??
        (await vscode.window.showInputBox({
          prompt: "What should Council inspect or change?",
          ignoreFocusOut: true,
        }));
      if (!prompt?.trim()) return;
      let repository = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (repository) {
        try {
          repository = (await service.connectWorkspace()).path;
        } catch {
          // The full manager will surface connection details.
        }
      }
      await openManager(service, { prompt: prompt.trim(), repository });
    }),
    register("council.createTaskFromDiagnostic", async () => {
      const prompt = await diagnosticPrompt();
      if (!prompt) return;
      let repository = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (repository) {
        repository = (await service.connectWorkspace()).path;
      }
      await openManager(service, { prompt, repository });
    }),
  );

  monitor.start();
  if (configuration().get<boolean>("startOnOpen", false)) {
    void commandGuard(async () => {
      await service.startRuntime();
    });
  }
}

export function deactivate() {
  // Council tasks are durable and may continue after the editor window closes.
}
