# Changelog

This project follows [Semantic Versioning](https://semver.org/) after its first
stable release. Until then, minor releases may include breaking changes.

## [Unreleased]

### Added

- Setup Doctor in the CLI and app with actionable checks for local runtimes,
  agent authentication, Graphify, GitHub CLI, and OpenHands.
- Council Replay for running two to four strategies from the same repository
  snapshot and comparing usage, duration, evidence, and patches in a persistent
  parent workspace with individually openable child conversations.
- Automatic prompt intent for Council Replay, including read-only answer
  comparisons that create no worktrees or patches.
- Per-variant Codex and Claude model and intelligence selection in the Replay
  setup window, with configuration snapshots shown in the parent comparison.
- Strict clarification-marker parsing so source-code mentions cannot
  accidentally pause an agent run.
- Quota-free dismissal for stale or unwanted clarification requests.
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
