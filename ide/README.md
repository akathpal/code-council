# Council IDE

Council IDE is a thin, branded Code-OSS distribution. The editor remains close
to upstream Code-OSS; Council's product behavior lives in the bundled
`code-council.council` workbench extension and the existing local runtime.

## Product boundary

- Code-OSS supplies editing, terminals, source control, debugging, settings,
  accessibility, and the extension host.
- The Council extension supplies the Agent Manager, task attention state,
  workspace handoff, provider launchers, and editor-context commands.
- The local Council runtime owns agent processes, goals, skills, worktrees,
  approvals, persistence, GitHub operations, cost accounting, and review.
- Codex and Claude Code retain separate native extension experiences.

The editor uses Open VSX rather than Microsoft's Visual Studio Marketplace.
Both `openai.chatgpt` and `Anthropic.claude-code` are currently available as
verified, restricted namespaces on Open VSX. Council references those registry
entries; it does not copy their VSIX payloads into this repository or installer.

## Develop the workbench extension

```bash
npm run ide:build
npm run ide:package
```

The VSIX is written to `ide/build/council.vsix`. Install it into VS Code,
VSCodium, Cursor, Windsurf, or another compatible editor for development.
Configure `council.runtimePath` if the extension cannot discover this checkout.

## Prepare a Code-OSS checkout

Clone Code-OSS into the ignored default directory:

```bash
git clone https://github.com/microsoft/vscode.git ide/code-oss
npm run ide:prepare
```

Or prepare an existing checkout:

```bash
npm run ide:prepare -- --source /absolute/path/to/vscode
```

Preparation performs four bounded changes:

1. Builds the Council workbench extension.
2. overlays Council branding and the `council://` URL protocol;
3. configures the Open VSX registry and provider recommendations;
4. copies the compiled Council extension into `extensions/council`.

The script validates that the target is a Code-OSS source tree before replacing
the exact `extensions/council` directory. Follow the upstream Code-OSS build and
platform packaging instructions after preparation.

## Provider experiences

The **Codex** and **Claude Code** buttons activate the installed provider
extension. If a provider is missing, Council opens its registry search, its
Open VSX page, or its CLI in an integrated terminal. Council-managed tasks
continue to use Codex app-server and Claude stream JSON directly so task stop,
steering, goals, worktrees, usage, and evidence remain reliable.
