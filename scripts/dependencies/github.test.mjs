import assert from "node:assert/strict";
import test from "node:test";
import {
  githubClient,
  releaseEvidence,
  repositoryName,
  request,
} from "./github.mjs";

test("repository identity is derived and validated without a hardcoded destination", () => {
  assert.equal(
    repositoryName("another-owner/copied-template"),
    "another-owner/copied-template",
  );
  for (const value of [
    undefined,
    "owner",
    "owner/repo/extra",
    "https://github.com/owner/repo",
    "owner/repo\n",
  ])
    assert.throws(() => repositoryName(value));
});

test("HTTP errors, size limits and incomplete pagination stop evidence collection", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("denied", { status: 403 }),
  );
  await assert.rejects(request("https://api.github.com/"), /HTTP 403/);
  globalThis.fetch = async () => new Response("oversized");
  await assert.rejects(
    request("https://api.github.com/", { maxBytes: 2 }),
    /byte limit/,
  );
  globalThis.fetch = async () =>
    new Response(JSON.stringify(Array.from({ length: 100 }, () => ({}))));
  await assert.rejects(
    githubClient("owner/repo").pages("issues/1/comments", 1),
    /incomplete/,
  );
});

test("exact versioned source comparison is a fallback when release notes are absent", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          name: "clsx",
          version: "2.1.1",
          repository: { url: "git+https://github.com/lukeed/clsx.git" },
        }),
      ),
  );
  const calls = [];
  const result = await releaseEvidence(
    { name: "clsx", before: "^2.1.0", after: "^2.1.1" },
    12000,
    (repo) => {
      assert.equal(repo, "lukeed/clsx");
      return {
        api: async (path) => {
          calls.push(path);
          if (path.startsWith("releases/"))
            throw new Error("Evidence request returned HTTP 404");
          return {
            status: "ahead",
            total_commits: 1,
            commits: [{ sha: "a".repeat(40) }],
            base_commit: { sha: "b".repeat(40) },
            html_url: "https://github.com/lukeed/clsx/compare/v2.1.0...v2.1.1",
            files: [
              {
                filename: "src/index.js",
                status: "modified",
                patch: "-old\n+new",
              },
            ],
          };
        },
      };
    },
  );
  assert.equal(result.files[0].patch, "-old\n+new");
  assert.equal(calls.at(-1), "compare/v2.1.0...v2.1.1");
});

test("exact package-prefixed release tags support monorepos and scoped package names", async (t) => {
  for (const name of ["tailwind-merge", "@scope/helper"]) {
    t.mock.method(
      globalThis,
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            name,
            version: "3.7.0",
            repository: "https://github.com/owner/packages.git",
          }),
        ),
    );
    const calls = [];
    const result = await releaseEvidence(
      { name, before: "3.6.0", after: "3.7.0" },
      12000,
      () => ({
        api: async (path) => {
          calls.push(path);
          if (path !== `releases/tags/${encodeURIComponent(`${name}@3.7.0`)}`)
            throw new Error("HTTP 404");
          return {
            body: "Exact package release notes",
            html_url: `https://github.com/owner/packages/releases/tag/${encodeURIComponent(`${name}@3.7.0`)}`,
          };
        },
      }),
    );
    assert.equal(result.tag, `${name}@3.7.0`);
    assert.equal(result.notes, "Exact package release notes");
    assert.equal(calls.length, 3);
  }
});

test("package-prefixed releases retain completeness, size and prerelease restrictions", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          name: "tailwind-merge",
          version: "3.7.0",
          repository: "https://github.com/owner/packages",
        }),
      ),
  );
  const change = { name: "tailwind-merge", before: "3.6.0", after: "3.7.0" };
  const client = (release) => () => ({
    api: async (path) => {
      if (path === "releases/tags/tailwind-merge%403.7.0") return release;
      throw new Error("HTTP 404");
    },
  });
  await assert.rejects(
    releaseEvidence(change, 10, client({ body: "x".repeat(11) })),
    /context limit/,
  );
  for (const release of [
    { body: "" },
    { body: "notes", draft: true },
    { body: "notes", prerelease: true },
  ])
    await assert.rejects(
      releaseEvidence(change, 12000, client(release)),
      /No release notes/,
    );
});

test("oversized release notes and missing source patches cannot silently count as complete", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          name: "clsx",
          version: "2.1.1",
          repository: "https://github.com/lukeed/clsx",
        }),
      ),
  );
  await assert.rejects(
    releaseEvidence(
      { name: "clsx", before: "^2.1.0", after: "^2.1.1" },
      10,
      () => ({ api: async () => ({ body: "x".repeat(11) }) }),
    ),
    /context limit/,
  );
  await assert.rejects(
    releaseEvidence(
      { name: "clsx", before: "^2.1.0", after: "^2.1.1" },
      12000,
      () => ({
        api: async (path) => {
          if (path.startsWith("releases/")) throw new Error("HTTP 404");
          return {
            status: "ahead",
            total_commits: 1,
            commits: [{}],
            files: [{ filename: "binary" }],
          };
        },
      }),
    ),
    /incomplete/,
  );
});
