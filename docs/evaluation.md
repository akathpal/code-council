# Evaluation and adaptive strategy

code-council is only useful if teams can determine whether a council beats a single agent for their work. Evaluation is therefore a product workflow, not a leaderboard page added later.

## Current instrumentation versus roadmap

The alpha includes Council Replay, an interactive local comparison runner for
two to four variants. It holds the task and base repository fingerprint
constant, gives each variant an isolated worktree, and compares status, calls,
tokens, context tokens, duration, cost, changed files, checks, and patches.
Replay results use the same human review gate as ordinary coding tasks.

The alpha records task strategy, models, reasoning, context policy, capsule
budget and selected paths, Graphify status, per-call agent/stage/duration/cost,
and reported-or-estimated token fields. It also persists accept, reject, and
request-changes outcomes. These records make local A/B replay possible.

Each task capsule also records Graphify operation type and input, matched paths
and symbols, cache state, executed-process count, retrieval latency, an
interpretable confidence score, whether one bounded follow-up was triggered,
and the token contribution of every selected memory document. The UI exposes
this as **Context used**, so a benchmark result can be traced back to the exact
retrieval decision rather than only its final prompt size.

The alpha does **not** yet ship a batch benchmark suite, hidden-test harness,
confidence calibrator, learned router, or aggregate dashboard. Council Replay
is a hands-on A/B workflow, not an automated quality benchmark. The metric and
policy sections below define the evaluation contract for those next releases;
they are not claims about current production behavior.

## Unit of evaluation

An evaluation case contains:

- immutable repository and base SHA;
- task text, labels, and acceptance criteria;
- environment image and setup revision;
- strategy and protocol version;
- agent, model, effort, and prompt versions;
- context-pack revision;
- complete run trace and patch;
- deterministic evidence;
- cost and latency;
- human review and post-merge outcomes.

## Outcome hierarchy

Evidence is ordered from strongest to weakest:

1. post-merge production outcome or revert;
2. human approval and requested changes;
3. hidden acceptance tests;
4. repository tests, static analysis, and security checks;
5. patch applicability and scope checks;
6. judge rubric;
7. agent agreement and self-reported confidence.

code-council reports layers separately and does not collapse them into one opaque quality number.

## Core metrics

### Quality

- **Task success rate:** cases meeting all acceptance criteria.
- **Pass@1:** cases passing on the first completed run.
- **Test pass rate:** passed tests divided by executed tests.
- **Patch apply rate:** patches that apply cleanly to the immutable base.
- **Human approval rate:** runs approved without requested changes.
- **Review comment density:** actionable comments per 100 changed lines.
- **Severity-weighted review debt:** `critical × 8 + high × 4 + medium × 2 + low`.
- **Rework rate:** accepted runs requiring another agent or human repair.
- **Revert/incident rate:** post-merge negative outcomes.

### Efficiency

- total and successful-run cost;
- p50 and p95 latency;
- input, output, cached, and context-generation tokens;
- context tokens saved versus baseline;
- cost per successful task;
- latency to first useful evidence;
- escalation frequency and marginal escalation value.

### Reliability

- repeated-run consistency;
- success by repository, language, task class, and risk tier;
- expected calibration error and Brier score;
- false-stop rate: high-confidence failures;
- false-escalation rate: expensive councils that did not improve the outcome.

### Human experience

- time to first review;
- time to merge;
- developer override rate;
- `needs_input` resolution time;
- accepted minority-warning rate;
- qualitative review-comment themes.

## Benchmark suites

code-council supports three levels:

1. **Smoke pack:** fast, deterministic repository tasks for every pull request.
2. **Repo replay:** sampled historical issues/PRs with hidden acceptance checks.
3. **External packs:** SWE-bench-style and polyglot tasks for ecosystem comparison.

Each task should run under at least these strategies:

- Codex only;
- Claude only;
- lean Claude propose → Codex critique → Claude revise → Codex execute;
- full propose–critique–revise–judge plan, Codex execute;
- optional OpenHands execution backend.

The comparison holds model versions, repository base, environment, and task prompt constant where possible.

Repository-memory ablations should compare:

- context disabled (agent search/source inspection only);
- ranked Markdown memory without Graphify;
- Graphify-only retrieval before generated Markdown exists;
- Graphify query plus ranked Markdown at 1k, 4k, 8k, and 16k capsule budgets;
- the legacy baseline that repeats the same full pack at every council stage.

The main comparison is successful-task tokens and review outcome, not prompt
size alone. Hold the task, base SHA, model versions, reasoning, and stochastic
settings constant; use separate worktrees and randomized run order. This
establishes whether upfront synthesis and scoped retrieval earn their cost.
Record Graphify node/path hits, selected-document precision, actual capsule
tokens versus the configured ceiling, query cache hits, and source files the
agent still had to open.

For adaptive-retrieval ablations, additionally record initial confidence,
follow-up operation, confidence after retrieval, follow-up success, added paths,
latency, tokens, and task outcome. A follow-up is valuable only when its
quality/review improvement exceeds its token and latency cost.

## Confidence model

The initial release uses an interpretable score followed by post-hoc calibration.

```text
raw confidence =
  0.35 deterministic evidence
  0.20 structured proposal agreement
  0.15 judge stability
  0.15 historical strategy success
  0.10 memory coverage and freshness
  0.05 patch-scope prior
```

Hard failures cap confidence:

- failing required test: at most 0.35;
- patch does not apply: at most 0.20;
- unresolved critical dissent: at most 0.45;
- missing executable evidence for high-risk tasks: at most 0.55.

The raw score is calibrated per task class using held-out outcomes. code-council reports the calibrated probability and its evidence, not the raw score.

## Escalation policy

Escalate when any of these is true:

- calibrated success probability is below the configured target;
- the uncertainty interval crosses the target;
- a high-severity critique remains unresolved;
- deterministic evidence is missing or contradictory;
- memory coverage is too low or stale;
- the task touches security, permissions, payments, migrations, or public APIs;
- the expected value of more information exceeds predicted cost and latency.

Escalation adds a complementary channel in this order:

1. Claude peer planning/critique when the initial Codex route is uncertain;
2. different tool or test-generation role;
3. stronger judge or extra model;
4. human input.

Do not add homogeneous samples merely to increase vote count.

## Adaptive learning

The rollout has three safe phases:

1. **Rules:** transparent thresholds and risk policies.
2. **Calibrated router:** logistic or isotonic calibration over observed outcomes.
3. **Contextual policy:** choose among eligible strategies using repository/task features and a conservative contextual bandit.

The policy optimizes expected successful-task utility:

```text
utility = P(success) × task_value
          - predicted_cost
          - latency_penalty
          - review_burden
          - risk_penalty
```

Exploration is bounded by a per-repository budget and excluded for critical production tasks unless explicitly enabled.

## Judge controls

- randomize proposal order;
- run order-swap checks on close calls;
- require a structured rubric and evidence citations;
- separate judge score from deterministic evidence;
- record judge identity, prompt, and model version;
- periodically compare judge decisions with human reviewers;
- audit performance by originating agent to detect favoritism.

## Dashboard interpretation

The default dashboard emphasizes:

- success and test pass before cost;
- confidence calibration before average self-confidence;
- human comments and rework before model agreement;
- cost per success before cost per run;
- task-class slices before global averages.

Every chart must support drilling into the underlying task, patch, trace, and evidence.
