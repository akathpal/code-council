# Contributing to code-council

code-council is early-stage local developer infrastructure. Small, evidence-backed
changes are easier to review than broad rewrites.

## Before opening a pull request

1. Search existing issues and discussions.
2. For behavior changes, open an issue describing the user problem, trust
   boundary, and evaluation plan.
3. Fork the repository and create a focused branch.
4. Run:

   ```bash
   npm ci
   npm run lint
   npm test
   ```

5. Include tests for routing, persistence, permissions, context selection, or
   state transitions when those areas change.

## Design principles

- Keep source and credentials local unless the user explicitly selects an
  authorized CLI/provider.
- Treat model output as untrusted data. Validate paths, commands, patches, and
  structured responses at the local runner boundary.
- Prefer deterministic evidence over model agreement.
- Record cost, latency, token usage, and human outcomes for strategy changes.
- Do not increase the default council call count without an evaluation showing
  a quality benefit worth the added cost and latency.
- Preserve existing user work and require explicit patch acceptance.

## Pull requests

Describe the user-visible result, risks, tests, and any benchmark impact.
Screenshots are useful for UI changes, but do not include private repository
content or credentials. By contributing, you agree that your contribution is
licensed under the MIT License.

## Development

`npm run dev` starts the full local stack. `npm run restart` stops an existing
code-council stack and starts a fresh one. State lives under `~/.council/` unless
`COUNCIL_STATE_DIR` is set.
