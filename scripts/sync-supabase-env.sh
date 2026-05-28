#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env.local"

die() {
  printf "error: %s\n" "$*" >&2
  exit 1
}

ensure_env_file() {
  if [[ -f "$ENV_FILE" ]]; then
    return
  fi

  cp "$ROOT_DIR/.env.example" "$ENV_FILE"
}

strip_quotes() {
  local value="$1"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf "%s" "$value"
}

env_value() {
  local key value

  for key in "$@"; do
    value="$(
      printf "%s\n" "$SUPABASE_ENV" \
        | awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }'
    )"

    if [[ -n "$value" ]]; then
      strip_quotes "$value"
      return
    fi
  done
}

set_env_var() {
  local key="$1"
  local value="$2"
  local tmp

  tmp="$(mktemp)"

  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    $0 ~ "^" key "=" {
      print key "=" value
      found = 1
      next
    }
    { print }
    END {
      if (!found) {
        print key "=" value
      }
    }
  ' "$ENV_FILE" > "$tmp"

  mv "$tmp" "$ENV_FILE"
}

ensure_env_file

SUPABASE_ENV="$(
  bunx supabase status -o env \
    --override-name api.url=NEXT_PUBLIC_SUPABASE_URL \
    --override-name auth.anon_key=NEXT_PUBLIC_SUPABASE_ANON_KEY \
    --override-name db.url=DATABASE_URL
)" || die "Supabase is not running. Start it with task db:start."

supabase_url="$(env_value NEXT_PUBLIC_SUPABASE_URL API_URL SUPABASE_URL)"
supabase_anon_key="$(env_value NEXT_PUBLIC_SUPABASE_ANON_KEY ANON_KEY SUPABASE_ANON_KEY)"
database_url="$(env_value DATABASE_URL DB_URL POSTGRES_URL)"

[[ -n "$supabase_url" ]] || die "Could not read the local Supabase API URL."
[[ -n "$supabase_anon_key" ]] || die "Could not read the local Supabase anon key."
[[ -n "$database_url" ]] || die "Could not read the local Supabase database URL."

set_env_var NEXT_PUBLIC_SUPABASE_URL "$supabase_url"
set_env_var NEXT_PUBLIC_SUPABASE_ANON_KEY "$supabase_anon_key"
set_env_var DATABASE_URL "$database_url"

printf "Updated .env.local with local Supabase values.\n"
