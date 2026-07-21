import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  graphifyOperationArgs,
  runGraphifyOperation,
  scoreGraphifyConfidence,
} from "../local/graphify-gateway.mjs";

test("Graphify gateway constrains graphs and creates read-only operation arguments", () => {
  const repository = "/work/repository";
  assert.deepEqual(
    graphifyOperationArgs(repository, {
      operation: "path",
      from: "AuthController",
      to: "SessionStore",
    }).args,
    [
      "path",
      "AuthController",
      "SessionStore",
      "--graph",
      "/work/repository/graphify-out/graph.json",
    ],
  );
  assert.throws(
    () =>
      graphifyOperationArgs(repository, {
        operation: "query",
        question: "authentication",
        graphPath: "../outside.json",
      }),
    /inside graphify-out/,
  );
  assert.throws(
    () => graphifyOperationArgs(repository, { operation: "delete" }),
    /Unsupported Graphify operation/,
  );
});

test("Graphify gateway caps output and passes no shell command", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "council-gateway-"));
  await mkdir(path.join(temporary, "graphify-out"), { recursive: true });
  await writeFile(path.join(temporary, "graphify-out", "graph.json"), "{}\n");
  let invocation = null;
  try {
    const result = await runGraphifyOperation(
      temporary,
      {
        operation: "affected",
        target: "SessionStore",
        depth: 9,
      },
      {
        maxOutputTokens: 64,
        runner: async (executable, args, options) => {
          invocation = { executable, args, options };
          return { stdout: "x".repeat(1_000), durationMs: 12 };
        },
      },
    );
    assert.equal(invocation.executable, "graphify");
    assert.deepEqual(invocation.args.slice(0, 4), [
      "affected",
      "SessionStore",
      "--depth",
      "4",
    ]);
    assert.equal(invocation.options.cwd, temporary);
    assert.equal(result.output.length, 256);
    assert.equal(result.truncated, true);
    assert.equal(result.durationMs, 12);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("Graphify confidence is interpretable and gates sparse evidence", () => {
  const sparse = scoreGraphifyConfidence({
    status: "used",
    nodeCount: 1,
    referencedPaths: ["src/auth.ts"],
    symbols: ["authenticate"],
    queryCount: 1,
    successfulQueries: 1,
    repositoryStatus: "fresh",
  });
  const covered = scoreGraphifyConfidence({
    status: "used",
    nodeCount: 8,
    referencedPaths: ["a.ts", "b.ts", "c.ts", "d.ts"],
    symbols: ["a", "b", "c", "d", "e"],
    queryCount: 2,
    successfulQueries: 2,
    repositoryStatus: "fresh",
    memoryMatchCount: 3,
  });
  assert.equal(sparse.shouldEscalate, true);
  assert.equal(sparse.level, "low");
  assert.equal(covered.shouldEscalate, false);
  assert.equal(covered.level, "high");
  assert.ok(covered.score > sparse.score);
});
