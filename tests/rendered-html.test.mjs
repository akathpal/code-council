import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the local-first code-council workflow", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /code-council — Better code through collective intelligence/i);
  assert.match(html, /Local coding workspace/i);
  assert.match(html, /Open editor tabs/i);
  assert.match(html, /Ask about the repository/i);
  assert.match(html, /Start a code change/i);
  assert.match(html, /Codex/i);
  assert.match(html, /Claude/i);
  assert.match(html, /Repository/i);
  assert.match(html, /Message code-council/i);
  assert.match(html, /code-council infers chat or code/i);
  assert.match(html, /Review gated/i);
  assert.match(html, /Task windows/i);
  assert.match(html, /Connect repository/i);
  assert.match(html, /Build context/i);
  assert.match(html, /Local runtime/i);
  assert.match(html, /Switch to light mode/i);
  assert.doesNotMatch(html, /Prompt intent/i);
  assert.match(html, /aria-label="Open editor tabs"/i);
  assert.match(html, /title="New task"/i);
  assert.match(html, /gpt-5\.6-sol/i);
  assert.doesNotMatch(html, /Your site is taking shape/i);
  assert.doesNotMatch(html, /react-loading-skeleton/i);
});
