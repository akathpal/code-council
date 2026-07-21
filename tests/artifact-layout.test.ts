import assert from "node:assert/strict";
import test from "node:test";
import {
  planAgentContextArtifacts,
  symbolArtifactPath,
} from "../lib/context/artifact-layout.ts";

test("creates stable Markdown paths for repository symbols", () => {
  const symbol = {
    filePath: "src/payments/refunds.ts",
    name: "processRefund",
    kind: "function" as const,
    contentHash: "hash-v2",
  };

  assert.equal(
    symbolArtifactPath(symbol),
    "agent_context/symbols/src/payments/refunds/processrefund.md",
  );

  const plan = planAgentContextArtifacts([symbol], {
    "src/payments/refunds.ts": "hash-v1",
  });
  assert.equal(plan.length, 2);
  assert.equal(plan.every((artifact) => artifact.regenerate), true);
});

test("reuses unchanged symbol context by content hash", () => {
  const symbol = {
    filePath: "src/orders/load.ts",
    name: "loadOrder",
    kind: "function" as const,
    contentHash: "same",
  };
  const plan = planAgentContextArtifacts([symbol], {
    "src/orders/load.ts": "same",
  });

  assert.equal(plan.every((artifact) => !artifact.regenerate), true);
});
