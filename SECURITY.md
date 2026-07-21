# Security policy

## Supported versions

code-council is pre-1.0. Security fixes are applied to the latest `main` branch.

## Reporting a vulnerability

Do not open a public issue for credential exposure, command execution,
path-traversal, sandbox escape, cross-origin access, or patch-application
vulnerabilities. Use the repository's private vulnerability-reporting flow
under **Security → Advisories → Report a vulnerability** and include:

- affected revision and environment;
- reproduction steps or a proof of concept;
- expected impact;
- any suggested mitigation.

Please allow 72 hours for an initial response. We will coordinate disclosure
and credit unless anonymity is requested.

## Trust boundary

code-council runs local agent CLIs and can execute commands in isolated Git
worktrees. It binds its companion API to loopback, validates repository paths,
and requires user review before applying patches, but it is alpha software.
Review commands and diffs, use repositories without unrelated secrets, and do
not expose ports 3000, 4781, or 8001 to untrusted networks.

code-council does not collect telemetry. Model prompts and code may still leave the
machine through whichever Codex or Claude account/provider the user has
configured.
