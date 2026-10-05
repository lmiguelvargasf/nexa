import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "nexa-db-smoke-"));
const run = (...args) =>
  execFileSync(
    "bunx",
    ["--no-install", "supabase", ...args, "--workdir", directory],
    { stdio: "inherit" },
  );
let configured = false;
try {
  run("init");
  const config = join(directory, "supabase/config.toml");
  writeFileSync(
    config,
    readFileSync(config, "utf8")
      .replace(
        /^project_id = .*$/m,
        `project_id = "${directory.split("/").at(-1)}"`,
      )
      .replace(/^port = 54322$/m, "port = 56422"),
  );
  configured = true;
  run("migration", "new", "startup_smoke");
  const migration = readdirSync(join(directory, "supabase/migrations"))[0];
  writeFileSync(
    join(directory, "supabase/migrations", migration),
    `
create schema startup_smoke;
create table startup_smoke.records (id integer primary key, value text not null);
create function startup_smoke.record_count() returns bigint language plpgsql as $$
begin
  return (select count(*) from startup_smoke.records);
end;
$$;
`,
  );
  writeFileSync(
    join(directory, "supabase/seed.sql"),
    "insert into startup_smoke.records values (1, 'seeded');\n",
  );
  writeFileSync(
    join(directory, "supabase/startup.sql"),
    `begin;
create extension if not exists pgtap with schema extensions;
set search_path = startup_smoke, extensions, public;
select plan(3);
select has_table('startup_smoke', 'records', 'migration applied');
select is((select value from startup_smoke.records where id = 1), 'seeded', 'seed applied');
select is(startup_smoke.record_count(), 1::bigint, 'PL/pgSQL function works');
select * from finish();
rollback;
`,
  );
  run("db", "start");
  const projectId = directory.split("/").at(-1);
  const containers = execFileSync("docker", ["ps", "--format", "{{.Names}}"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter((name) => name.endsWith(`_${projectId}`));
  assert.deepEqual(
    containers,
    [`supabase_db_${projectId}`],
    "only Postgres should be running",
  );
  run("db", "query", "--local", "select startup_smoke.record_count();");
  run(
    "db",
    "lint",
    "--local",
    "--schema",
    "startup_smoke",
    "--fail-on",
    "warning",
  );
  run("test", "db", "--local", join(directory, "supabase/startup.sql"));
  const expectFailure = (...args) => {
    const result = spawnSync(
      "bunx",
      ["--no-install", "supabase", ...args, "--workdir", directory],
      { stdio: "inherit" },
    );
    if (result.error) throw result.error;
    assert.ok(
      Number.isInteger(result.status) && result.status !== 0,
      "invalid SQL must fail validation",
    );
  };
  const failingTest = join(directory, "supabase/failure.pg");
  writeFileSync(
    failingTest,
    "begin; select plan(1); select ok(false, 'intentional failure'); select * from finish(); rollback;\n",
  );
  expectFailure("test", "db", "--local", failingTest);
  run(
    "db",
    "query",
    "--local",
    `create function startup_smoke.broken() returns integer language plpgsql as $$ begin return missing_column; end; $$;`,
  );
  expectFailure(
    "db",
    "lint",
    "--local",
    "--schema",
    "startup_smoke",
    "--fail-on",
    "warning",
  );
  console.log(
    "Startup, seed, SQL query, pgTAP, and lint contracts passed, including failure propagation.",
  );
} finally {
  try {
    if (configured) run("stop", "--no-backup");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
