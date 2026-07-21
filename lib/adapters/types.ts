export type AdapterKind = "native_cli" | "acp" | "openhands";

export interface AgentCapabilities {
  readFiles: boolean;
  writeFiles: boolean;
  runCommands: boolean;
  streamEvents: boolean;
  resumeSession: boolean;
  structuredOutput: boolean;
}

export interface AgentAdapterDescriptor {
  id: string;
  displayName: string;
  vendor: string;
  kind: AdapterKind;
  transport: string;
  executable?: string;
  defaultRole: "context" | "planner" | "executor" | "optional";
  capabilities: AgentCapabilities;
  trustBoundary: "local_runner" | "remote_runtime";
}

export interface AgentRequest {
  runId: string;
  stage: "propose" | "critique" | "revise" | "judge";
  task: string;
  contextPackId: string;
  workspacePath: string;
  readOnly: boolean;
  timeoutMs: number;
}

export interface AgentResult {
  ok: boolean;
  text: string;
  sessionId?: string;
  exitCode?: number;
  costMicros?: number;
  latencyMs: number;
  error?: string;
}
