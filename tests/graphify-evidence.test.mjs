import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeGraphifyEvidence,
  parseGraphifyEvidence,
  parseGraphifyOperationEvidence,
} from "../local/graphify-evidence.mjs";

test("Graphify query output becomes safe ranked file and symbol evidence", () => {
  const evidence = parseGraphifyEvidence(
    `Query: context pack
Traversal: BFS depth=2 | Start: ['buildTaskContextPack'] | 2 nodes found

NODE buildTaskContextPack [src=local/core.mjs loc=L1701 community=]
NODE taskContextOptions [src=/work/repository/local/core.mjs loc=L2440 community=]
Query: unsafe path
NODE unsafe [src=../outside.mjs loc=L1 community=]
EDGE buildTaskContextPack --calls [EXTRACTED]--> taskContextOptions`,
    "/work/repository",
  );

  assert.deepEqual(evidence.referencedPaths, ["local/core.mjs"]);
  assert.deepEqual(evidence.symbols, [
    "buildTaskContextPack",
    "taskContextOptions",
    "unsafe",
  ]);
  assert.equal(evidence.nodes.length, 3);
  assert.equal(evidence.edgeCount, 1);
  assert.equal(evidence.queryCount, 2);
  assert.deepEqual(
    evidence.nodes.map((node) => node.queryIndex),
    [0, 0, 1],
  );
});

test("Graphify affected and explain output adds safe follow-up evidence", () => {
  const affected = parseGraphifyOperationEvidence(
    `Affected nodes for SessionStore()
- AuthController() [calls] src/auth/controller.ts:L18
- unsafe() [calls] ../outside.ts:L1`,
    "/work/repository",
    "affected",
    2,
  );
  const explained = parseGraphifyOperationEvidence(
    `Node: SessionStore()
  Source: src/auth/session.ts L7

Connections (1):
  <-- AuthController() [calls] [EXTRACTED]`,
    "/work/repository",
    "explain",
    3,
  );
  const merged = mergeGraphifyEvidence(affected, explained);

  assert.deepEqual(affected.referencedPaths, ["src/auth/controller.ts"]);
  assert.equal(affected.nodes[0].queryIndex, 2);
  assert.deepEqual(explained.referencedPaths, ["src/auth/session.ts"]);
  assert.deepEqual(merged.referencedPaths, [
    "src/auth/controller.ts",
    "src/auth/session.ts",
  ]);
  assert.ok(merged.symbols.includes("SessionStore()"));
});
