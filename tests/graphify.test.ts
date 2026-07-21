import assert from "node:assert/strict";
import test from "node:test";
import {
  graphifyExtraction,
  graphifyTaskQuery,
} from "../lib/context/graphify.ts";

test("builds an argv-safe initial Graphify extraction", () => {
  const invocation = graphifyExtraction("/work/repository", "initial");
  assert.deepEqual(invocation.args, [
    "update",
    "/work/repository",
    "--no-cluster",
  ]);
  assert.deepEqual(invocation.expectedOutputs, ["graphify-out/graph.json"]);
  assert.equal(invocation.networkRequired, false);
});

test("uses incremental extraction and scoped task queries", () => {
  const update = graphifyExtraction("/work/repository", "incremental");
  assert.deepEqual(update.args, [
    "update",
    "/work/repository",
    "--no-cluster",
  ]);

  const query = graphifyTaskQuery("  trace   refund retries ", undefined, 900);
  assert.deepEqual(query.args, [
    "query",
    "trace refund retries",
    "--context",
    "call",
    "--context",
    "import",
    "--budget",
    "900",
    "--graph",
    "graphify-out/graph.json",
  ]);
});
