# Database CI validation

The `CI validation` aggregate requires Supabase validation when database work is
applicable. An unrelated dependency update can skip the database job without
skipping application validation or the security audit.

## Scope

Database validation runs for any change under `supabase/`, `scripts/database/`,
the CI scope implementation/tests, Bun configuration, mise tool configuration or
lockfile, `Taskfile.yml`, or the CI/database workflows.

For `package.json` and `bun.lock`, scope compares the actual before/after
snapshots. Changes to `supabase`, `@supabase/*`, or their resolved dependencies
(including optional native CLI packages and installed peers) require validation.
Nested Bun resolutions are followed under their parent. The union of both
versions' dependency graphs catches additions, removals, and shared dependencies.
Unrelated dependency declarations, resolutions, and overrides do not require it.

Other manifest or installation configuration changes remain conservative:
scripts, toolchain declarations, install trust, workspace configuration, lockfile
format changes, unsupported overrides, and missing/unreadable snapshots require
validation. Missing Git diff evidence fails scope rather than skipping checks.
Manual runs and initial pushes without a comparison base require validation.
PR comparisons use the merge base and validate the tested synthetic merge head.

## Startup and tests

Hosted runners start only Supabase Postgres with `supabase db start`. Fresh
startup applies migrations and seeds, so the subsequent reset is unnecessary.
Lint warnings fail validation, and committed `.sql` and `.pg` pgTAP tests run
when present. With no pgTAP files, a successful check does not establish
application database behavior.

CI does not call `task db:start` or write application `.env.local` settings.
Developer `task db:start` and `task dev` still start the full stack. Tests that
exercise Auth, Storage, or other service APIs need that fuller stack.

Run `mise exec -- task db:smoke` to verify startup in a disposable project with
its own ID and database port 56422. It creates a migration through the pinned
CLI, seeds a private fixture schema, checks a SQL query, lints its PL/pgSQL
function, runs pgTAP, and checks that intentional lint and pgTAP failures return
nonzero exit codes. It also asserts that only Postgres is running. Only the disposable project's containers and volumes
are removed. The port must be free, and Docker must be running.

The Database workflow also offers an optional `smoke` input for a manual hosted
run. Routine checks do not pay for a second fixture database.

## Timing evidence

The [baseline run](https://github.com/lmiguelvargasf/nexa/actions/runs/37250836140/job/111577969761)
took 3m 06s: full startup 92s, reset 26s, lint 1s, and stop 18s. This is one
hosted measurement; image downloads and runner setup vary. Compare step timings
on the implementation PR rather than treating this as a guaranteed speedup.
