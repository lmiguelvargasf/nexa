import assert from "node:assert/strict";
import test from "node:test";
import { databaseDependenciesChanged, parseLock } from "./database-scope.mjs";

function snapshot() {
  return {
    manifest: {
      dependencies: { clsx: "^2.0.0", "@supabase/supabase-js": "^2.0.0" },
      devDependencies: { supabase: "^2.0.0" },
    },
    lock: {
      lockfileVersion: 1,
      workspaces: {
        "": {
          dependencies: { clsx: "^2.0.0", "@supabase/supabase-js": "^2.0.0" },
          devDependencies: { supabase: "^2.0.0" },
        },
      },
      packages: {
        clsx: [
          "clsx@2.0.0",
          "",
          { dependencies: { unrelated: "1.0.0" } },
          "integrity",
        ],
        unrelated: ["unrelated@1.0.0", "", {}, "integrity"],
        supabase: [
          "supabase@2.0.0",
          "",
          {
            dependencies: { shared: "1.0.0" },
            optionalDependencies: { "@supabase/cli-linux-x64": "2.0.0" },
          },
          "integrity",
        ],
        "@supabase/cli-linux-x64": [
          "@supabase/cli-linux-x64@2.0.0",
          "",
          {},
          "integrity",
        ],
        "@supabase/supabase-js": [
          "@supabase/supabase-js@2.0.0",
          "",
          {
            dependencies: { shared: "1.0.0" },
            peerDependencies: { optional: "1.0.0" },
            optionalPeers: ["optional"],
          },
          "integrity",
        ],
        shared: ["shared@1.0.0", "", {}, "integrity"],
      },
    },
  };
}

for (const [description, change, expected] of [
  ["unchanged snapshots", () => {}, false],
  [
    "unrelated declared and resolved update",
    (s) => {
      s.manifest.dependencies.clsx = "^2.1.0";
      s.lock.workspaces[""].dependencies.clsx = "^2.1.0";
      s.lock.packages.clsx[0] = "clsx@2.1.0";
    },
    false,
  ],
  [
    "unrelated transitive update",
    (s) => {
      s.lock.packages.unrelated[0] = "unrelated@1.1.0";
    },
    false,
  ],
  [
    "Supabase CLI declaration",
    (s) => {
      s.manifest.devDependencies.supabase = "~2.0.0";
    },
    true,
  ],
  [
    "Supabase client update",
    (s) => {
      s.lock.packages["@supabase/supabase-js"][0] =
        "@supabase/supabase-js@2.1.0";
    },
    true,
  ],
  [
    "native CLI package",
    (s) => {
      s.lock.packages["@supabase/cli-linux-x64"][3] = "new-integrity";
    },
    true,
  ],
  [
    "shared transitive update",
    (s) => {
      s.lock.packages.shared[0] = "shared@1.1.0";
    },
    true,
  ],
  [
    "relevant override",
    (s) => {
      s.manifest.overrides = { shared: "1.1.0" };
    },
    true,
  ],
  [
    "unrelated override",
    (s) => {
      s.manifest.overrides = { unrelated: "1.1.0" };
      s.lock.overrides = { unrelated: "1.1.0" };
    },
    false,
  ],
  [
    "optional peer now resolved",
    (s) => {
      s.lock.packages.optional = ["optional@1.0.0", "", {}, "integrity"];
    },
    true,
  ],
  [
    "database script edit",
    (s) => {
      s.manifest.scripts = { "db:start": "new command" };
    },
    true,
  ],
  [
    "installation trust",
    (s) => {
      s.lock.trustedDependencies = ["supabase"];
    },
    true,
  ],
  [
    "new workspace",
    (s) => {
      s.lock.workspaces.extra = {};
    },
    true,
  ],
]) {
  test(`database dependencies: ${description}`, () => {
    const before = snapshot();
    const after = structuredClone(before);
    change(after);
    assert.equal(databaseDependenciesChanged(before, after), expected);
  });
}

test("nested package resolutions follow the relevant parent rather than unrelated hoisted versions", () => {
  const before = snapshot();
  before.lock.packages["supabase/shared"] = [
    "shared@1.0.0",
    "",
    {},
    "integrity",
  ];
  before.lock.packages["@supabase/supabase-js"][2].dependencies = {};
  const after = structuredClone(before);
  after.lock.packages.shared[0] = "shared@1.1.0";
  assert.equal(databaseDependenciesChanged(before, after), false);
  after.lock.packages["supabase/shared"][0] = "shared@1.2.0";
  assert.equal(databaseDependenciesChanged(before, after), true);
});

test("graph cycles terminate and dependency removal remains relevant", () => {
  const before = snapshot();
  before.lock.packages.shared[2].dependencies = { supabase: "2.0.0" };
  assert.equal(databaseDependenciesChanged(before, before), false);
  const after = structuredClone(before);
  delete after.lock.packages.supabase;
  delete after.lock.packages.shared[2].dependencies;
  assert.equal(databaseDependenciesChanged(before, after), true);
});

test("unsupported or incomplete comparison evidence throws for conservative caller handling", () => {
  for (const change of [
    (s) => {
      s.lock.lockfileVersion = 99;
    },
    (s) => {
      delete s.lock.packages.shared;
    },
    (s) => {
      s.lock.packages.supabase = null;
    },
    (s) => {
      s.manifest.overrides = { "supabase>shared": "1.0.0" };
    },
  ]) {
    const before = snapshot();
    const after = structuredClone(before);
    change(after);
    assert.throws(() => databaseDependenciesChanged(before, after));
  }
});

test("lock parser preserves string contents while accepting Bun trailing commas", () => {
  assert.deepEqual(
    parseLock('{"text":"comma,} and escaped \\" quote", "list":[1,],}'),
    { text: 'comma,} and escaped " quote', list: [1] },
  );
  assert.throws(() => parseLock('{/* comment */"a":1}'));
});

test("scoped package names are not mistaken for nested parents", () => {
  const before = snapshot();
  before.lock.packages.supabase[2].dependencies = {};
  before.lock.packages["@supabase/shared"] = [
    "@supabase/shared@1.0.0",
    "",
    {},
    "integrity",
  ];
  const after = structuredClone(before);
  after.lock.packages.shared[0] = "shared@1.1.0";
  assert.equal(databaseDependenciesChanged(before, after), true);
});
