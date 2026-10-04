import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseLock } from "./policy.mjs";

export function evaluateAudit(advisories, lock, exceptions, now = Date.now()) {
  if (
    !advisories ||
    Array.isArray(advisories) ||
    typeof advisories !== "object"
  )
    throw new Error("Invalid audit response");
  if (!lock?.packages || !Array.isArray(exceptions))
    throw new Error("Invalid lockfile or audit exceptions");
  for (const exception of exceptions) {
    const expiry = Date.parse(exception.expires);
    if (!Number.isFinite(expiry) || now >= expiry)
      throw new Error(`Audit exception expired: ${exception.advisory}`);
    if (
      !exception.package ||
      !exception.version ||
      !exception.reason ||
      !/^https:\/\/github\.com\/advisories\/GHSA-[a-z0-9-]+$/.test(
        exception.advisory,
      )
    )
      throw new Error("Invalid audit exception");
  }
  const blocked = [];
  const accepted = [];
  for (const [name, findings] of Object.entries(advisories)) {
    if (!Array.isArray(findings) || findings.length === 0)
      throw new Error("Invalid audit findings");
    const entries = Object.entries(lock.packages).filter(
      ([path]) => path === name || path.endsWith(`/${name}`),
    );
    if (entries.length === 0)
      throw new Error("Advisory package missing from lockfile");
    for (const finding of findings) {
      if (
        !finding ||
        typeof finding.url !== "string" ||
        typeof finding.severity !== "string" ||
        typeof finding.title !== "string" ||
        typeof finding.vulnerable_versions !== "string"
      )
        throw new Error("Invalid advisory metadata");
      const exception = exceptions.find(
        (item) =>
          item.package === name &&
          item.advisory === finding.url &&
          item.severity === finding.severity &&
          entries.every(([, entry]) => entry[0] === `${name}@${item.version}`),
      );
      if (exception) accepted.push(exception);
      else
        blocked.push({
          package: name,
          advisory: finding.url,
          severity: finding.severity,
        });
    }
  }
  return { accepted, blocked };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    // Status 1 normally indicates advisories. Inspect both status and JSON;
    // a failed request, invalid payload or oversized response fails this gate.
    const processResult = spawnSync("bun", ["audit", "--json"], {
      encoding: "utf8",
      timeout: 60000,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ["ignore", "pipe", "inherit"],
    });
    if (
      processResult.error ||
      processResult.signal ||
      ![0, 1].includes(processResult.status)
    )
      throw new Error("Audit process failed");
    const advisories = JSON.parse(processResult.stdout);
    if (processResult.status === 1 && Object.keys(advisories).length === 0)
      throw new Error("Audit failed without advisory data");
    const result = evaluateAudit(
      advisories,
      parseLock(readFileSync("bun.lock", "utf8")),
      JSON.parse(
        readFileSync(".github/dependencies/audit-exceptions.json", "utf8"),
      ),
    );
    for (const exception of result.accepted) {
      const message = `Temporary audit exception: ${exception.package}@${exception.version} ${exception.advisory}; expires ${exception.expires}. ${exception.reason}`;
      console.warn(message);
      if (process.env.GITHUB_STEP_SUMMARY)
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n**${message}**\n`);
    }
    if (result.blocked.length) {
      console.error(JSON.stringify(result.blocked, null, 2));
      process.exitCode = 1;
    } else
      console.log(
        `Audit gate passed; ${result.accepted.length} temporary exception(s), no other advisories.`,
      );
  } catch {
    console.error(
      "Audit gate failed: audit unavailable, malformed, or exception expired. Run task audit and inspect the exception policy.",
    );
    process.exitCode = 1;
  }
}
