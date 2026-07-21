import assert from "node:assert/strict";
import test from "node:test";
import {
  buildContextPack,
  planIncrementalIndex,
} from "../lib/context/planner.ts";
import type { ContextCandidate } from "../lib/context/types.ts";

const candidate = (
  id: string,
  tokens: number,
  overrides: Partial<ContextCandidate> = {},
): ContextCandidate => ({
  id,
  kind: "module_summary",
  label: id,
  contentHash: id,
  estimatedTokens: tokens,
  relevance: 0.8,
  graphProximity: 0.7,
  freshness: 1,
  confidence: 0.9,
  historicalUtility: 0.7,
  ...overrides,
});

test("buildContextPack prioritizes required evidence and respects budget", () => {
  const pack = buildContextPack(
    [
      candidate("optional", 500, { relevance: 1 }),
      candidate("required", 700, { required: true, relevance: 0.4 }),
      candidate("tail", 400, { relevance: 0.2 }),
    ],
    1_100,
    4_000,
  );

  assert.deepEqual(
    pack.selected.map((item) => item.id),
    ["required", "tail"],
  );
  assert.equal(pack.selectedTokens, 1_100);
  assert.equal(pack.savedTokens, 2_900);
  assert.equal(pack.savingsRate, 0.725);
});

test("buildContextPack removes duplicate content hashes", () => {
  const pack = buildContextPack(
    [
      candidate("one", 200, { contentHash: "same" }),
      candidate("two", 200, { contentHash: "same", relevance: 0.5 }),
    ],
    1_000,
  );

  assert.equal(pack.selected.length, 1);
  assert.equal(pack.rejected[0]?.reason, "duplicate");
});

test("planIncrementalIndex classifies changed paths", () => {
  const plan = planIncrementalIndex(
    {
      sha: "before",
      files: { "a.ts": "a1", "b.ts": "b1", "gone.ts": "g1" },
    },
    {
      sha: "after",
      files: { "a.ts": "a1", "b.ts": "b2", "new.ts": "n1" },
    },
  );

  assert.deepEqual(plan.reused, ["a.ts"]);
  assert.deepEqual(plan.modified, ["b.ts"]);
  assert.deepEqual(plan.added, ["new.ts"]);
  assert.deepEqual(plan.removed, ["gone.ts"]);
});

