# code-council competitive analysis

Research date: 2026-07-19

## Executive summary

The market is split into two mostly separate categories:

1. **Coding-agent control planes** such as Conductor, OpenHands, Brat, Miko, and AgentCMD coordinate execution, worktrees, tools, and review.
2. **Model councils** such as Perplexity Model Council, Karpathy's LLM Council, Council Engine, and Joint Chiefs coordinate independent answers, critique, and synthesis.

The strongest products in the first category do not make deliberation quality a first-class, measurable protocol. The strongest products in the second category do not close the loop through repository execution, tests, pull-request review, and durable codebase learning. code-council should occupy that intersection.

The durable differentiation is not “more agents.” It is a measurable control loop:

> repository evidence → independent proposals → adversarial critique → revised patches → executable judgment → calibrated confidence → selective escalation → human feedback → updated memory

code-council should treat model agreement as weak evidence. Test results, static checks, reproducible patches, and human review are stronger evidence. This follows the core lesson of test-driven debate and avoids confusing fluent consensus with correctness.

## Method

This review prioritizes project-owned documentation, source repositories, and primary papers. Fast-moving projects are described as they existed on the research date. Marketing claims are treated as claims unless an independent benchmark or reproducible artifact supports them.

## Competitive landscape

### Conductor (Melty Labs)

[Conductor](https://www.conductor.build/) is a native Mac application for running Claude Code, Codex, and Cursor in parallel. It creates a git worktree per workspace, keeps execution local, and centers the experience on dispatch, attention management, diff review, and merging.

**Pros**

- Excellent mental model: one isolated workspace per task.
- Strong human control surface for supervising many concurrent agents.
- Reuses users' existing agent authentication and subscriptions.
- Review and merge are visible product concepts rather than hidden orchestration steps.

**Cons**

- Mac-first and closed-source.
- Parallel execution is the central abstraction; structured deliberation is not.
- No public evidence of outcome-calibrated escalation or a benchmark feedback loop.
- Repository understanding is largely session/task context rather than a durable, inspectable memory model.

**Gap code-council can exploit**

Keep the workspace clarity, but make “why this result should be trusted” as visible as “what this agent is doing.”

### OpenHands

[OpenHands](https://github.com/OpenHands/OpenHands) is the broadest platform in this set: an open agent, an Agent Server, an Agent Canvas, integrations, automations, sandboxed execution, and support for third-party agents through ACP. Its [runtime architecture](https://docs.openhands.dev/openhands/usage/architecture/runtime) isolates arbitrary code execution in containers. Its evaluation work includes an [open benchmark harness](https://github.com/OpenHands/benchmarks) with container-per-instance parallelism.

**Pros**

- Mature, large open-source ecosystem.
- Clear separation between UI, agent server, runtime, and automation services.
- Sandboxing is a foundational architectural concern.
- Supports local, remote, and cloud backends.
- Serious evaluation infrastructure rather than demo-only metrics.

**Cons**

- Broad surface area and operational complexity.
- The default product abstraction is an agent conversation or automation, not a configurable council protocol.
- Repository memory, deliberation traces, evaluation, and human feedback are not presented as one unified learning system.
- A large platform can make it harder to compare small protocol changes cleanly.

**Gap code-council can exploit**

Be narrower and evaluation-first. code-council can integrate OpenHands as an execution adapter rather than competing with its runtime breadth.

### Brat

[Brat](https://github.com/neul-labs/brat) is a multi-agent harness for Claude Code, Aider, Codex, Continue, Gemini, OpenCode, and GitHub Copilot. It uses an append-only event log and explicit roles: Mayor, Convoy, Task, Witness, Refinery, and Deacon. The design emphasizes crash recovery, leases, isolated actor directories, monitoring, and a merge queue.

**Pros**

- Durable, auditable coordination through an append-only log.
- Explicit failure recovery for long-running multi-agent work.
- Agent-provider neutrality.
- Merge/CI integration is part of the orchestration model.

**Cons**

- Very early project with limited evidence of production adoption.
- Optimizes task throughput and crash safety more than answer quality.
- Role vocabulary is memorable but adds conceptual load.
- No visible calibrated confidence model, longitudinal evaluation, or semantic repo memory.

**Gap code-council can exploit**

Adopt event-sourced run traces and recovery semantics, but use a smaller protocol vocabulary and connect every event to evaluation evidence.

### Continue

[Continue](https://docs.continue.dev/) is an open-source coding agent spanning CLI, VS Code, and JetBrains. Its current codebase-awareness guidance favors agent file/search/git tools plus hierarchical repository rules; its older index combined embeddings and keyword search and stored the local index in SQLite ([documentation](https://docs.continue.dev/guides/codebase-documentation-awareness)).

**Pros**

- Strong editor distribution and developer ergonomics.
- Model/provider flexibility and reusable configuration.
- Rules give teams a repository-native way to encode conventions.
- Integrates naturally into an individual developer's flow.

**Cons**

- Primarily an agent surface, not a multi-agent quality control plane.
- Rules can become stale and are mostly authored rather than learned from outcomes.
- No native propose–critique–revise–judge protocol with cross-model audit.
- Team-level benchmark and review analytics are not the core product.

**Gap code-council can exploit**

Generate evidence-linked memory incrementally, then export stable conclusions into tools such as Continue rules instead of making rules the source of truth.

### Aider

[Aider](https://github.com/Aider-AI/aider) is a terminal pair-programming tool with broad model support, automatic git integration, lint/test repair loops, and a compact repository map. Its repo map uses tree-sitter definitions and references to rank important identifiers ([design note](https://aider.chat/2023/10/22/repomap.html)). Its [benchmark harness](https://github.com/Aider-AI/aider/blob/main/benchmark/README.md) records pass rates, malformed edits, time, and cost against a public polyglot suite.

**Pros**

- Precise, git-native edit loop with excellent developer control.
- A compact structural map is a pragmatic answer to repository-scale context.
- Public, reproducible benchmark culture.
- Architect/editor separation shows that models can be assigned according to strengths.

**Cons**

- Primarily one human–agent session rather than a council control plane.
- Repo maps are context compression, not durable organizational memory.
- Benchmark outcomes are not automatically joined to real pull-request review feedback.
- Multi-model use is role chaining, not a general deliberation protocol.

**Gap code-council can exploit**

Borrow structural mapping, deterministic edit evidence, and benchmark rigor; add longitudinal memory and council-level attribution.

### Graphify

[Graphify](https://github.com/Graphify-Labs/graphify) is an MIT-licensed,
local-first code and document knowledge-graph builder. For code it uses
tree-sitter rather than an LLM, resolves cross-file calls, imports, inheritance,
and related edges across a broad language set, and labels relationships as
extracted, inferred, or ambiguous. Optional clustering/summarization is a
separate mode and may use an LLM. It
supports scoped query/path/explain operations, changed-file updates, Git hooks,
portable manifests, and MCP access.

**Pros**

- Deterministic, local AST extraction makes it a better ground-truth substrate
  than model-authored function discovery.
- Typed edges and source locations are directly useful for change-impact
  analysis and task-context retrieval.
- Changed-file extraction and a portable manifest align with incremental repo
  memory.
- No embeddings or external graph database are required.
- Works with both Codex and Claude Code and has a permissive license.

**Cons**

- A structural graph does not by itself capture business invariants, review
  conventions, failed approaches, or why a decision was made.
- Large raw graphs are not automatically good prompts; task-scoped retrieval and
  compression remain necessary.
- Project-reported benchmark results need independent reproduction on coding
  tasks and real repositories.
- Output files can invalidate an agent's prompt cache if not isolated or ignored.
- Fast releases increase adapter compatibility and supply-chain maintenance.

**Gap code-council can exploit**

Use Graphify's deterministic code-AST path as the structural index and
impact-query substrate, then add evidence-linked model summaries, task outcomes,
human feedback, token-budgeted retrieval, and causal evaluation. code-council should
invoke `update --no-cluster` and scoped `query` through a version-checked
subprocess rather than fork its parser stack.

### Miko

[Miko](https://github.com/Sarp2/miko) is a local-first web UI for Claude Code and Codex. It provides isolated git workspaces, persistent transcripts, diffs, checks, comments, terminals, PR awareness, an event store, read models, and a typed WebSocket protocol.

**Pros**

- Strong modern browser UI for local agent operations.
- Event-sourced persistence and typed protocol are good foundations.
- Pull requests, checks, files, and chat remain visible in one workspace.
- Worktree isolation and terminal restoration support long-lived tasks.

**Cons**

- Early, pre-1.0 project.
- Local operation and installed CLIs define the deployment model.
- No structured council protocol, calibrated escalation, or benchmark lab.
- Persistence captures history, but does not yet constitute learned repo memory.

**Gap code-council can exploit**

Match its review ergonomics while making disagreement, evidence, confidence, and evaluation first-class UI objects.

### AgentCMD

[AgentCMD](https://agentcmd.dev/docs) describes itself as “GitHub Actions for AI agents.” It combines a web application with a TypeScript workflow SDK, typed phases and steps, worktree setup, resumable agent sessions, CLI steps, artifacts, and PR finalization.

**Pros**

- Workflows are explicit, versionable TypeScript.
- Strong support for spec-driven, multi-step development.
- Resumability, artifacts, and live monitoring fit production automation.
- Agent and CLI steps can be composed in the same workflow.

**Cons**

- Workflow authoring is relatively infrastructure-heavy.
- Fixed phase graphs are better at repeatability than adaptive deliberation.
- Confidence and quality gates are user-defined workflow concerns, not a learned platform service.
- No visible longitudinal comparison of strategies by task class.

**Gap code-council can exploit**

Offer protocol presets in a simple UI, then expose the same protocol as code for advanced teams. Adapt the graph at runtime using calibrated evidence.

### Disputatio

[Disputatio](https://github.com/marcomd/disputatio) is the closest direct reference for code-council's deliberation layer. It runs real Codex, Claude Code, and other agent CLIs rather than reconstructing them as API-only agents. Participants propose independently in isolated temporary directories or detached worktrees, react adversarially, and optionally pass the transcript to a judge that can resolve the debate or return `NEEDS_INPUT`. The final deliverable is kept separate from the verdict.

**Pros**

- Preserves the native harness, tools, authentication, memory, and executable environment of each coding agent.
- Uses isolated worktrees and read-only adapter defenses to reduce interference.
- Treats tests and executed evidence as stronger than rhetorical objections.
- The adapter is a small anti-corruption boundary around each CLI's flags and output format.
- Honest documentation explicitly states that the core multi-agent quality premise is not yet validated.

**Cons**

- Experimental MVP; crashed runs are not resumable.
- Evidence worktrees see committed `HEAD`, so uncommitted changes and some build artifacts are absent.
- Reaction rounds are parallel snapshots rather than a fully causal debate graph.
- No persistent repository context layer, token-savings measurement, benchmark dashboard, or learned escalation policy.
- A judge-only continuation cannot re-engage participants when new human input changes the problem.

**Gap code-council can exploit**

Use Disputatio's native-CLI adapter and evidence hierarchy as the protocol baseline, then add crash-safe event persistence, incremental repo context packs, causal revisions, benchmark replay, and calibrated escalation. Keep “verdict” and “deliverable” separate in both storage and UI.

### Operon

[Operon](https://github.com/qasimio/Operon) is an alpha terminal agent organized as a planner–coder–reviewer state machine. It includes a vector-based semantic memory, strict search/replace edits, syntax validation, human approval before writes, and a tool jail.

**Pros**

- Human approval is embedded at the risky mutation boundary.
- Planner, coder, and reviewer roles have clear responsibilities.
- Semantic search and surgical edit formats are practical codebase tools.
- Tool authorization is explicitly constrained.

**Cons**

- Alpha-stage implementation and a small community.
- Memory is oriented toward retrieval, with limited visible provenance, invalidation, or outcome learning.
- The review role can remain correlated with the coder if model/provider diversity is not enforced.
- No broad benchmark dashboard or GitHub feedback ingestion.

**Gap code-council can exploit**

Turn semantic memory into a versioned evidence graph: every memory item should record its source commit, confidence, supersession, and observed effect on outcomes.

### Perplexity Model Council

[Perplexity Model Council](https://www.perplexity.ai/hub/blog/introducing-model-council) runs a question through three models in parallel and uses a synthesizer to resolve conflicts while showing agreement and disagreement.

**Pros**

- Very clear end-user explanation of multi-model value.
- Disagreement is surfaced as useful uncertainty.
- Low configuration burden.
- Demonstrates that a council can be a product mode, not an expert-only workflow.

**Cons**

- Closed, subscription-gated, and research-oriented rather than code-execution-oriented.
- Fixed fan-out makes every query pay multi-model cost.
- No repository context, patch execution, or developer feedback loop.
- Synthesis remains a model judgment without a deterministic coding oracle.

**Gap code-council can exploit**

Preserve the simple agreement/disagreement experience, but start with one cost-effective path and fan out only when measured confidence is low.

### Karpathy's LLM Council

[LLM Council](https://github.com/karpathy/llm-council) is a deliberately small local web application. It gathers first opinions, anonymously asks models to review and rank peer responses, and gives all responses and reviews to a chairman model for the final answer.

**Pros**

- Simple, legible three-stage protocol.
- Anonymization reduces explicit provider favoritism.
- Users can inspect individual answers and peer rankings.
- The small codebase is easy to understand and modify.

**Cons**

- The author explicitly describes it as an unsupported exploratory hack.
- JSON-file storage and a single OpenRouter path limit production use.
- Ranking and chairman synthesis are not grounded in code execution.
- No adaptive cost policy, persistent repo memory, or outcome analytics.

**Gap code-council can exploit**

Keep the inspectability and small conceptual core; replace generic ranking with rubric- and evidence-based structured outputs.

### Language Model Council

The research-oriented [Language Model Council](https://github.com/llm-council/llm-council) evaluates models democratically on subjective tasks and publishes the artifacts used in the associated paper. It is especially relevant to judge diversity and the politics of choosing a single evaluator.

**Pros**

- Treats evaluation governance as a first-class research question.
- Supports reproducible analysis across many models.
- Makes dissent and evaluator identity empirically inspectable.

**Cons**

- Designed for model evaluation, not repository work.
- Subjective-task democracy does not directly establish patch correctness.
- Large councils can amplify cost and correlated biases.

**Gap code-council can exploit**

Use multiple judges for calibration studies and periodic benchmark audits, not by default on every coding task.

### Council Engine

[Council Engine](https://councilengine.dev/) implements bounded deliberation across diverse models with explicit proposals and critique, an event bus, persistent SQLite audit trails, mediated file operations, and local workspace integration.

**Pros**

- Deliberation is a protocol rather than a prompt convention.
- Auditability and bounded execution are architectural requirements.
- Events are decoupled from terminal or board rendering.
- Sandboxed, mediated file access avoids ambient model authority.

**Cons**

- General decision engine rather than an end-to-end GitHub coding platform.
- No visible benchmark lab joining tests, cost, latency, and human review.
- No incremental repository memory lifecycle.
- The name directly overlaps with code-council, creating discoverability risk.

**Gap code-council can exploit**

Differentiate as the GitHub-connected evaluation control plane. Consider “code-council” as a descriptive tagline and keep protocol compatibility possible.

### Joint Chiefs

[Joint Chiefs](https://jointchiefs.ai/) is a focused multi-model code-review engine exposed through MCP, CLI, and a macOS setup application. It performs independent reviews, anonymized debate, adaptive early stopping, and judge arbitration.

**Pros**

- Excellent protocol focus for code review.
- Anonymized findings and mandatory position-taking improve auditability.
- Adaptive early break avoids unnecessary rounds after convergence.
- MCP and CLI surfaces make integration easy.

**Cons**

- Review is the main task; patch generation, execution, and repo learning are secondary.
- Model consensus can still be wrong without tests or other executable evidence.
- Local/macOS setup narrows the operational model.
- No longitudinal benchmark or human-review learning surface.

**Gap code-council can exploit**

Generalize beyond review while retaining finding-level debate. Require critiques to attach tests, file references, or reproducible evidence.

### DebateCoder

There are two relevant projects with the same name:

- The ACL 2025 paper [“DebateCoder: Towards Collective Intelligence of LLMs via Test Case Driven LLM Debate for Code Generation”](https://aclanthology.org/2025.acl-long.589/) uses opposing test generation, execution results, contrastive analysis, and test-based convergence.
- The 2026 preprint [“Adaptive Confidence Gating in Multi-Agent Collaboration for Efficient and Optimized Code Generation”](https://arxiv.org/abs/2601.21469) describes a user/technical/QA protocol with a 95% confidence gate and reports reduced API overhead on HumanEval and MBPP.

**Pros**

- Tests become debate artifacts and convergence evidence.
- The protocol joins pre-generation reasoning with post-generation debugging.
- Adaptive gating directly addresses quality–cost tradeoffs.

**Cons**

- Benchmark programming problems are narrower than repository-level engineering.
- A fixed confidence threshold is unlikely to transfer across repos, languages, and task classes without calibration.
- Paper results do not establish production orchestration, security, or UI quality.
- Self-reported confidence remains dangerous unless calibrated against held-out outcomes.

**Gap code-council can exploit**

Make confidence a calibrated prediction trained from repository outcomes, not a raw model claim. Use tests as the highest-weight evidence and measure expected calibration error by task class.

## Research evidence that should shape code-council

### Debate can help, but extra rounds are not automatically useful

[Du et al.](https://arxiv.org/abs/2305.14325) report gains in reasoning and factual validity from multi-agent debate. [Liang et al.](https://arxiv.org/abs/2305.19118) identify degeneration-of-thought in self-reflection and find adaptive stopping and a modest adversarial stance important. They also warn that heterogeneous models may not judge one another fairly.

**Design consequence:** collect proposals independently, anonymize peer critique where useful, limit rounds, and stop when new evidence—not just wording—has converged.

### Diversity matters more than agent count

[Yang et al.](https://arxiv.org/abs/2602.03794) report strong diminishing returns for homogeneous agents and argue that heterogeneous models, prompts, or tools provide complementary information channels.

**Design consequence:** escalate to a different provider family, tool set, or role—not merely another sample from the same setup.

### Code debate needs executable evidence

[DebateCoder (ACL 2025)](https://aclanthology.org/2025.acl-long.589/) argues that same-model debate, underused tests, and third-party moderator errors limit code councils. Tests serve as adversarial evidence and convergence criteria.

**Design consequence:** critiques should be able to add or challenge tests. A judge must see test output, static analysis, patch scope, and unresolved claims separately from prose.

### Model judges are biased

[Shi et al.](https://arxiv.org/abs/2406.07791) find systematic position bias across LLM judges.

**Design consequence:** randomize candidate order, run swap checks on close decisions, separate deterministic from model-judged scores, and record the judge identity and prompt version.

### Confidence must be calibrated

[Kadavath et al.](https://arxiv.org/abs/2207.05221) show that models can sometimes self-evaluate, but calibration does not generalize uniformly. [DebateCoder's adaptive gating preprint](https://arxiv.org/abs/2601.21469) demonstrates the efficiency opportunity.

**Design consequence:** learn a post-hoc calibrator from code-council's own outcomes. Report reliability diagrams and expected calibration error. Never treat a model's “95%” as a portable probability.

### Cascades can improve the cost-quality frontier

[FrugalGPT](https://arxiv.org/abs/2305.05176) formalizes prompt adaptation, approximation, and LLM cascades and reports large potential savings in its evaluated settings.

**Design consequence:** begin with the cheapest strategy predicted to meet the task's quality target, then escalate only when the estimated value of information exceeds expected cost and latency.

### Repository-level evaluation must be reproducible

[SWE-bench](https://arxiv.org/abs/2310.06770) frames coding evaluation as resolving real GitHub issues inside full repositories. Aider's harness records pass rates, failures, time, cost, version, and commit hash. OpenHands runs benchmark instances in isolated containers.

**Design consequence:** every benchmark result needs an immutable task revision, environment image, repository SHA, strategy version, model versions, trace, patch, test logs, cost, and latency.

## Unmet needs

1. **Persistent memory with a lifecycle.** Existing tools index, summarize, or store transcripts, but rarely make memory provenance, invalidation, supersession, and outcome contribution inspectable.
2. **One schema across models and agents.** Provider responses, CLI agents, hosted agents, and local models need a common capability and event contract.
3. **Evidence-weighted judgment.** Tests, static checks, reproducible traces, and human review must outrank eloquent model consensus.
4. **Calibrated adaptive escalation.** Most councils fan out immediately; most agent workflows pick a fixed model. The missing layer predicts when diversity is worth paying for.
5. **Human feedback as evaluation data.** PR review comments, requested changes, approval, revert rate, and post-merge incidents should update strategy selection.
6. **Protocol-level benchmarking.** Teams need to compare “single agent,” “architect/editor,” “two-model critique,” and “full council” on the same tasks.
7. **Clear uncertainty UX.** Users need agreement, dissent, missing evidence, and the reason for escalation—not an opaque score.
8. **Safe memory ingestion.** Repository text can contain prompt injection. Memory generation must separate untrusted content from policy and require provenance.

## Recommended position

code-council should be the open evaluation and deliberation layer above coding agents, not another monolithic coding agent.

Its initial promise:

> Connect a repository and the agents you already use. code-council builds an evidence-linked memory of the codebase, runs the least expensive strategy likely to succeed, and escalates to a diverse council only when confidence is low.

Its moat should be the accumulated relationship between:

- task and repository characteristics;
- memory retrieved;
- agents, models, prompts, and tools used;
- proposals, critiques, revisions, and judgments;
- tests and static checks;
- cost and latency;
- human review and post-merge outcomes.

That dataset allows code-council to improve routing and confidence calibration without locking users into a single model provider.
