import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareVersions, version } from "./policy.mjs";
import { toolPlatforms } from "./updates.mjs";

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

export async function upstreamEvidence(
  change,
  maxBytes,
  clientForRepo = (repo) => githubClient(repo),
) {
  const client = clientForRepo(change.repository);
  const old = await client.api(`commits/${encodeURIComponent(change.oldRef)}`, {
    maxBytes: 300_000,
  });
  const next = await client.api(
    `commits/${encodeURIComponent(change.newRef)}`,
    { maxBytes: 300_000 },
  );
  if (
    !/^[a-f0-9]{40}$/.test(old.sha ?? "") ||
    !/^[a-f0-9]{40}$/.test(next.sha ?? "") ||
    (/^[a-f0-9]{40}$/.test(change.newRef) && next.sha !== change.newRef)
  )
    throw new Error("Invalid upstream commit identity");
  if (change.manager === "github-actions" && change.newTag) {
    const tagged = await client.api(
      `commits/${encodeURIComponent(change.newTag)}`,
      { maxBytes: 300_000 },
    );
    if (tagged.sha !== next.sha)
      throw new Error("Action digest does not match its annotated version tag");
  }
  const identity = {
    package: change.name,
    repository: change.repository,
    beforeRef: change.oldRef,
    afterRef: change.newRef,
    baseCommit: old.sha,
    headCommit: next.sha,
  };
  if (change.manager === "mise") {
    identity.assets = [];
    for (const platform of toolPlatforms(change.newEntry ?? {})) {
      if (platform.url_api === undefined) continue;
      const prefix = `https://api.github.com/repos/${change.repository}/releases/assets/`;
      const id = platform.url_api.startsWith(prefix)
        ? platform.url_api.slice(prefix.length)
        : "";
      if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))
        throw new Error("Unsupported tool asset API URL");
      const asset = await client.api(`releases/assets/${id}`, {
        maxBytes: 16_384,
      });
      if (
        asset.id !== Number(id) ||
        asset.state !== "uploaded" ||
        asset.url !== platform.url_api ||
        asset.browser_download_url !== platform.url ||
        (asset.digest != null && asset.digest !== platform.checksum)
      )
        throw new Error(
          "Tool asset metadata does not match its locked download",
        );
      identity.assets.push({
        apiUrl: asset.url,
        downloadUrl: asset.browser_download_url,
        publishedDigest: asset.digest ?? null,
        lockedChecksum: platform.checksum,
      });
    }
    if (Buffer.byteLength(JSON.stringify(identity)) > maxBytes)
      throw new Error("Tool asset evidence exceeds the context limit");
  }
  if (old.sha === next.sha && change.manager === "github-actions")
    return {
      ...identity,
      unchangedSource: true,
      notes:
        "Both upstream references resolve to the identical commit; this only pins the existing Action source.",
    };
  const tag = change.manager === "mise" ? change.newRef : change.newTag;
  if (
    tag &&
    !(change.manager === "github-actions" && change.before === change.after)
  ) {
    try {
      const release = await client.api(
        `releases/tags/${encodeURIComponent(tag)}`,
        { maxBytes: 100_000 },
      );
      if (release.draft || release.prerelease)
        throw new Error(
          "Upstream release is draft or prerelease; human review required",
        );
      if (change.manager === "mise") {
        const source = await client.api(
          `contents/CHANGELOG.md?ref=${next.sha}`,
          { maxBytes: 524_288 },
        );
        if (
          source.type !== "file" ||
          source.path !== "CHANGELOG.md" ||
          source.encoding !== "base64" ||
          !/^[a-f0-9]{40}$/.test(source.sha ?? "") ||
          typeof source.content !== "string"
        )
          throw new Error("Invalid versioned tool changelog identity");
        const content = Buffer.from(source.content, "base64");
        if (content.length > 262_144 || content.length !== source.size)
          throw new Error("Tool changelog is incomplete or too large");
        const range = changelogRange(
          content.toString("utf8"),
          change.before,
          change.after,
        );
        const result = {
          ...identity,
          releaseUrl: release.html_url,
          tag,
          changelog: {
            url: `https://github.com/${change.repository}/blob/${next.sha}/CHANGELOG.md`,
            blobSha: source.sha,
            coveredVersions: range.versions,
          },
          notes: range.notes,
        };
        if (Buffer.byteLength(JSON.stringify(result)) > maxBytes)
          throw new Error("Tool changelog evidence exceeds the context limit");
        return result;
      }
      if (release.body?.trim()) {
        if (Buffer.byteLength(release.body) > maxBytes)
          throw new Error("Release notes exceed the context limit");
        const result = {
          ...identity,
          releaseUrl: release.html_url,
          tag,
          notes: release.body,
        };
        if (Buffer.byteLength(JSON.stringify(result)) > maxBytes)
          throw new Error(
            "Upstream release evidence exceeds the context limit",
          );
        return result;
      }
    } catch (error) {
      if (!error.message.includes("HTTP 404")) throw error;
    }
  }
  const comparison = await client.api(`compare/${old.sha}...${next.sha}`, {
    maxBytes: 300_000,
  });
  if (
    comparison.status !== "ahead" ||
    !comparison.files?.length ||
    comparison.files.length > 10 ||
    comparison.total_commits !== comparison.commits?.length ||
    comparison.files.some((file) => !file.patch)
  )
    throw new Error("Versioned upstream comparison is incomplete or too large");
  const result = {
    ...identity,
    comparisonUrl: comparison.html_url,
    files: comparison.files.map(({ filename, status, patch }) => ({
      filename,
      status,
      patch,
    })),
  };
  if (Buffer.byteLength(JSON.stringify(result)) > maxBytes)
    throw new Error("Upstream source exceeds the context limit");
  return result;
}

export function changelogRange(content, before, after) {
  const headings = [
    ...content.matchAll(/^##[ \t]+\[?v?(\d+\.\d+\.\d+)(?=[\]\s]|$)[^\r\n]*$/gm),
  ];
  const start = headings.filter((entry) => entry[1] === after);
  const end = headings.filter((entry) => entry[1] === before);
  if (start.length !== 1 || end.length !== 1 || start[0].index >= end[0].index)
    throw new Error("Tool changelog lacks unique ordered version boundaries");
  const entries = headings.filter(
    (entry) => entry.index >= start[0].index && entry.index <= end[0].index,
  );
  for (let i = 1; i < entries.length; i++) {
    if (
      compareVersions(version(entries[i - 1][1]), version(entries[i][1])) <= 0
    )
      throw new Error("Tool changelog versions are not strictly descending");
  }
  const notes = content.slice(start[0].index, end[0].index).trim();
  // Include whole sections, including all intermediate prose/code blocks.
  if (/^##[ \t]+\[?v?\d+\.\d+\.\d+-/m.test(notes))
    throw new Error("Tool changelog range contains a prerelease section");
  return { notes, versions: entries.slice(0, -1).map((entry) => entry[1]) };
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
