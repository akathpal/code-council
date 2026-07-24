# Changelog

This project follows [Semantic Versioning](https://semver.org/) after its first
stable release. Until then, minor releases may include breaking changes.

## [Unreleased]

### Added

- A packaged Council workbench extension and thin Code-OSS preparation path
  with an Agent Manager activity view, task-attention status, workspace
  connection, selection and diagnostic handoffs, GitHub entry points, and
  runtime start/stop/restart commands.
- Separate Codex and Claude Code launch experiences backed by their
  publisher-controlled Open VSX entries; provider VSIX payloads are not copied
  into code-council.
- Council workbench prompt handoffs that prefill the existing review-gated
  composer for the repository open in the editor.
- Persistent Codex threads and Claude sessions, with native live steering for
  both providers, graceful interruption, and fallback to linked
  stop-and-restart attempts.
- Repository-aware Codex and Claude skill discovery, provider-labelled
  automatic or explicit selection, typed Codex invocation, and native Claude
  skill preloading.
- Bounded durable Goal mode with native Codex thread goals and Claude `/goal`
  loops, token budgets, continuation safety limits, progress,
  pause/resume/edit/clear controls, and restart recovery.
- Developer-friendly composer behavior: Enter sends, Shift+Enter inserts a
  newline, focusing the textarea dismisses configuration menus, Stop remains
  visible beside active tasks, and failed runs support Edit & restart.
- A GitHub workspace backed by the authenticated `gh` CLI for open issues, pull
  requests, review decisions, check summaries, issue-to-goal creation, and
  failing-check fix tasks.
- Explicit task attempt history and provider capability state in schema-version
  3 local persistence.
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

### Changed

- Updated Next.js, React, React DOM, React Server Components, and PostCSS to
  compatible security-patched releases.

## [0.1.0] - 2026-07-20

Initial alpha prepared for public development.
