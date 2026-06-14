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

# Themes: bundle all *.json from agent/themes/ into ~/.pi/agent/themes/.
# These are loaded as global defaults by pi's resource-loader BEFORE
# the URL-package loop runs, so a 'theme' value in settings.json will
# always be found on startup (no silent dark-fallback race).
if compgen -G "$REPO_DIR/agent/themes/*.json" >/dev/null; then
  echo "==> Copying bundled themes"
  mkdir -p "$PI_AGENT_DIR/themes"
  install_file agent/themes/*.json "$PI_AGENT_DIR/themes/" 2>/dev/null \
    || cp -n "$REPO_DIR"/agent/themes/*.json "$PI_AGENT_DIR/themes/"
fi

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
# If `pi install` fails (e.g. dev postinstall hooks like lefthook), fall
# back to a plain `git clone` into the same target directory.
echo "==> Installing URL-based pi packages"
pi_install_url() {
  local pkg="$1"
  case "$pkg" in
    http://*|https://*|git:*)
      if pi install "$pkg" >/dev/null 2>&1; then
        return 0
      fi
      echo "    ! pi install failed for $pkg — trying git clone"
      if [[ "$pkg" =~ ^https?://github\.com/([^/]+)/([^/]+?)(\.git)?/?$ ]]; then
        local owner="${BASH_REMATCH[1]}"
        local repo="${BASH_REMATCH[2]}"
        local dest="$PI_AGENT_DIR/git/github.com/$owner/$repo"
        [[ -d "$dest" ]] || git clone --depth 1 "$pkg" "$dest" >/dev/null 2>&1 \
          || echo "    ! git clone also failed: $pkg"
      else
        echo "    ! no git fallback for non-GitHub URL: $pkg"
      fi
      ;;
  esac
}
if command -v pi >/dev/null 2>&1; then
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
