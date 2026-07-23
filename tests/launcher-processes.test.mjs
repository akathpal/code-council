import assert from "node:assert/strict";
import test from "node:test";

import { processAncestorIds } from "../local/launcher-processes.mjs";

test("launcher process discovery identifies every ancestor wrapper", async () => {
  const parents = new Map([
    [40, 30],
    [30, 20],
    [20, 1],
  ]);

  const ancestors = await processAncestorIds(
    40,
    async (pid) => parents.get(pid) ?? null,
  );

  assert.deepEqual([...ancestors], [30, 20, 1]);
});

test("launcher process discovery stops on malformed or cyclic process trees", async () => {
  const parents = new Map([
    [40, 30],
    [30, 40],
  ]);

  const ancestors = await processAncestorIds(
    40,
    async (pid) => parents.get(pid) ?? null,
  );

  assert.deepEqual([...ancestors], [30, 40]);
});
