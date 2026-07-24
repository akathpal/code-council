# Council for VS Code-compatible editors

Council adds an agent manager beside the editor while preserving separate
native Codex and Claude Code experiences.

- Run Codex-only, Claude-only, or cost-aware multi-agent Council tasks.
- Stop, steer, retry, pause, and resume durable work.
- Keep code changes isolated in Git worktrees until review.
- Review evidence, tests, token usage, goals, and skills.
- Turn GitHub issues, pull requests, and failed checks into tasks.

The extension talks only to the loopback code-council service. Repository paths,
CLI authentication, worktrees, and task history remain on the developer's
machine.

Open the Council activity-bar view, start the runtime, connect the current
workspace, and open the full Agent Manager with `Ctrl+Alt+C`.
