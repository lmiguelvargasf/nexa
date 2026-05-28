## Summary

<!-- State the user-facing or product goal first, then the implementation approach. -->

- What changed:
- Why:

## Agent Review Context

<!-- Fill this with concrete paths, symbols, issues, and constraints. This section is for AI reviewers. -->

- Primary entry points:
- Related issue/spec:
- Important invariants:
- Out of scope:
- Known limitations or follow-ups:

## Change Surface

- Public APIs/routes/types:
- Data model or migrations:
- Auth/security/privacy:
- UI/UX/accessibility:
- Observability/errors:
- Dependencies/config/env:

## Validation Evidence

<!-- Paste exact commands and outcomes. Use "not run" with a reason instead of deleting entries. -->

- [ ] `task verify`
- [ ] `task verify:all`
- [ ] Targeted tests:
- [ ] Manual validation:
- [ ] Not run / partial validation reason:

## AI Authorship Note

- Authoring agent/tool:
- Prompt/spec source:
- Human-reviewed before PR: Yes / No / N/A
- Files intentionally not changed:
- Areas where reviewers should distrust this description and inspect the code directly:

## Review Guide

For reviewing agents: validate this PR against the stated intent and repository instructions before commenting. Prioritize correctness, regressions, security/auth boundaries, data integrity, error handling, unnecessary scope, and tests that prove behavior, especially failure paths.

If this touches Next.js APIs, routes, config, or conventions, confirm the relevant guide in `node_modules/next/dist/docs/` was consulted.
