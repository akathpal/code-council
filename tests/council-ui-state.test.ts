import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_EXPANDED_FOLDERS,
  createCouncilUiState,
  migrateCouncilUiState,
  parseCouncilUiState,
  repositoryUiState,
  toggleExpandedFolder,
} from "../app/council-ui-state.ts";

test("initial UI state always provides a valid explorer expansion collection", () => {
  const state = createCouncilUiState();
  assert.deepEqual(
    repositoryUiState(state, "repo-a").expandedFolders,
    [...DEFAULT_EXPANDED_FOLDERS],
  );
});

test("repository switching keeps expansion state isolated per repository", () => {
  let state = createCouncilUiState();
  state = toggleExpandedFolder(state, "repo-a", "agent_context");
  state = toggleExpandedFolder(state, "repo-a", "agent_context/modules");
  state = toggleExpandedFolder(state, "repo-b", "docs");

  assert.deepEqual(repositoryUiState(state, "repo-a").expandedFolders, [
    "app",
    "src",
    "agent_context/modules",
  ]);
  assert.deepEqual(repositoryUiState(state, "repo-b").expandedFolders, [
    ...DEFAULT_EXPANDED_FOLDERS,
    "docs",
  ]);
});

test("expanding agent_context survives a serialized refresh", () => {
  let state = createCouncilUiState();
  state = toggleExpandedFolder(state, "repo-a", "agent_context");
  state = toggleExpandedFolder(state, "repo-a", "agent_context");

  const refreshed = parseCouncilUiState(JSON.stringify(state));
  assert.ok(
    new Set(repositoryUiState(refreshed, "repo-a").expandedFolders).has(
      "agent_context",
    ),
  );
});

test("malformed and older persisted values normalize without losing legacy selection", () => {
  const malformed = migrateCouncilUiState(
    {
      version: 0,
      selectedRepositoryId: 42,
      theme: "sepia",
      explorerWidth: 9_000,
      repositories: {
        "repo-a": { expandedFolders: undefined },
        "repo-b": { expandedFolders: ["src", null, "src", 9] },
      },
    },
    { selectedRepositoryId: "legacy-repo", theme: "light" },
  );

  assert.equal(malformed.selectedRepositoryId, "legacy-repo");
  assert.equal(malformed.theme, "light");
  assert.equal(malformed.explorerWidth, 420);
  assert.deepEqual(
    repositoryUiState(malformed, "repo-a").expandedFolders,
    [...DEFAULT_EXPANDED_FOLDERS],
  );
  assert.deepEqual(repositoryUiState(malformed, "repo-b").expandedFolders, [
    "src",
  ]);
  assert.doesNotThrow(() => parseCouncilUiState("{not-json"));
});
