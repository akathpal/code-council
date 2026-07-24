import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function stateDirectory() {
  return path.resolve(
    process.env.COUNCIL_STATE_DIR ?? path.join(os.homedir(), ".council"),
  );
}

export function councilStatePaths() {
  const directory = stateDirectory();
  return {
    directory,
    stateFile: path.join(directory, "state.json"),
    worktrees: path.join(directory, "worktrees"),
    repositories: path.join(directory, "repositories"),
  };
}

export const DEFAULT_SETTINGS = {
  routingMode: "manual",
  strategy: "codex_only",
  autoBuildContext: true,
  codex: {
    model: "gpt-5.6-sol",
    reasoning: "high",
  },
  claude: {
    model: "claude-opus-4-8",
    reasoning: "high",
  },
  context: {
    provider: "claude",
    model: "claude-opus-4-8",
    reasoning: "high",
    tokenBudget: 4_000,
    enabledByDefault: true,
    graphify: true,
  },
};

function restoredSettings(value) {
  return {
    ...DEFAULT_SETTINGS,
    ...(value && typeof value === "object" ? value : {}),
    codex: {
      ...DEFAULT_SETTINGS.codex,
      ...(value?.codex && typeof value.codex === "object" ? value.codex : {}),
    },
    claude: {
      ...DEFAULT_SETTINGS.claude,
      ...(value?.claude && typeof value.claude === "object"
        ? value.claude
        : {}),
    },
    context: {
      ...DEFAULT_SETTINGS.context,
      ...(value?.context && typeof value.context === "object"
        ? value.context
        : {}),
    },
  };
}

export async function loadCouncilState() {
  const { stateFile } = councilStatePaths();
  const fallback = {
    schemaVersion: 3,
    repositories: [],
    settings: DEFAULT_SETTINGS,
    tasks: [],
    contextJobs: [],
  };
  try {
    const parsed = JSON.parse(await readFile(stateFile, "utf8"));
    return {
      schemaVersion: 3,
      repositories: Array.isArray(parsed.repositories)
        ? parsed.repositories
        : [],
      settings: restoredSettings(parsed.settings),
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      contextJobs: Array.isArray(parsed.contextJobs)
        ? parsed.contextJobs
        : [],
    };
  } catch {
    return fallback;
  }
}

export async function saveCouncilState(state) {
  const { directory, stateFile } = councilStatePaths();
  await mkdir(directory, { recursive: true });
  const temporary = `${stateFile}.${process.pid}.tmp`;
  await writeFile(
    temporary,
    `${JSON.stringify(
      {
        schemaVersion: 3,
        repositories: state.repositories,
        settings: restoredSettings(state.settings),
        tasks: state.tasks,
        contextJobs: state.contextJobs,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await rename(temporary, stateFile);
}
