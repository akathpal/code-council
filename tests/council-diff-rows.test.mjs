import assert from "node:assert/strict";
import test from "node:test";
import {
  diffRows,
  diffRowText,
} from "../app/council-diff-rows.ts";

function visibleLines(diff) {
  return diffRows(diff).map(diffRowText);
}

test("formats a normal edit with a clean file path and no plumbing rows", () => {
  const rows = diffRows(`diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -3,2 +3,2 @@
-const before = true;
+const after = true;
 context
`);

  assert.deepEqual(rows.map(diffRowText), [
    "src/example.ts",
    "@@ -3,2 +3,2 @@",
    "-const before = true;",
    "+const after = true;",
    " context",
    "",
  ]);
  assert.deepEqual(
    rows.slice(1, 5).map(({ kind, oldLine, newLine }) => ({
      kind,
      oldLine,
      newLine,
    })),
    [
      { kind: "hunk", oldLine: "", newLine: "" },
      { kind: "remove", oldLine: 3, newLine: "" },
      { kind: "add", oldLine: "", newLine: 3 },
      { kind: "context", oldLine: 4, newLine: 4 },
    ],
  );
});

test("formats a new file without mode or source-marker noise", () => {
  const lines = visibleLines(`diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/new.txt
@@ -0,0 +1 @@
+hello
`);

  assert.deepEqual(lines, ["new.txt", "@@ -0,0 +1 @@", "+hello", ""]);
});

test("formats a deleted file without mode or source-marker noise", () => {
  const lines = visibleLines(`diff --git a/old.txt b/old.txt
deleted file mode 100644
index 1111111..0000000
--- a/old.txt
+++ /dev/null
@@ -1 +0,0 @@
-goodbye
`);

  assert.deepEqual(lines, ["old.txt", "@@ -1 +0,0 @@", "-goodbye", ""]);
});

test("retains rename-only and similarity details", () => {
  const lines = visibleLines(`diff --git a/old-name.ts b/new-name.ts
similarity index 100%
rename from old-name.ts
rename to new-name.ts
`);

  assert.deepEqual(lines, [
    "new-name.ts",
    "similarity index 100%",
    "rename from old-name.ts",
    "rename to new-name.ts",
    "",
  ]);
});
