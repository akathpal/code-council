#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const extensionRoot = path.join(repositoryRoot, "ide", "extension");
const outputDirectory = path.join(repositoryRoot, "ide", "build");
const outputPath = path.join(outputDirectory, "council.vsix");

await mkdir(outputDirectory, { recursive: true });
await execFileAsync("npm", ["run", "ide:build"], {
  cwd: repositoryRoot,
  maxBuffer: 10 * 1024 * 1024,
});
const result = await execFileAsync(
  "npm",
  ["exec", "--", "vsce", "package", "--out", outputPath],
  {
    cwd: extensionRoot,
    maxBuffer: 10 * 1024 * 1024,
  },
);
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
