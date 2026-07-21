import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { CopyPathButton } from "../app/copy-path-button.ts";

const DOM_GLOBALS = [
  "window",
  "document",
  "navigator",
  "Node",
  "Element",
  "HTMLElement",
  "MouseEvent",
];

function installDom() {
  const dom = new JSDOM(
    "<!doctype html><html><body><details open><summary><span id=\"root\"></span></summary><div>Diff</div></details></body></html>",
    { url: "http://localhost/" },
  );
  const descriptors = new Map(
    DOM_GLOBALS.map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  );

  for (const name of DOM_GLOBALS) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: dom.window[name],
    });
  }
  const actEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  return {
    dom,
    restore() {
      for (const [name, descriptor] of descriptors) {
        if (descriptor) {
          Object.defineProperty(globalThis, name, descriptor);
        } else {
          delete globalThis[name];
        }
      }
      globalThis.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
      dom.window.close();
    },
  };
}

test("copies the exact path, suppresses summary toggling, and resets its label", async (t) => {
  const { dom, restore } = installDom();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const writeText = t.mock.fn(async () => {});
  Object.defineProperty(dom.window.navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  const container = dom.window.document.querySelector("#root");
  const details = dom.window.document.querySelector("details");
  assert.ok(container);
  assert.ok(details);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(createElement(CopyPathButton, { path: "src/nested/file.ts" }));
    });
    const button = container.querySelector("button");
    assert.ok(button);
    assert.equal(button.type, "button");
    assert.equal(button.textContent, "Copy path");

    const click = new dom.window.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      button.dispatchEvent(click);
      await Promise.resolve();
    });

    assert.equal(click.defaultPrevented, true);
    assert.equal(details.open, true);
    assert.equal(writeText.mock.callCount(), 1);
    assert.deepEqual(writeText.mock.calls[0].arguments, ["src/nested/file.ts"]);
    assert.equal(button.textContent, "Copied");
    assert.equal(button.classList.contains("is-copied"), true);

    act(() => t.mock.timers.tick(1500));
    assert.equal(button.textContent, "Copy path");
    assert.equal(button.classList.contains("is-copied"), false);
  } finally {
    await act(async () => root.unmount());
    t.mock.timers.reset();
    restore();
  }
});

test("does not change state when the Clipboard API is unavailable", async () => {
  const { dom, restore } = installDom();
  Object.defineProperty(dom.window.navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
  const container = dom.window.document.querySelector("#root");
  assert.ok(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(createElement(CopyPathButton, { path: "src/file.ts" }));
    });
    const button = container.querySelector("button");
    assert.ok(button);

    await act(async () => {
      button.dispatchEvent(
        new dom.window.MouseEvent("click", {
          bubbles: true,
          cancelable: true,
        }),
      );
      await Promise.resolve();
    });

    assert.equal(button.textContent, "Copy path");
    assert.equal(button.classList.contains("is-copied"), false);
  } finally {
    await act(async () => root.unmount());
    restore();
  }
});
