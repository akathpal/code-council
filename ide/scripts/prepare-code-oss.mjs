#!/usr/bin/env node

import { execFile } from "node:child_process";
import {
  access,
  cp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const argumentsList = process.argv.slice(2);
const sourceIndex = argumentsList.indexOf("--source");
const codeOssRoot = path.resolve(
  sourceIndex >= 0 && argumentsList[sourceIndex + 1]
    ? argumentsList[sourceIndex + 1]
    : path.join(repositoryRoot, "ide", "code-oss"),
);

async function requiredFile(filePath, explanation) {
  try {
    await access(filePath);
  } catch {
    throw new Error(`${explanation}: ${filePath}`);
  }
}

await requiredFile(
  path.join(codeOssRoot, "product.json"),
  "Code-OSS product.json was not found. Clone microsoft/vscode or pass --source",
);
await requiredFile(
  path.join(codeOssRoot, "src", "vs", "workbench"),
  "The selected source is not a complete Code-OSS checkout",
);

const packageJson = JSON.parse(
  await readFile(path.join(codeOssRoot, "package.json"), "utf8"),
);
if (packageJson.name !== "code-oss-dev") {
  throw new Error(
    `Refusing to modify an unexpected source tree (${packageJson.name ?? "unknown package"}).`,
  );
}

await execFileAsync("npm", ["run", "ide:build"], {
  cwd: repositoryRoot,
});

const [product, overrides] = await Promise.all([
  readFile(path.join(codeOssRoot, "product.json"), "utf8").then(JSON.parse),
  readFile(
    path.join(repositoryRoot, "ide", "product.overrides.json"),
    "utf8",
  ).then(JSON.parse),
]);
const recommendations = new Set([
  ...(product.extensionRecommendations ?? []),
  ...(overrides.extensionRecommendations ?? []),
]);
const nextProduct = {
  ...product,
  ...overrides,
  extensionsGallery: {
    ...(product.extensionsGallery ?? {}),
    ...overrides.extensionsGallery,
  },
  linkProtectionTrustedDomains: [
    ...new Set([
      ...(product.linkProtectionTrustedDomains ?? []),
      ...(overrides.linkProtectionTrustedDomains ?? []),
    ]),
  ],
  extensionRecommendations: [...recommendations],
};
await writeFile(
  path.join(codeOssRoot, "product.json"),
  `${JSON.stringify(nextProduct, null, 2)}\n`,
  "utf8",
);

const extensionSource = path.join(repositoryRoot, "ide", "extension");
const extensionTarget = path.join(codeOssRoot, "extensions", "council");
await rm(extensionTarget, { recursive: true, force: true });
await mkdir(extensionTarget, { recursive: true });
for (const entry of ["dist", "media"]) {
  await cp(path.join(extensionSource, entry), path.join(extensionTarget, entry), {
    recursive: true,
  });
}
for (const entry of ["package.json", "README.md", "LICENSE"]) {
  await cp(path.join(extensionSource, entry), path.join(extensionTarget, entry));
}

await writeFile(
  path.join(codeOssRoot, ".council-prepared.json"),
  `${JSON.stringify(
    {
      preparedAt: new Date().toISOString(),
      councilRepository: repositoryRoot,
      extension: "code-council.council",
      gallery: "https://open-vsx.org",
    },
    null,
    2,
  )}\n`,
  "utf8",
);

process.stdout.write(
  [
    `Prepared Council IDE in ${codeOssRoot}`,
    "The Council workbench extension is bundled under extensions/council.",
    "Codex and Claude Code remain separately installable from Open VSX.",
    "",
  ].join("\n"),
);
