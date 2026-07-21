import type { CliId, SupportedPlatform } from "../lib/onboarding/installers";
import type { RiskTier } from "../lib/council/types";

export type RunnerCommand =
  | { type: "detect_cli"; cli: CliId }
  | {
      type: "install_cli";
      cli: CliId;
      platform: SupportedPlatform;
      approvedCommand: string;
    }
  | {
      type: "connect_repository";
      source: { kind: "local"; path: string } | { kind: "git"; url: string };
    }
  | {
      type: "generate_context";
      repositoryId: string;
      mode: "initial" | "incremental" | "manual";
      structuralEngine: "source" | "graphify";
      model: "claude-opus-4-8";
      effort: "high";
    }
  | {
      type: "run_task";
      repositoryId: string;
      prompt: string;
      riskTier: RiskTier;
      selectedAgents: Array<"codex" | "claude">;
    };

export type RunnerEvent =
  | {
      type: "cli_status";
      cli: CliId;
      status: "missing" | "installed" | "authenticated" | "error";
      version?: string;
      message?: string;
    }
  | {
      type: "context_progress";
      phase:
        | "graph_extract"
        | "graph_cluster"
        | "impact_query"
        | "summarize"
        | "write"
        | "complete";
      completed: number;
      total: number;
      outputRoot: "agent_context";
    }
  | {
      type: "council_stage";
      stage:
        | "prepare"
        | "route"
        | "propose"
        | "critique"
        | "revise"
        | "judge"
        | "execute"
        | "verify"
        | "review"
        | "accept";
      agent?: "codex" | "claude";
      status: "queued" | "running" | "complete" | "failed";
    }
  | {
      type: "command_result";
      commandType: RunnerCommand["type"];
      ok: boolean;
      message: string;
    };

export const LOCAL_RUNNER_PROTOCOL_VERSION = "1.0";

export function isInstallCommandApproved(
  command: Extract<RunnerCommand, { type: "install_cli" }>,
  expectedCommand: string,
) {
  return command.approvedCommand === expectedCommand;
}
