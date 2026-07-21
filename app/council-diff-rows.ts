export type DiffRow = {
  line: string;
  index: number;
  kind: "file" | "hunk" | "add" | "remove" | "context" | "meta";
  oldLine: number | "";
  newLine: number | "";
  file: string;
};

const HIDDEN_META_PREFIXES = [
  "index ",
  "--- ",
  "+++ ",
  "new file mode",
  "deleted file mode",
];

export function diffRowText(row: DiffRow) {
  return row.kind === "file" ? row.file : row.line;
}

export function diffRows(diff: string): DiffRow[] {
  let oldLine = 0;
  let newLine = 0;
  let currentFile = "";
  const rows: DiffRow[] = [];

  for (const [index, line] of diff.split(/\r?\n/).entries()) {
    if (line.startsWith("diff --git ")) {
      currentFile = line.match(/ b\/(.+)$/)?.[1] ?? "";
      oldLine = 0;
      newLine = 0;
      rows.push({
        line,
        index,
        kind: "file",
        oldLine: "",
        newLine: "",
        file: currentFile,
      });
      continue;
    }
    if (HIDDEN_META_PREFIXES.some((prefix) => line.startsWith(prefix))) {
      continue;
    }
    if (line.startsWith("@@")) {
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)?/);
      oldLine = Number(match?.[1] ?? 0);
      newLine = Number(match?.[2] ?? 0);
      rows.push({
        line,
        index,
        kind: "hunk",
        oldLine: "",
        newLine: "",
        file: currentFile,
      });
      continue;
    }
    if (line.startsWith("+")) {
      rows.push({
        line,
        index,
        kind: "add",
        oldLine: "",
        newLine: newLine++,
        file: currentFile,
      });
      continue;
    }
    if (line.startsWith("-")) {
      rows.push({
        line,
        index,
        kind: "remove",
        oldLine: oldLine++,
        newLine: "",
        file: currentFile,
      });
      continue;
    }
    if (line.startsWith(" ")) {
      rows.push({
        line,
        index,
        kind: "context",
        oldLine: oldLine++,
        newLine: newLine++,
        file: currentFile,
      });
      continue;
    }
    rows.push({
      line,
      index,
      kind: "meta",
      oldLine: "",
      newLine: "",
      file: currentFile,
    });
  }

  return rows;
}
