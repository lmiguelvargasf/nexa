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
    if ! command -v curl >/dev/null 2>&1; then
      die "curl is required to install mise."
    fi

    log "Installing mise with the official installer"
    curl -fsSL https://mise.run | sh
    export PATH="$HOME/.local/bin:$PATH"
    hash -r
  fi

  if ! command -v mise >/dev/null 2>&1; then
    die "mise was installed but is not available on PATH."
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

activate_mise() {
  log "Activating mise for setup"
  eval "$(mise activate bash)"
  hash -r
}

check_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    warn "Docker is not installed. Install Docker before running task dev."
    return
  fi

  if ! docker info >/dev/null 2>&1; then
    warn "Docker is installed but not running. Start Docker before running task dev."
  fi
}

main() {
  cd "$ROOT_DIR"

  ensure_supported_os
  ensure_mise

  log "Installing pinned tools from mise.toml"
  mise install --yes --locked
  activate_mise

  create_env_file

  log "Installing Bun dependencies"
  task install

  log "Installing Playwright browsers"
  task playwright:install

  log "Installing Git hooks"
  task hooks:install

  check_docker

  log "Setup complete"
  printf "Start the local stack with: task dev\n"
}

main "$@"
