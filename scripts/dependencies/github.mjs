import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function repositoryName(value) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value ?? ""))
    throw new Error("Invalid repository identity");
  return value;
}

export async function request(
  url,
  {
    token,
    body,
    method = "GET",
    maxBytes = 4_000_000,
    accept = "application/vnd.github+json",
  } = {},
) {
  const headers = {
    Accept: accept,
    "User-Agent": "nexa-dependency-review",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new Error(`Evidence request returned HTTP ${response.status}`);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > maxBytes)
      throw new Error("Evidence response exceeds its byte limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function githubClient(repository, token) {
  repositoryName(repository);
  const api = async (path, options = {}) =>
    JSON.parse(
      (
        await request(
          `https://api.github.com/repos/${repository}${path ? `/${path}` : ""}`,
          { token, ...options },
        )
      ).toString(),
    );
  const pages = async (path, limit = 10) => {
    const result = [];
    for (let page = 1; page <= limit; page++) {
      const entries = await api(
        `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
      );
      result.push(...entries);
      if (entries.length < 100) return result;
    }
    throw new Error("Paginated evidence is incomplete");
  };
  return { api, pages };
}

export async function validationIdentity(client, runId, token, repository) {
  const identity = await jsonArtifact(
    client,
    runId,
    token,
    repository,
    "validation-identity",
    "validation-identity.json",
    8192,
  );
  if (identity.runId !== runId) throw new Error("CI run identity mismatch");
  return identity;
}

export async function jsonArtifact(
  client,
  runId,
  token,
  repository,
  name,
  filename,
  maxBytes = 65536,
) {
  const { artifacts } = await client.api(
    `actions/runs/${runId}/artifacts?per_page=100`,
  );
  const identities = artifacts.filter(
    (entry) => entry.name === name && !entry.expired,
  );
  if (identities.length !== 1 || identities[0].size_in_bytes > 65536)
    throw new Error(`Missing or ambiguous ${name} artifact`);
  const directory = mkdtempSync(join(tmpdir(), "dependency-ci-"));
  try {
    const zip = await request(
      `https://api.github.com/repos/${repository}/actions/artifacts/${identities[0].id}/zip`,
      { token, maxBytes: 131072 },
    );
    const archive = join(directory, "identity.zip");
    writeFileSync(archive, zip);
    // Read one small data file; never extract paths or execute CI artifacts.
    const content = execFileSync("unzip", ["-p", archive, filename], {
      encoding: "utf8",
      maxBuffer: maxBytes,
    });
    return JSON.parse(content);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export async function releaseEvidence(
  change,
  maxBytes,
  clientForRepo = (repo) => githubClient(repo),
) {
  const version = /^(?:\^|~)?(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)$/.exec(
    change.after ?? "",
  )?.[1];
  if (!version || !/^(@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(change.name))
    throw new Error("Unsupported package declaration");
  const metadataUrl = `https://registry.npmjs.org/${encodeURIComponent(change.name)}/${encodeURIComponent(version)}`;
  const metadata = JSON.parse(
    (
      await request(metadataUrl, {
        maxBytes: 300_000,
        accept: "application/json",
      })
    ).toString(),
  );
  const repositoryUrl =
    typeof metadata.repository === "string"
      ? metadata.repository
      : metadata.repository?.url;
  const match =
    /^(?:git\+)?https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(
      repositoryUrl ?? "",
    );
  if (!match || metadata.name !== change.name || metadata.version !== version)
    throw new Error("Missing versioned upstream source");
  const client = clientForRepo(match[1]);
  // Some monorepos publish exact package-prefixed tags (for example,
  // tailwind-merge@3.7.0). Keep lookup bounded to these three exact names.
  for (const tag of [`v${version}`, version, `${change.name}@${version}`]) {
    try {
      const release = await client.api(
        `releases/tags/${encodeURIComponent(tag)}`,
        { maxBytes: 100_000 },
      );
      if (release.draft || release.prerelease || !release.body?.trim())
        continue;
      if (Buffer.byteLength(release.body) > maxBytes)
        throw new Error("Release notes exceed the context limit");
      return {
        package: change.name,
        metadataUrl,
        releaseUrl: release.html_url,
        tag,
        notes: release.body,
      };
    } catch (error) {
      if (!error.message.includes("HTTP 404")) throw error;
    }
  }
  const before = /^(?:\^|~)?(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)$/.exec(
    change.before ?? "",
  )?.[1];
  if (!before) throw new Error("No release notes or comparable prior version");
  for (const prefix of ["v", ""]) {
    try {
      const comparison = await client.api(
        `compare/${encodeURIComponent(`${prefix}${before}...${prefix}${version}`)}`,
        { maxBytes: 300_000 },
      );
      if (
        comparison.status !== "ahead" ||
        !comparison.files?.length ||
        comparison.files.length > 10 ||
        comparison.total_commits !== comparison.commits?.length ||
        comparison.files.some((file) => !file.patch)
      ) {
        throw new Error(
          "Versioned source comparison is incomplete or too large",
        );
      }
      const source = {
        package: change.name,
        metadataUrl,
        comparisonUrl: comparison.html_url,
        baseCommit: comparison.base_commit.sha,
        headCommit: comparison.commits.at(-1).sha,
        files: comparison.files.map(({ filename, status, patch }) => ({
          filename,
          status,
          patch,
        })),
      };
      if (Buffer.byteLength(JSON.stringify(source)) > maxBytes)
        throw new Error("Source comparison exceeds the context limit");
      return source;
    } catch (error) {
      if (!error.message.includes("HTTP 404")) throw error;
    }
  }
  throw new Error("No release notes or exact versioned source comparison");
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
