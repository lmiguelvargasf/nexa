import assert from "node:assert/strict";
import test from "node:test";
import { upstreamEvidence } from "./github.mjs";
import { bunEligibility, satisfies, version } from "./policy.mjs";
import { actionReferences, inspectUpdates } from "./updates.mjs";

const entry = (name, value, metadata = {}) => [
  `${name}@${value}`,
  "",
  metadata,
  "sha512-YWJj",
];
function packages(names) {
  const before = {
    dependencies: Object.fromEntries(names.map(([name, old]) => [name, old])),
  };
  const after = {
    dependencies: Object.fromEntries(
      names.map(([name, , next]) => [name, next]),
    ),
  };
  const lock = (manifest) => ({
    workspaces: { "": manifest },
    packages: Object.fromEntries(
      Object.entries(manifest.dependencies).map(([name, value]) => [
        name,
        entry(name, value.replace(/^[~^]/, "")),
      ]),
    ),
  });
  return {
    paths: ["package.json", "bun.lock"],
    before,
    after,
    oldLock: lock(before),
    newLock: lock(after),
  };
}

test("all package categories and grouped 0.x/framework/integration updates can qualify", () => {
  const data = packages([
    ["zod", "^4.4.3", "^4.6.5"],
    ["next", "^16.3.8", "^16.3.9"],
    ["@supabase/ssr", "^0.10.3", "^0.11.0"],
  ]);
  data.newLock.packages.next[2] = { dependencies: { indirect: "^2.0.0" } };
  data.newLock.packages.indirect = entry("indirect", "2.0.0");
  assert.deepEqual(bunEligibility(data).reasons, []);
  assert.equal(bunEligibility(data).candidate, true);
  assert.equal(satisfies(version("0.10.4"), version("^0.10.3")), true);
  assert.equal(satisfies(version("0.11.0"), version("^0.10.3")), false);
  assert.equal(satisfies(version("0.0.4"), version("^0.0.3")), false);
  data.newLock.packages.next[0] = "next@17.0.0";
  assert.equal(bunEligibility(data).candidate, false);
});

test("version-only overrides are reviewed while trust and same-version integrity changes fail", () => {
  const data = packages([["zod", "^4.4.3", "^4.6.5"]]);
  data.before.overrides = { indirect: "2.1.0" };
  data.after.overrides = { indirect: "2.2.0" };
  data.oldLock.overrides = data.before.overrides;
  data.newLock.overrides = data.after.overrides;
  data.oldLock.packages.indirect = entry("indirect", "2.1.0");
  data.newLock.packages.indirect = entry("indirect", "2.2.0");
  assert.equal(bunEligibility(data).candidate, true);
  const valid = structuredClone(data);
  for (const mutate of [
    (f) => {
      f.after.trustedDependencies = ["new-hook"];
    },
    (f) => {
      f.newLock.trustedDependencies = ["new-hook"];
    },
    (f) => {
      f.newLock.packages.indirect[0] = "indirect@3.0.0";
    },
    (f) => {
      f.newLock.packages.indirect[1] = "https://example.com/source";
    },
    (f) => {
      f.oldLock.packages.indirect[0] = "indirect@2.2.0";
      f.newLock.packages.indirect[3] = "sha512-ZGVm";
    },
  ]) {
    const f = structuredClone(valid);
    mutate(f);
    assert.equal(bunEligibility(f).candidate, false);
  }
});

function miseSnapshot(
  name = "node",
  oldVersion = "24.16.0",
  nextVersion = "24.21.0",
) {
  const lock = (value) =>
    `[[tools.${name}]]\nversion = "${value}"\nbackend = "core:${name}"\n[tools.${name}."platforms.linux-x64"]\nchecksum = "sha256:${"a".repeat(64)}"\nurl = "${name === "node" ? `https://nodejs.org/dist/v${value}/node-v${value}-linux-x64.tar.gz` : `https://github.com/j178/prek/releases/download/v${value}/prek-linux-x64.tar.gz`}"\n`;
  const manifest = (value) =>
    name === "node"
      ? { engines: { node: `>=${value} <25` }, dependencies: {} }
      : { dependencies: {} };
  return {
    paths: [
      "mise.toml",
      "mise.lock",
      ...(name === "node" ? ["package.json"] : []),
    ],
    before: {
      "mise.toml": `[settings]\nlockfile = true\n[tools]\n${name} = "${oldVersion}"\n`,
      "mise.lock": lock(oldVersion),
      "package.json": JSON.stringify(manifest(oldVersion)),
    },
    after: {
      "mise.toml": `[settings]\nlockfile = true\n[tools]\n${name} = "${nextVersion}"\n`,
      "mise.lock": lock(nextVersion),
      "package.json": JSON.stringify(manifest(nextVersion)),
    },
  };
}

test("synchronized runtime/mise pins and 0.x tools qualify with versioned checksummed sources", () => {
  for (const f of [miseSnapshot(), miseSnapshot("prek", "0.4.3", "0.5.4")]) {
    // Runtime-only package edits still have an unchanged reproducible Bun lock.
    for (const side of [f.before, f.after])
      side["bun.lock"] = JSON.stringify({
        workspaces: { "": { dependencies: {} } },
        packages: {},
      });
    assert.deepEqual(inspectUpdates(f).reasons, []);
    assert.equal(inspectUpdates(f).candidate, true);
    assert.equal(inspectUpdates(f).changes[0].manager, "mise");
  }
});

test("tool majors, settings/backend/source/checksum changes and unsynchronized runtime pins fail", () => {
  const valid = miseSnapshot();
  for (const side of [valid.before, valid.after])
    side["bun.lock"] = JSON.stringify({
      workspaces: { "": { dependencies: {} } },
      packages: {},
    });
  for (const mutate of [
    (f) => {
      f.after["mise.toml"] = f.after["mise.toml"].replace("24.21.0", "25.0.0");
    },
    (f) => {
      f.after["mise.toml"] += '\n[env]\nTOKEN = "unsafe"\n';
    },
    (f) => {
      f.after["mise.lock"] = f.after["mise.lock"].replace(
        "core:node",
        "custom:node",
      );
    },
    (f) => {
      f.after["mise.lock"] = f.after["mise.lock"].replace(
        "nodejs.org",
        "example.com",
      );
    },
    (f) => {
      f.after["mise.lock"] = f.after["mise.lock"].replace("sha256:", "bad:");
    },
    (f) => {
      f.after["package.json"] = f.before["package.json"];
    },
    (f) => {
      f.after["mise.lock"] = f.before["mise.lock"];
    },
  ]) {
    const f = structuredClone(valid);
    mutate(f);
    assert.equal(
      inspectUpdates(f).candidate,
      false,
      JSON.stringify(inspectUpdates(f)),
    );
  }
});

function actions(before, after) {
  const path = ".github/workflows/ci.yml";
  return {
    paths: [path],
    before: { [path]: before },
    after: { [path]: after },
  };
}

test("Action minor/patch and immutable pin updates qualify without permitting workflow edits", () => {
  const before =
    "jobs:\n  test:\n    steps:\n      - uses: actions/checkout@v6\n      - run: task verify\n";
  for (const next of [
    "actions/checkout@v6.1.0",
    `actions/checkout@${"a".repeat(40)} # v6`,
  ])
    assert.equal(
      inspectUpdates(
        actions(before, before.replace("actions/checkout@v6", next)),
      ).candidate,
      true,
    );
  for (const next of [
    "actions/checkout@v7",
    "actions/checkout@v6.1.0-beta.1",
    "other/checkout@v6.1.0",
    `actions/checkout@${"a".repeat(40)}`,
  ])
    assert.equal(
      inspectUpdates(
        actions(before, before.replace("actions/checkout@v6", next)),
      ).candidate,
      false,
    );
  const after = before.replace("@v6", "@v6.1.0");
  for (const changed of [
    after.replace("task verify", "curl malicious"),
    `${after}permissions: write-all\n`,
    after.replace("steps:", "if: true\n    steps:"),
  ])
    assert.equal(inspectUpdates(actions(before, changed)).candidate, false);
  const data = actionReferences("      - uses: 'actions/checkout@v6.1.0'\n");
  assert.equal(data.references[0].version, "6.1.0");
});

test("Action evidence verifies digest/tag identity and supports unchanged-source pinning", async () => {
  const sha = "a".repeat(40);
  const change = {
    manager: "github-actions",
    name: "actions/checkout",
    repository: "actions/checkout",
    oldRef: "v6",
    newRef: sha,
    newTag: "v6",
  };
  const client = () => ({ api: async () => ({ sha }) });
  assert.equal(
    (await upstreamEvidence(change, 12000, client)).unchangedSource,
    true,
  );
  await assert.rejects(
    upstreamEvidence(change, 12000, () => ({
      api: async (path) => ({
        sha: path === "commits/v6" ? "b".repeat(40) : sha,
      }),
    })),
    /does not match/,
  );
});

test("tool evidence uses exact commits and complete bounded release/source data", async () => {
  const change = {
    manager: "mise",
    name: "prek",
    repository: "j178/prek",
    oldRef: "v0.4.3",
    newRef: "v0.5.4",
  };
  const client = () => ({
    api: async (path) =>
      path.startsWith("commits/")
        ? { sha: path.endsWith("v0.4.3") ? "a".repeat(40) : "b".repeat(40) }
        : {
            body: "CLI release behavior changes",
            html_url: "https://github.com/j178/prek/releases/tag/v0.5.4",
          },
  });
  assert.match(
    (await upstreamEvidence(change, 12000, client)).notes,
    /behavior changes/,
  );
  await assert.rejects(upstreamEvidence(change, 2, client), /context limit/);
});
