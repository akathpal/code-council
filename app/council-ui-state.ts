export const COUNCIL_UI_STATE_VERSION = 1 as const;
export const COUNCIL_UI_STATE_KEY = "council.uiState";

export const DEFAULT_EXPANDED_FOLDERS = ["app", "src", "agent_context"] as const;

export type TaskCenterView =
  | "conversation"
  | "environment"
  | "monitor"
  | "memory";

export type TaskListFilter =
  | "active"
  | "needs_input"
  | "review"
  | "failed"
  | "archived";

export type RepositoryUiState = {
  expandedFolders: string[];
  openFilePaths: string[];
  openTaskIds: string[];
  openDiffTaskIds: string[];
  activeTabId: string | null;
  selectedTaskId: string | null;
  taskViews: Record<string, TaskCenterView>;
  lastSeenTaskUpdates: Record<string, string>;
  taskFilter: TaskListFilter;
};

export type CouncilUiState = {
  version: typeof COUNCIL_UI_STATE_VERSION;
  selectedRepositoryId: string | null;
  theme: "dark" | "light";
  explorerWidth: number;
  notificationsEnabled: boolean;
  repositories: Record<string, RepositoryUiState>;
};

type LegacyUiState = {
  selectedRepositoryId?: string | null;
  theme?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0))];
}

function explorerWidth(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(220, Math.min(420, Math.round(value)))
    : 278;
}

function taskView(value: unknown): TaskCenterView {
  return ["conversation", "environment", "monitor", "memory"].includes(
    String(value),
  )
    ? (value as TaskCenterView)
    : "conversation";
}

function taskFilter(value: unknown): TaskListFilter {
  return ["active", "needs_input", "review", "failed", "archived"].includes(
    String(value),
  )
    ? (value as TaskListFilter)
    : "active";
}

export function createRepositoryUiState(): RepositoryUiState {
  return {
    expandedFolders: [...DEFAULT_EXPANDED_FOLDERS],
    openFilePaths: [],
    openTaskIds: [],
    openDiffTaskIds: [],
    activeTabId: null,
    selectedTaskId: null,
    taskViews: {},
    lastSeenTaskUpdates: {},
    taskFilter: "active",
  };
}

function normalizeRepositoryUiState(value: unknown): RepositoryUiState {
  if (!isRecord(value)) return createRepositoryUiState();
  const rawViews = isRecord(value.taskViews) ? value.taskViews : {};
  const normalizedViews = Object.fromEntries(
    Object.entries(rawViews)
      .filter(([taskId]) => taskId.length > 0)
      .map(([taskId, view]) => [taskId, taskView(view)]),
  );
  const rawSeen = isRecord(value.lastSeenTaskUpdates)
    ? value.lastSeenTaskUpdates
    : {};
  const lastSeenTaskUpdates = Object.fromEntries(
    Object.entries(rawSeen).filter(
      (entry): entry is [string, string] =>
        entry[0].length > 0 && typeof entry[1] === "string",
    ),
  );
  const expandedFolders = Array.isArray(value.expandedFolders)
    ? stringList(value.expandedFolders)
    : [...DEFAULT_EXPANDED_FOLDERS];
  return {
    expandedFolders,
    openFilePaths: stringList(value.openFilePaths),
    openTaskIds: stringList(value.openTaskIds),
    openDiffTaskIds: stringList(value.openDiffTaskIds),
    activeTabId: stringOrNull(value.activeTabId),
    selectedTaskId: stringOrNull(value.selectedTaskId),
    taskViews: normalizedViews,
    lastSeenTaskUpdates,
    taskFilter: taskFilter(value.taskFilter),
  };
}

export function createCouncilUiState(legacy: LegacyUiState = {}): CouncilUiState {
  return {
    version: COUNCIL_UI_STATE_VERSION,
    selectedRepositoryId: stringOrNull(legacy.selectedRepositoryId),
    theme: legacy.theme === "light" ? "light" : "dark",
    explorerWidth: 278,
    notificationsEnabled: false,
    repositories: {},
  };
}

/**
 * Treat browser state as untrusted input. This also migrates the earlier pair
 * of standalone repository/theme keys without touching service-owned data.
 */
export function migrateCouncilUiState(
  value: unknown,
  legacy: LegacyUiState = {},
): CouncilUiState {
  if (!isRecord(value)) return createCouncilUiState(legacy);
  const rawRepositories = isRecord(value.repositories) ? value.repositories : {};
  const repositories = Object.fromEntries(
    Object.entries(rawRepositories)
      .filter(([repositoryId]) => repositoryId.length > 0)
      .map(([repositoryId, state]) => [
        repositoryId,
        normalizeRepositoryUiState(state),
      ]),
  );
  return {
    version: COUNCIL_UI_STATE_VERSION,
    selectedRepositoryId:
      stringOrNull(value.selectedRepositoryId) ??
      stringOrNull(legacy.selectedRepositoryId),
    theme:
      value.theme === "light" || value.theme === "dark"
        ? value.theme
        : legacy.theme === "light"
          ? "light"
          : "dark",
    explorerWidth: explorerWidth(value.explorerWidth),
    notificationsEnabled: value.notificationsEnabled === true,
    repositories,
  };
}

export function parseCouncilUiState(
  serialized: string | null,
  legacy: LegacyUiState = {},
) {
  if (!serialized) return createCouncilUiState(legacy);
  try {
    return migrateCouncilUiState(JSON.parse(serialized), legacy);
  } catch {
    return createCouncilUiState(legacy);
  }
}

export function repositoryUiState(
  state: CouncilUiState,
  repositoryId: string | null,
) {
  if (!repositoryId) return createRepositoryUiState();
  return normalizeRepositoryUiState(state.repositories[repositoryId]);
}

export function updateRepositoryUiState(
  state: CouncilUiState,
  repositoryId: string,
  update: (current: RepositoryUiState) => RepositoryUiState,
): CouncilUiState {
  const current = repositoryUiState(state, repositoryId);
  return {
    ...state,
    selectedRepositoryId: repositoryId,
    repositories: {
      ...state.repositories,
      [repositoryId]: normalizeRepositoryUiState(update(current)),
    },
  };
}

export function toggleExpandedFolder(
  state: CouncilUiState,
  repositoryId: string,
  path: string,
) {
  return updateRepositoryUiState(state, repositoryId, (current) => {
    const expanded = new Set(current.expandedFolders);
    if (expanded.has(path)) expanded.delete(path);
    else expanded.add(path);
    return { ...current, expandedFolders: [...expanded] };
  });
}
