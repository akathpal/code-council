import assert from "node:assert/strict";
import test from "node:test";

import { localRequest } from "../app/local-request.ts";

test("local requests explain empty proxy responses", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 502 });
  try {
    await assert.rejects(
      localRequest("/v1/status"),
      /local companion is unavailable \(HTTP 502\)/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("local requests preserve JSON API errors", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ error: "Repository is unavailable." }, { status: 404 });
  try {
    await assert.rejects(
      localRequest("/v1/repositories/missing"),
      /Repository is unavailable/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
