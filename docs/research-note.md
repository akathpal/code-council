# Research note and open questions

## Working hypotheses

1. A compact, incrementally maintained repository memory can reduce repeated context tokens without lowering task success.
2. Codex and Claude provide enough diversity that peer critique improves high-uncertainty coding tasks more often than another same-agent sample.
3. Executable evidence and human review signals can calibrate confidence better than self-report or agreement.
4. A selective council can approach full-council quality at materially lower cost and latency.
5. Teams will trust disagreement if it is linked to files, tests, and decisions rather than presented as competing chat transcripts.

These are hypotheses, not product claims. code-council's benchmark lab exists to falsify them.

## Context decision: layered retrieval, not a giant prompt

code-council should not pass the entire generated memory on every call, and it should
not rely on a single “skill” file either. The implemented alpha uses four
layers:

1. **Durable repo memory:** small, evidence-linked Markdown views generated
   initially and incrementally after accepted patches.
2. **Structural retrieval:** a local Graphify AST graph updated without a model
   call and queried for the current task under a sub-budget.
3. **Task capsule:** the graph answer plus ranked repo/module/convention/risk
   documents, capped by a user-selected 256–64,000 token budget.
4. **Demand-driven source:** the active agent verifies important claims and
   reads exact files only when necessary.

The capsule is supplied once to the council proposer. Critique inspects source
selectively; revise consumes the proposal and critique; execution consumes the
reviewed plan. Direct single-agent tasks receive one capsule. This retains the
token benefit of a precomputed map without charging for the same prose four
times.

A file reference only saves tokens if the agent reads it selectively. If every
agent is instructed to open one large “repo skill,” its contents still enter
the model context and the cost returns. The valuable abstraction is therefore
an addressable retrieval index plus a bounded task capsule—not a special file
extension.

This direction is consistent with:

- [Aider's repository map](https://aider.chat/docs/repomap.html), which uses a
  dynamically budgeted, relevance-ranked map because indiscriminate files add
  cost and distract the model;
- [ReCUBE](https://arxiv.org/abs/2603.25770), where dependency-graph exploration
  improved strict pass rate by up to 7.56 percentage points over evaluated
  baselines while full repository context remained difficult to use;
- [SWE-Explore](https://arxiv.org/abs/2606.07297), which evaluates ranked code
  regions under a fixed line budget and finds efficient line-level coverage to
  be a key differentiator;
- [CORE-Bench](https://arxiv.org/abs/2606.11864), which shows that issue-driven
  repository retrieval is materially harder than isolated snippet search.

These papers support the architecture, not a claim that code-council's current
heuristic is optimal. The context-on/context-off and budget ablations in
[evaluation.md](evaluation.md) are required before claiming savings.

## Highest-priority experiments

### Memory ablation

Run the same repo tasks with:

- raw file search only;
- Graphify structural graph;
- Graphify graph plus Opus 4.8 summaries;
- Opus-only repository investigation;
- full memory including decisions and outcomes.

Measure success, context tokens, latency, retrieval precision, and stale-memory failures.

### code-council ablation

Compare:

- Codex only;
- Claude only;
- best historical single agent;
- independent proposals plus judge;
- propose + critique;
- propose + critique + revise;
- full protocol with tests;
- homogeneous two-sample debate.

This isolates whether gains come from extra inference, vendor diversity, critique, revision, or executable evidence.

The implemented default is the four-call heterogeneous sequence: Claude
proposes, Codex critiques, Claude revises, and Codex executes. It is a
cross-model form of generate → feedback → refine, with deterministic checks and
the developer serving as the final judge. Independent parallel proposals,
reciprocal critique, and a separate judge are reserved for benchmark arms and
future low-confidence escalation because they repeat the same repository pack
and materially increase cost and latency.

This choice follows three useful research signals:

- [Self-Refine](https://arxiv.org/abs/2303.17651) provides evidence for the
  generate → feedback → refine pattern without requiring parallel proposals.
- [Multiagent Debate](https://arxiv.org/abs/2305.14325) supports additional
  agents and rounds as a useful hard-reasoning strategy, which code-council keeps as
  a selective escalation rather than a default.
- [Anthropic's multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
  reports substantially higher token use for multi-agent systems and notes
  that tightly coupled work with many dependencies, including most coding
  tasks, is less naturally parallel. code-council therefore spends the extra calls
  on sequential error correction.

Model lists are discovered from the installed CLIs. Codex uses its structured
`model/list` response and preserves each model's supported reasoning levels.
Claude uses the documented [`/model` command](https://code.claude.com/docs/en/commands);
Fable is filtered by product policy. Prompt roles are intentionally concise in
line with OpenAI's [GPT-5.6 prompting guidance](https://developers.openai.com/api/docs/guides/prompt-guidance-gpt-5p6).

### Confidence calibration

Compare raw self-confidence, model agreement, judge score, deterministic evidence, and the combined calibrator. Track expected calibration error and false-stop rate by task class.

### Human feedback validity

Determine which review signals predict durable success:

- approval;
- requested changes;
- comment severity;
- review time;
- follow-up commits;
- revert;
- incident.

Review styles vary substantially by team, so normalization may need repository-specific models.

## Open product questions

- Should all `agent_context/` artifacts be committed, or should teams commit only
  stable repository/module summaries while keeping symbol files local?
- Which memory artifacts should developers be able to edit directly?
- How should private repository memory be shared across a team without leaking code to model providers?
- When should identity be masked during critique, given that agent capabilities differ?
- Should the judge be a fixed third model, a rotating participant, a deterministic rubric, or a hybrid?
- How much of Disputatio's transcript/artifact format should code-council support for import/export?
- Is ACP sufficient for Codex and Claude interactive sessions, or do native adapters remain necessary for important capabilities?
- Which OpenHands APIs are stable enough to make the first execution backend?
- How robust is Graphify's changed-file update after large renames, generated
  code changes, and cross-language boundaries?
- What should happen when Codex and Claude agree but hidden tests fail?
- How should code-council re-engage agents after a `needs_input` response changes the task?
- When two parallel worktrees touch the same lines, should acceptance rebase and
  rerun verification automatically, or stop and require a new task?
- How often should accepted-change memory refreshes be coalesced when several
  tasks are accepted within minutes?
- What retrieval budget minimizes repeated tokens without hiding rare but
  critical invariants from propose and critique stages?

## Open research questions

- Does repo-memory compression preserve rare but critical invariants?
- Can retrieval utility be attributed causally when many memory items enter one prompt?
- How quickly does a confidence calibrator drift after model upgrades?
- How correlated are Codex and Claude failure modes by language and task class?
- Does adversarial critique produce safer patches or merely more conservative patches?
- Can a minority finding be scored reliably before ground truth is available?
- At what task complexity does council latency outweigh review savings?
- Can tests generated during debate become overfit to one proposed patch?
- How should cost and carbon/compute proxies enter strategy utility?
- What is the minimum benchmark size needed for safe repository-specific routing?

## Risks to monitor

- **Consensus theater:** multiple agents restate the same incorrect assumption.
- **Memory poisoning:** untrusted repository text becomes privileged instruction.
- **Staleness:** summaries survive after the code they describe changes.
- **Judge capture:** one provider systematically prefers its own style or outputs.
- **Benchmark gaming:** strategy improvements overfit visible tasks.
- **Cost creep:** every “uncertain” task expands to a full council.
- **Review displacement:** code volume grows faster than humans can validate it.
- **False precision:** a confidence percentage is displayed before it is calibrated.

## Decision log

- Use a local UI, loopback service, and pinned Agent Canvas backend.
- Keep native Codex and Claude adapters first-class.
- Let users choose Claude Code or Codex/GPT plus model and reasoning level for
  context generation; default to Claude Opus 4.8/high. Keep the agent read-only
  and restrict code-council's validated writes to `agent_context/`.
- Never silently substitute Fable or a moving model alias for an explicitly
  selected model.
- Run Graphify's code-AST `update --no-cluster` path as a deterministic local
  structural index and use scoped `query` results in task capsules. Do not treat
  the graph as semantic memory or use clustering/LLM output implicitly.
- Default to explicit manual routing. Keep auto routing as an opt-in mode that
  sends routine one-file work directly to Codex and uses Codex and Claude for
  planning on larger or riskier work.
- Use one Git worktree per task, require explicit patch acceptance, and refresh
  affected repository memory only after acceptance. Coalesce accepted changes
  into a pending refresh when a context job is already running.
- Fingerprint the effective source tree by path, mode, and Git blob identity,
  excluding `agent_context/`, so committing unchanged working-tree content does
  not falsely invalidate memory.
- Use Codex app-server rather than parsing a non-interactive CLI failure for
  approvals. This preserves the suspended turn and gives code-council the exact
  command, reason, working directory, and supported decisions.
- Persist repository connections, task configuration, process metadata, usage,
  and bounded output tails in the local state file. Browser refresh is recoverable;
  a full daemon restart still interrupts native child processes and records that
  interruption explicitly.
- Build a task-specific capsule from scoped Graphify output and ranked Markdown
  memory. Parse graph file/symbol hits into ranking signals, treat the
  configurable 4,000-token default as a ceiling rather than a fill target,
  cache identical fingerprinted queries, and fall back to graph-only retrieval
  before Markdown memory exists. Allow disabling it and supply it only where it
  adds new evidence. Record selected files, graph matches, context tokens,
  per-agent usage/cost/latency, and reported-versus-estimated provenance.
- Pin OpenHands Agent Canvas and Agent Server as the local runtime foundation.
- Prefer ACP as a generic protocol where capability coverage is sufficient.
- Store verdicts separately from deliverables.
- Make repo context token savings visible alongside outcome quality.
- Start adaptive routing with transparent rules and calibrate before learning a policy.
