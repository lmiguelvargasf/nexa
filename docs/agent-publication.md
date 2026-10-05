# Agent pull request publication

Template-derived projects default to their own authenticated Git/`gh` account.
They inherit tooling and instructions, not the owner's private Brikosi App or
credentials. Application setup does not require an App. A GitHub App publisher is
an optional, explicit choice; canonical `lmiguelvargasf/nexa` requires Briko.

## Select a publication mode

Run `mise exec -- task agents:publication` from the checkout. This prints JSON
containing the mode and repository derived from origin. It does not read App
credentials, push commits or create PRs. It rejects conflicting/multiple origin
destinations, invalid selections and incomplete App paths. This is a policy
inspection command; follow the selected publication flow below afterward.

Selection lives in this clone's local Git configuration, outside tracked files.
Global and included Git settings are ignored. A new template-derived clone has
no selection and uses `github`; an explicit ordinary selection is:

```bash
git config --local nexa.publication.mode github
```

For App publication, first provision the protected files below, then set all four
settings. Replace the example repository and absolute paths with this project's
verified destination and your protected paths:

```bash
git config --local nexa.publication.mode app
git config --local nexa.publication.repository OWNER/REPO
git config --local nexa.publication.publisherPath /absolute/protected/path/publish.mjs
git config --local nexa.publication.configPath /absolute/protected/path/config.json
mise exec -- task agents:publication
```

The repository pin prevents accidentally retaining an App selection after
repointing origin. Git worktrees share the clone-local selection. A separate
clone must be configured separately. Never put a key or token in Git config.
The App config itself stays in an owner-only external file. App mode cannot
fall back to the human account when configuration or authentication fails.
Selecting an App also requires an external, owned mode-600 regular publisher
and config file; the protected publisher subsequently validates config contents,
key protection, App identity and installation scope before publishing.

Canonical Nexa must have `app` selected, pinning `lmiguelvargasf/nexa` and using
the owner's `/Users/m/.config/briko/publish.mjs` and
`/Users/m/.config/briko/config.json`. If selection is absent on a new Nexa clone,
restore that selection from a trusted owner session before publication; the
template default does not override Nexa's explicit requirement. Another owner
does not inherit this exception just by copying the source.

To intentionally switch a project that permits ordinary publication back to
`github`, remove its App paths and pin, then select `github`. For example, use
`git config --local --unset-all nexa.publication.publisherPath` and likewise
remove `configPath` and `repository`. An absent setting needs no removal.
Leaving App paths with `github` or no mode is rejected as incomplete setup.
Never switch modes as a workaround for an App failure or change another author's
existing PR identity.

## Publish with your authenticated account

With `github` selected, use the existing issue implementation workflow: inspect
the issue/branches/PRs, implement, validate, fill every PR-template heading, and
commit with accurate authorship. Confirm authentication with
`mise exec -- gh auth status` and `mise exec -- gh api user --jq .login`; check
that normal Git push authentication is also configured for origin. Missing
authentication is a setup blocker, not a reason to claim publication succeeded.

Use the repository printed by `task agents:publication`, the actual issue branch
from `git branch --show-current`, and the intended base. Replace the examples
below; do not publish to Nexa merely because this template came from Nexa:

```bash
mise exec -- gh pr list --repo OWNER/REPO --state all --head issue/123-feature
git push origin HEAD:refs/heads/issue/123-feature
mise exec -- gh pr create --repo OWNER/REPO --head issue/123-feature --base main \
  --title "Implement the feature" --body-file /absolute/path/to/completed-pr-body.md
```

Before pushing, verify the branch belongs to this issue and origin has a single
matching fetch/push destination. Fetch/integrate the current base and rerun
applicable checks when needed. Use ordinary non-forced pushes. Read existing
matching PRs before updating: verify the same repository, branch, base, issue
reference and authenticated author. Reuse your matching open PR, preserve human
description edits, and record current validation evidence. Stop for unrelated
authors, closed/merged PRs or conflicting branches; do not overwrite or transfer
them. An uncertain creation/push must be inspected before retrying to avoid
duplicates. Completed PRs are regular; drafts require an explicit request for
unfinished work. Verify the published URL, author, base/head, issue reference,
template body and ready state, then attach the PR to the Codex chat.

These commands use your existing authentication without replacing your global
login. They preserve commit authors and committers, disclose AI authorship, and
retain required CI/review/merge protections. A human-authored PR is subject to
GitHub's usual restriction against approving your own PR; owners who need a
separate publication identity can explicitly select an App.

## Optional App publisher (Briko on Nexa)

The publisher is called **Briko**. In its GitHub App slug, `brikosi`, **SI** stands
for **Super Intelligence**; the registered App name is **Brikosi** and its bot
login is `brikosi[bot]`.

Briko publishes coding-agent implementation branches and PRs through the owner's
**Brikosi** GitHub App (`brikosi[bot]`). The maintainer
reviews those PRs using their own GitHub account. App authorship is provenance;
required CI, current-revision checks and merge protections still apply. Briko does
not review, approve or automatically merge changes.
Existing human-authored PRs keep their authors; switching credentials cannot
transfer historical authorship. Commit authors and coauthor disclosures are
preserved independently of the PR author.

## Registration and installation

For Nexa, the owner registered the **private Brikosi GitHub App**. Its verified
identity is App ID `5186831`, slug `brikosi`, bot login `brikosi[bot]` and numeric
bot ID `337737264`. Installation `167846373` selects only `lmiguelvargasf/nexa`.
The client ID is available in the owner's App settings. These IDs document this
installation; the reusable publisher reads its protected config and resolves the
destination from the clone instead of hardcoding them.

For another repository under the same personal account, the owner can extend the
existing private Brikosi installation's selected repositories. Keep a separate
protected config for each destination, using the same App identity/key and the
verified installation ID. Each invocation still requests a token for just its
destination. Another account or organization owner can register their own private
App; App names are globally unique, so record its actual slug and bot ID instead
of assuming Brikosi is available. Brikosi remains private; no credentials are
distributed with the template.

Repository permissions:

| Permission | Access | Purpose |
| --- | --- | --- |
| Contents | Read and write | Publish implementation commits and branches |
| Pull requests | Read and write | Create PRs, publish validation comments, mark completed drafts ready |
| Metadata | Read | Mandatory GitHub repository identity access |
| Workflows | Read and write | Allow authorized implementation changes to `.github/workflows/` |

The publisher requests Workflows permission on its token only when the candidate
changes workflow files. An App used exclusively for other files can omit that
registration permission. Do not grant Administration, Actions, Secrets, Checks,
organization/account permissions or a branch-protection/ruleset bypass. Keep
webhooks, OAuth user authorization and device flow disabled; no service needs to
listen for events. Install using **Only select repositories**, selecting only
authorized destinations (initially Nexa for the owner's installation). The reusable
publisher derives its destination from the current clone's origin and requires an
exact protected repository pin.

Record the App ID, client ID, slug and installation ID from GitHub's App settings
and installation pages. Verify the public `SLUG[bot]` identity with
`mise exec -- gh api 'users/SLUG[bot]' --jq '{id,login,type}'` and record its numeric
ID; expect type `Bot`. The publisher checks all these identities through GitHub
before publication. A key authenticates the App, and the repository-installation
lookup verifies the App's installation and selected-repository scope.

## Protected local provisioning

Perform setup from a trusted maintainer session. Generate/download an App private
key, move it directly to a private folder outside **every repository/worktree**,
and set folder mode `700` and key/config mode `600`. Do not paste the key into
chat, `.env.local`, shell commands, tracked files, Git remotes or logs. Store the
key in a protected credential store when available; this local workflow uses an
owner-only PEM file. No application environment variable is added to `src/env.ts`.

Example folder layout (all paths are local and absolute):

```text
~/.config/briko/                 # mode 700, outside all checkouts
  private-key.pem                # mode 600
  config.json                    # mode 600
  publish.mjs                    # reviewed standalone publisher, mode 600
```

The Nexa owner's local setup uses this `~/.config/briko/` layout. Resolve the home
directory in the trusted maintainer session and pass absolute paths to the CLI.

`config.json` (replace all example values with verified IDs and paths):

```json
{
  "appId": 123,
  "clientId": "Iv_REPLACE_ME",
  "installationId": 456,
  "slug": "briko",
  "botId": 789,
  "repository": "OWNER/REPO",
  "privateKeyPath": "/absolute/protected/path/private-key.pem",
  "ghPath": "/absolute/path/to/pinned/gh"
}
```

Find the pinned `gh` path with `mise which gh`. Copy the reviewed
`scripts/agents/publish.mjs` into the protected folder **once**, after examining
the change. Run that trusted copy, rather than executing a candidate checkout's
publisher with credentials. Updating the protected copy is an explicit maintainer
operation after reviewing a new publisher revision. The CLI refuses to run its
publisher or load its key/config from inside the candidate checkout and rejects
symlinks, wrong ownership or permissive key/config file modes.

Do not expose this folder or credentials to untrusted PRs, repository tests,
review agents or arbitrary agent shell sessions. The publisher accepts committed
objects and report text as data; it never runs setup, tests, hooks or application
code with a token. It exports objects without credentials, then pushes from an
isolated temporary bare repository with global/system Git configuration and hooks
disabled. It invokes pinned `gh` from the isolated directory with an empty
configuration directory and a token specific to that subprocess. The token is
held in memory/child-process environments, never in argv, credential helpers,
remote URLs, report files or configuration. The temporary askpass script contains
no secret. A private local folder is not a sandbox against processes running as
the same OS user: use a separate publisher OS account/service or restricted
execution boundary when running untrusted PR code. Never run untrusted tests
concurrently with credential provisioning/publication in the same user session.

## Issue implementation and publication

This section applies to `app` mode. Use the publisher and config paths reported
by `task agents:publication`; all earlier generic workflow requirements still apply.

1. Read the issue, discussion, existing branches/PRs and acceptance criteria.
   Fetch the intended remote base. Start `issue/<number>-<description>` from
   current remote `main`, or resume a matching implementation without resetting
   it. Explicit alternative bases remain supported with `--base`.
2. Implement and review the diff. Run `mise exec -- task verify`, or
   `mise exec -- task verify:all` when browser validation applies, **before**
   provisioning a token. Fix introduced failures. The publisher does not rerun
   tests or certify their results; report exact commands and outcomes truthfully.
3. Complete every `.github/pull_request_template.md` heading in a body file.
   Reference the issue, include validation evidence and disclose AI authorship.
   Use `Closes #N` only for fully resolved work; otherwise use `Related to #N`.
   Commit reviewed changes with accurate commit authorship. The checkout must be
   clean and include current remote base. Retain commit history for updates.
4. Run the protected publisher, supplying explicit paths and the intended base:

```bash
mise exec -- node /absolute/protected/path/publish.mjs \
  --checkout /absolute/path/to/checkout \
  --config /absolute/protected/path/config.json \
  --issue 58 --base main \
  --title "Add Briko publication for agent implementation PRs" \
  --body-file /absolute/path/to/completed-pr-body.md
```

The publisher verifies origin fetch/push URLs, the protected repository pin, App
and bot identities, installation, token repository and permissions, issue, base,
branch ownership and PR state. Each invocation mints a fresh token restricted to
one repository with only the needed permissions, and revokes it in a `finally`
block. GitHub tokens expire after one hour; there is no long-lived token cache or
maintainer-login fallback. A push uses an exact lease and allows only history
that includes the previously published branch, preventing accidental overwrites.
No commit author or committer is rewritten.

Completed PRs are regular PRs. Pass `--draft` only when the owner explicitly asks
to publish unfinished work. A matching draft becomes ready on completed
publication. Reruns reuse the same matching App PR and deduplicate validation
reports. Updates preserve the existing PR title/body and add the current report
as a Briko comment. Review the latest report at the current head. The helper
refuses unrelated/human-authored PRs, previously closed/merged branches or
non-ancestor remote edits. Reconcile those cases manually; never transfer or
overwrite unrelated work.

The reported URL is emitted only after verifying the published author, base/head,
issue marker, revision, initial template body and ready/draft state. Attach the PR
to the Codex chat. The existing human `task pr:create` task remains available for
ordinary maintainer work; agent implementation PRs use this entry point.

## Failure recovery and credentials

- **Missing key/config:** provision protected files and verified IDs. No fallback
  to the maintainer account is permitted.
- **401/expired/revoked credentials:** check the system clock, App/client IDs and
  private key. Every rerun renews the installation token. API and subprocess
  errors are redacted; do not enable HTTP/token tracing.
- **403/404 or permission failure:** check the selected installation/repository,
  suspended status and required Contents/Pull requests/Workflows grants. Owner
  acceptance may be needed for newly requested App permissions.
- **Push, creation or response uncertainty:** inspect the remote branch and PR
  first. A successful push with a lost PR response is recoverable on rerun;
  matching PR creation is read back before another creation is attempted. A
  failed report comment is recovered by checking for its head/report marker.
  Concurrent branch changes are never blindly retried.
- **Base advanced:** fetch/integrate current base and rerun applicable validation.
- **Rotation:** generate a new App key in the trusted setup session, replace the
  protected file atomically, verify publication, then revoke the old key in App
  settings. Protect the replacement and keep secrets out of outputs.
- **Revocation/disabling:** suspend/uninstall Briko from the repository or revoke
  its key through GitHub settings, and remove access to the protected publisher.
  For an interrupted process, GitHub token expiry limits the remaining lifetime;
  suspend the installation for immediate emergency revocation. Normal invocations
  explicitly revoke their token even on failure. Existing PRs remain intact.

## Actions and manual review

Local publishing is the supported entry point. No App key is stored in repository
Actions secrets or exposed to existing CI/skill/dependency workflows. CI continues
to use its existing permissions. If Actions publication is added later, provision
the key in a protected environment with approval, run only trusted publisher code
and grant an installation token to the publication step alone; never execute PR
code in that credential-bearing job or use `pull_request_target` to run PR code.
Do not migrate the existing skill updater or change Renovate eligibility.

App-authored pushes/PRs trigger the existing `pull_request` CI workflow, unlike
some events created with the default Actions `GITHUB_TOKEN`. Verify a real
authorized implementation PR at creation **and** after an update: author equals
the verified App bot, base/head and report are correct, required CI starts and
finishes at the current revision, and the maintainer's review dialog permits a
normal review. Do not submit approval or merge to demonstrate the integration.

## Validation record

Mode-selection fixtures use temporary Git repositories to check template defaults,
explicit App selection without reading credentials, incomplete/invalid setup,
destination changes and protected paths. Existing App fixture checks are included
in `task verify` through `task agents:test` and cover
destination pins, App/bot identity, token scope/expiry, credential isolation,
failure recovery, leases, ownership and repeated publication. Actual setup and
hosted CI/review evidence are recorded in the implementation PR; unavailable
registration or credentials means **incomplete integration validation**, even
when the fixtures pass.

The first live implementation is [PR #60](https://github.com/lmiguelvargasf/nexa/pull/60).
Creation verified author `brikosi[bot]`, base `main`, the intended issue branch,
all PR-template headings and a regular PR. An identical publication reused that
PR without creating a second PR or report. The existing
[CI run at creation](https://github.com/lmiguelvargasf/nexa/actions/runs/37209371548)
started automatically. In the maintainer's signed-in GitHub review dialog,
**Approve** was enabled; the dialog was cancelled without submitting a review.
Subsequent update/CI outcomes are recorded in the current Brikosi validation
report comment on that PR. No approval or merge was performed during setup.

References: [App installation authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation),
[token creation and expiration](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app),
[App permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app).
