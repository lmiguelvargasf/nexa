#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
OS_NAME="$(uname -s)"

log() {
  printf "\n==> %s\n" "$*"
}

warn() {
  printf "warning: %s\n" "$*" >&2
}

die() {
  printf "error: %s\n" "$*" >&2
  exit 1
}

ensure_supported_os() {
  case "$OS_NAME" in
    Darwin | Linux) ;;
    *) die "This setup script currently supports macOS and Linux only." ;;
  esac
}

ensure_mise() {
  if command -v mise >/dev/null 2>&1; then
    return
  fi

  if [[ "$OS_NAME" == "Darwin" ]] && command -v brew >/dev/null 2>&1; then
    log "Installing mise with Homebrew"
    brew install mise
    hash -r
  fi

  if ! command -v mise >/dev/null 2>&1; then
    cat >&2 <<'EOF'
error: mise is required but was not found.

Install mise, then run this script again:
  curl https://mise.run | sh

On macOS with Homebrew:
  brew install mise
EOF
    exit 1
  fi
}

create_env_file() {
  if [[ -f .env.local ]]; then
    log "Keeping existing .env.local"
    return
  fi

  log "Creating .env.local from .env.example"
  cp .env.example .env.local
}

check_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    warn "Docker is not installed. Install Docker before using local Supabase."
    return
  fi

  if ! docker info >/dev/null 2>&1; then
    warn "Docker is installed but not running. Start Docker before using local Supabase."
  fi
}

main() {
  cd "$ROOT_DIR"

  ensure_supported_os
  ensure_mise

  log "Installing pinned tools from mise.toml"
  mise install --yes --locked

  create_env_file

  log "Installing Bun dependencies"
  mise exec -- task install

  log "Installing Playwright browsers"
  mise exec -- task playwright:install

  check_docker

  log "Setup complete"
  printf "Start the app with: mise exec -- task dev\n"
}

main "$@"
