# GitHub issue draft exercises

These are synthetic local fixtures, not reports about Nexa. Bodies use the repository templates in `.github/ISSUE_TEMPLATE/`, overriding the upstream bundled templates. Template frontmatter is omitted from composed bodies.

No issues were published or modified for these exercises. They validate draft content and preservation only; duplicate-safe publication, retries, and native issue relationships were not live-tested.

## Unreproduced bug

Input: A reporter says SSO intermittently leaves a blank tab after clicking sign-in. No SSO account is available to the investigator. No logs, deployment, OS, or browser versions are supplied. Synthetic configuration targets Node 24.x and Bun 1.x; neither runtime was observed.

Draft title: `SSO sign-in reportedly leaves an intermittent blank tab`

```markdown
## Description

SSO sign-in reportedly sometimes leaves a blank tab, preventing the reporter from continuing.

## Reported and observed behavior

- Reported behavior: An intermittent blank tab after selecting SSO sign-in.
- Independently verified observations: Not verified; the investigator has no SSO access.

## Reproduction

1. Open the login page (reported steps).
2. Select SSO sign-in; a blank tab reportedly appears intermittently.

- Status: Not attempted; no SSO account is available to the investigator.
- Attempts and results: No reproduction attempt was possible.
- Unknowns: Frequency, affected deployment, and whether sign-in completes despite the blank tab.

## Expected versus actual behavior

- Expected: Sign-in completes and the reporter can continue using the application.
- Actual: The reporter describes an intermittent blank tab; this remains unverified.

## Evidence

Reporter description only; no logs or screenshots supplied.

## Relevant environment

| Component | Observed value | Configured value (if relevant) |
| --- | --- | --- |
| Commit / deployment | Unknown | Unknown |
| OS | Unknown | Not applicable |
| Browser | Unknown | Not applicable |
| Node | Unknown | 24.x (synthetic fixture configuration) |
| Bun | Unknown | 1.x (synthetic fixture configuration) |
| Docker (if implicated) | Unknown; involvement not established | Unknown |
| Supabase (if implicated) | Unknown; involvement not established | Unknown |

## Related links

None supplied.
```

Check: The draft retains the report without asserting reproduction, a root cause, or observed runtime versions. Unavailable access does not suppress intake.

## Feature with supplied and unresolved decisions

Input: Export the currently filtered rows as CSV using the existing visible columns. JSON export is excluded. Export size limits and handling of text that spreadsheet programs may interpret as formulas have not been decided. No specification is supplied.

Draft title: `Export filtered rows and visible columns as CSV`

```markdown
## Problem and motivation

Users need a CSV copy of the rows selected by the current filters, with the columns they currently see.

## Proposed behavior

Provide CSV export of the currently filtered rows using the existing visible columns.

## Acceptance criteria

- [ ] Exported rows match the current filters.
- [ ] Exported columns match the existing visible columns.
- [ ] The export uses CSV format.

These supplied outcomes are retained; implementation is pending the decisions below.

## Constraints and scope exclusions

- Constraints: Reuse the current filters and visible column selection.
- Out of scope: JSON export.

## Unresolved decisions

- What row limit, if any, applies to an export, and what happens when it is exceeded?
- How should CSV escaping and spreadsheet formula interpretation be handled?

## Source and related links

None supplied; no source specification is available.
```

Check: The supplied format, filtering, columns, and exclusion survive intact. Open choices remain open; the draft does not imply the idea is ready to implement.

## Existing task update

Input: Read the following synthetic existing issue, then mark only “Document the setup command” complete. The supplied fixture evidence is an approved documentation diff adding that command. Do not change the second criterion, unrelated context, or metadata.

Existing metadata (preserved exactly; these are fixture values, not repository defaults):

```json
{"title":"Improve setup documentation","state":"open","labels":["documentation"],"assignees":["fixture-maintainer"],"milestone":7,"type":"Task"}
```

Existing body:

```markdown
## Objective

Make the setup documentation easier to follow.

## Context

The existing troubleshooting paragraph was reviewed separately and must remain.

Release coordination is handled by the maintainer; this task does not change it.

## Completion criteria

- [ ] Document the setup command.
- [ ] Validate the instructions on a clean checkout.

## Constraints and scope exclusions

- Constraints: Preserve the existing troubleshooting guidance.
- Out of scope: Changes to the setup script.

## Dependencies

None known.

## Source and related links

None supplied.
```

Proposed body update, with all other body text and metadata unchanged:

```diff
 ## Completion criteria

-- [ ] Document the setup command.
+- [x] Document the setup command.
 - [ ] Validate the instructions on a clean checkout.
```

Check: Only the requested checkbox changes. Both unrelated context paragraphs, the remaining checklist item, constraints, and metadata are preserved. The task remains open because validation is still pending. This is a local before/after exercise, not evidence of a live GitHub update.
