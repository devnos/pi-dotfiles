#!/usr/bin/env bash
# Restore pi agent config on a fresh machine.
# Usage:  ./install.sh

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
PI_AGENT_DIR="${PI_AGENT_DIR:-$HOME/.pi/agent}"

echo "==> Target: $PI_AGENT_DIR"
mkdir -p "$PI_AGENT_DIR/extensions" "$PI_AGENT_DIR/wierd-statusline" "$PI_AGENT_DIR/npm"

# --- settings.json (clean) ----------------------------------------------
install_file() {
  local src="$1" dst="$2"
  mkdir -p "$(dirname "$dst")"
  cp "$REPO_DIR/$src" "$dst"
  echo "  + $dst"
}

echo "==> Copying config files"
install_file agent/settings.json        "$PI_AGENT_DIR/settings.json"
install_file agent/models.json          "$PI_AGENT_DIR/models.json"
install_file agent/extensions/prompt-arrow.js "$PI_AGENT_DIR/extensions/prompt-arrow.js"
install_file agent/wierd-statusline/events.json "$PI_AGENT_DIR/wierd-statusline/events.json"
install_file agent/AGENTS.md            "$PI_AGENT_DIR/AGENTS.md"

# --- mcp.json (rendered from template) ---------------------------------
echo "==> Rendering mcp.json from template"
sed "s|\${PI_AGENT_DIR}|$PI_AGENT_DIR|g" \
  "$REPO_DIR/agent/mcp.json.template" > "$PI_AGENT_DIR/mcp.json"
echo "  + $PI_AGENT_DIR/mcp.json"

# --- npm dependencies ---------------------------------------------------
echo "==> Installing npm dependencies (this can take a minute)"
install_file agent/npm/package.json     "$PI_AGENT_DIR/npm/package.json"
install_file agent/npm/package-lock.json "$PI_AGENT_DIR/npm/package-lock.json"
( cd "$PI_AGENT_DIR/npm" && npm install --no-audit --no-fund )

# --- url-based packages from settings.json ------------------------------
# Some packages are referenced by URL in settings.json (e.g. themes on
# GitHub). `pi install` clones them into ~/.pi/agent/git/...; we replay
# those here so a fresh machine ends up identical to the source.
echo "==> Installing URL-based pi packages"
if command -v pi >/dev/null 2>&1; then
  pi_install_url() {
    local pkg="$1"
    case "$pkg" in
      http://*|https://*|git:*) pi install "$pkg" >/dev/null 2>&1 || echo "    ! failed: $pkg" ;;
    esac
  }
  while IFS= read -r pkg; do
    [[ -z "$pkg" ]] && continue
    pi_install_url "$pkg"
  done < <(sed -n '/"packages"/,/]/p' "$PI_AGENT_DIR/settings.json" \
    | sed -E 's/^[[:space:]]*"([^"]+)".*/\1/')
else
  echo "    (skipping — 'pi' CLI not in PATH)"
fi

# --- auth.json (must be created manually) -------------------------------
echo
echo "==> Reminder: create $PI_AGENT_DIR/auth.json manually"
echo "    Format:"
echo '    { "minimax": { "type": "api_key", "key": "sk-cp-..." } }'
echo
echo "Done. Run 'pi' to start."
