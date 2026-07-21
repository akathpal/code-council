# Public alpha release checklist

## Required before tagging

- [ ] Replace any private repository examples, screenshots, paths, prompts, and
      persisted state with synthetic examples.
- [ ] Confirm every dependency license is compatible with MIT distribution.
- [ ] Run `npm ci`, `npm run lint`, and `npm test` on Node 22.
- [ ] Run a clean-machine smoke test: connect a disposable repository, build
      context, run chat, run a direct code task, review/reject it, run a council
      task, and verify failed-stage retry.
- [ ] Verify Graphify-absent behavior and both Codex/Claude unauthenticated
      onboarding paths.
- [ ] Confirm ports 3000, 4781, and 8001 bind only as documented and the
      loopback API rejects untrusted origins.
- [ ] Review `SECURITY.md` contact details and enable GitHub private
      vulnerability reporting.
- [ ] Enable branch protection requiring the CI workflow.
- [ ] Create a `v0.1.0-alpha.1` GitHub release with the changelog and known
      limitations.

## Recommended in the first week

- [ ] Add a sanitized demo repository and scripted smoke task.
- [ ] Publish an architecture diagram and short demo video.
- [ ] Add CodeQL and dependency update automation after reviewing alert volume.
- [ ] Define maintainer/reviewer ownership as contributors join.
- [ ] Add a benchmark fixture that compares context on/off under fixed task,
      model, reasoning, base SHA, and capsule budgets.

## Known alpha limitations to disclose

- A loopback-service restart marks active native processes interrupted; it
  cannot reattach them.
- Token fields are estimated when a CLI does not expose structured usage.
- Context savings are instrumented but not yet established by a published
  controlled benchmark.
- Adaptive routing is rule-based; calibrated confidence and learned escalation
  are roadmap work.
- OpenHands is launched as the pinned runtime foundation, while the current
  Codex and Claude adapters still run through code-council's native local boundary.
