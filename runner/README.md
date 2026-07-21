# code-council local runtime

code-council uses OpenHands Agent Canvas and Agent Server as its local agent-runtime
foundation. The launcher in `bin/council.mjs` starts:

1. Agent Canvas in `--backend-only` mode on port 8001;
2. the code-council loopback service in `local/server.mjs` on port 4781;
3. the minimal code-council UI on port 3000.

The loopback service owns native capabilities that do not belong in a browser:
CLI detection, local repository inspection, validated `agent_context/` writes,
agent subprocesses, persistent context/task jobs, isolated Git worktrees,
patch acceptance, and verification output. It binds to `127.0.0.1`; the UI
reaches it through the Vite same-origin proxy.

## Safety boundaries

- Agent detection uses fixed version commands.
- Git operations use argument arrays rather than shell interpolation.
- Context generation pins `claude-opus-4-8` at high effort and gives Claude
  read-only tools and plan permissions.
- Claude returns structured context; code-council validates every output path and
  writes only under `agent_context/`.
- Context generation has an explicit budget cap.
- Manual routing is the UI default; automatic routing is opt-in.
- Every task runs in a separate Git worktree. Codex planning is read-only; only
  the execution stage receives a workspace-write sandbox in that worktree.
- code-council selects a bounded task-specific pack from `agent_context/` and
  injects it into every Codex and Claude call.
- The connected repository changes only after explicit acceptance. Acceptance
  queues an incremental Opus context refresh.
- Job state is persisted under `~/.council/state.json`, so the UI can recover
  progress after a reload.
- No installer or arbitrary browser-supplied shell command is executed.

The normalized protocol in `protocol.ts` remains the long-term event boundary
for persisted runs and additional ACP-compatible agents.
