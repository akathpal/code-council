import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveWebRuntime,
  runtimeGlibcVersion,
  selectWebRuntime,
} from "../local/web-runtime.mjs";

test("old Linux glibc selects the containerized web runtime", () => {
  assert.deepEqual(
    selectWebRuntime({ platform: "linux", glibcVersion: "2.31" }),
    {
      kind: "container",
      reason: "glibc 2.31 is older than 2.35",
    },
  );
});

test("new Linux glibc and non-Linux platforms use the native runtime", () => {
  assert.equal(
    selectWebRuntime({ platform: "linux", glibcVersion: "2.35" }).kind,
    "native",
  );
  assert.equal(
    selectWebRuntime({ platform: "darwin", glibcVersion: null }).kind,
    "native",
  );
});

test("an explicit web runtime overrides automatic detection", () => {
  assert.equal(
    selectWebRuntime({
      override: "native",
      platform: "linux",
      glibcVersion: "2.31",
    }).kind,
    "native",
  );
  assert.equal(
    selectWebRuntime({
      override: "container",
      platform: "linux",
      glibcVersion: "2.35",
    }).kind,
    "container",
  );
});

test("container selection requires Docker Compose", async () => {
  await assert.rejects(
    resolveWebRuntime({
      override: "container",
      execFile: async () => {
        throw new Error("missing");
      },
    }),
    /needs Docker Compose/,
  );
});

test("runtime glibc detection reads the Node diagnostic report", () => {
  assert.equal(
    runtimeGlibcVersion({
      header: { glibcVersionRuntime: "2.31" },
    }),
    "2.31",
  );
});
