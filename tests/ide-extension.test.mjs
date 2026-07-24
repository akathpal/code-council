import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const extensionManifest = JSON.parse(
  await readFile(
    new URL("../ide/extension/package.json", import.meta.url),
    "utf8",
  ),
);
const productOverrides = JSON.parse(
  await readFile(
    new URL("../ide/product.overrides.json", import.meta.url),
    "utf8",
  ),
);

test("Council workbench extension exposes the complete developer entry points", () => {
  const commands = new Set(
    extensionManifest.contributes.commands.map((entry) => entry.command),
  );
  assert.deepEqual(
    [
      "council.openAgentManager",
      "council.openGitHubWorkspace",
      "council.newTask",
      "council.connectWorkspace",
      "council.startRuntime",
      "council.stopRuntime",
      "council.restartRuntime",
      "council.openCodex",
      "council.openClaude",
      "council.sendSelection",
      "council.sendSelectionToCodex",
      "council.sendSelectionToClaude",
      "council.createTaskFromDiagnostic",
    ].filter((command) => !commands.has(command)),
    [],
  );
  assert.equal(
    extensionManifest.contributes.views.council[0].id,
    "council.agentManager",
  );
});

test("provider experiences are referenced from Open VSX without bundled payloads", () => {
  assert.deepEqual(extensionManifest.extensionPack, [
    "openai.chatgpt",
    "Anthropic.claude-code",
  ]);
  assert.equal(
    productOverrides.extensionsGallery.serviceUrl,
    "https://open-vsx.org/vscode/gallery",
  );
  assert.match(
    productOverrides.extensionsGallery.itemUrl,
    /^https:\/\/open-vsx\.org\//,
  );
  assert.doesNotMatch(
    JSON.stringify(productOverrides.extensionsGallery),
    /marketplace\.visualstudio\.com/,
  );
});

test("Council IDE branding keeps a separate profile and URL protocol", () => {
  assert.equal(productOverrides.applicationName, "council");
  assert.equal(productOverrides.dataFolderName, ".council-ide");
  assert.equal(productOverrides.urlProtocol, "council");
  assert.equal(productOverrides.licenseName, "MIT");
});

test("Code-OSS preparation validates, brands, and bundles the Council workbench", async (context) => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "council-code-oss-test-"),
  );
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  await Promise.all([
    mkdir(path.join(temporaryRoot, "src", "vs", "workbench"), {
      recursive: true,
    }),
    mkdir(path.join(temporaryRoot, "extensions"), { recursive: true }),
    writeFile(
      path.join(temporaryRoot, "package.json"),
      `${JSON.stringify({ name: "code-oss-dev" })}\n`,
      "utf8",
    ),
    writeFile(
      path.join(temporaryRoot, "product.json"),
      `${JSON.stringify({
        nameShort: "Code - OSS",
        linkProtectionTrustedDomains: ["https://example.test"],
      })}\n`,
      "utf8",
    ),
  ]);

  await execFileAsync(
    process.execPath,
    [
      new URL("../ide/scripts/prepare-code-oss.mjs", import.meta.url).pathname,
      "--source",
      temporaryRoot,
    ],
    { timeout: 30_000 },
  );

  const preparedProduct = JSON.parse(
    await readFile(path.join(temporaryRoot, "product.json"), "utf8"),
  );
  assert.equal(preparedProduct.nameLong, "Council IDE");
  assert.equal(
    preparedProduct.extensionsGallery.serviceUrl,
    "https://open-vsx.org/vscode/gallery",
  );
  assert.deepEqual(
    new Set(preparedProduct.linkProtectionTrustedDomains),
    new Set([
      "https://example.test",
      "https://open-vsx.org",
      "https://github.com",
      "https://openai.com",
      "https://code.claude.com",
    ]),
  );
  await Promise.all([
    access(path.join(temporaryRoot, "extensions", "council", "package.json")),
    access(path.join(temporaryRoot, "extensions", "council", "dist", "extension.js")),
    access(path.join(temporaryRoot, ".council-prepared.json")),
  ]);
});
