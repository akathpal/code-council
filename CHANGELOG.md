# Changelog

This project follows [Semantic Versioning](https://semver.org/) after its first
stable release. Until then, minor releases may include breaking changes.

## [Unreleased]

### Added

- Local Codex CLI and Claude Code onboarding and model discovery.
- Persistent multi-repository tasks, chat, approvals, PIDs, cancellation, and
  isolated worktrees.
- Incremental `agent_context/` memory with Graphify-backed task retrieval.
- Configurable per-task context budgets and context on/off control.
- Per-task Codex and Claude token, latency, cost, and context-use accounting.
- Lean Claude propose → Codex critique → Claude revise → Codex execute council.
- Center-editor diff review with accept, decline, and revision feedback.
- High-level Activity workflow with failed-stage retry and full restart.

## [0.1.0] - 2026-07-20

Initial alpha prepared for public development.
