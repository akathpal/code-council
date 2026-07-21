export type SupportedPlatform = "macos" | "linux" | "windows";
export type CliId = "codex" | "claude";

export interface CliInstallOption {
  id: CliId;
  displayName: string;
  executable: string;
  detectArgs: string[];
  install: Record<SupportedPlatform, string>;
  authCommand: string;
  verifyCommand: string;
  docsUrl: string;
}

export const cliInstallers: Record<CliId, CliInstallOption> = {
  codex: {
    id: "codex",
    displayName: "Codex CLI",
    executable: "codex",
    detectArgs: ["--version"],
    install: {
      macos: "brew install --cask codex",
      linux: "npm install -g @openai/codex",
      windows:
        'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"',
    },
    authCommand: "codex",
    verifyCommand: "codex --version",
    docsUrl: "https://github.com/openai/codex#quickstart",
  },
  claude: {
    id: "claude",
    displayName: "Claude Code",
    executable: "claude",
    detectArgs: ["--version"],
    install: {
      macos: "brew install --cask claude-code",
      linux: "npm install -g @anthropic-ai/claude-code",
      windows: "winget install Anthropic.ClaudeCode",
    },
    authCommand: "claude",
    verifyCommand: "claude doctor",
    docsUrl: "https://code.claude.com/docs/en/getting-started",
  },
};

export function installPreview(id: CliId, platform: SupportedPlatform) {
  const installer = cliInstallers[id];
  return {
    id,
    displayName: installer.displayName,
    command: installer.install[platform],
    authCommand: installer.authCommand,
    verifyCommand: installer.verifyCommand,
    requiresExplicitConfirmation: true,
  };
}
