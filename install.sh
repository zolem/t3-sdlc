#!/bin/sh
# Install or update t3-sdlc.
#   Public repo:  curl -fsSL https://github.com/zolem/t3-sdlc/releases/latest/download/install.sh | sh
#   Private repo: gh release download --repo zolem/t3-sdlc --pattern install.sh --output - | sh
# Everything lands in ~/.t3-sdlc, plus skill links in ~/.agents/skills and ~/.claude/skills.
# Remove it all with: ~/.t3-sdlc/bin/t3-sdlc uninstall
#
# Env: T3_SDLC_VERSION=v0.1.0 (default: latest)  T3_SDLC_REPO=owner/repo  T3_SDLC_TARBALL=<local file>
set -eu
REPO="${T3_SDLC_REPO:-zolem/t3-sdlc}"
VERSION="${T3_SDLC_VERSION:-}"
ASSET=t3-sdlc.tar.gz

fail() { printf 't3-sdlc install: %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || fail "needs Node.js >= 22 (https://nodejs.org)."
major=$(node -p 'process.versions.node.split(".")[0]')
[ "$major" -ge 22 ] || fail "needs Node.js >= 22 (found $(node -v))."
command -v git >/dev/null 2>&1 || fail "needs git."
command -v tar >/dev/null 2>&1 || fail "needs tar."

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

if [ -n "${T3_SDLC_TARBALL:-}" ]; then
  cp "$T3_SDLC_TARBALL" "$tmp/$ASSET"
else
  if [ -n "$VERSION" ]; then
    url="https://github.com/$REPO/releases/download/$VERSION/$ASSET"
  else
    url="https://github.com/$REPO/releases/latest/download/$ASSET"
  fi
  if ! curl -fsSL "$url" -o "$tmp/$ASSET" 2>/dev/null; then
    command -v gh >/dev/null 2>&1 || fail "could not download $url. If $REPO is private, install the GitHub CLI and run: gh auth login"
    # shellcheck disable=SC2086
    gh release download $VERSION --repo "$REPO" --pattern "$ASSET" --output "$tmp/$ASSET" \
      || fail "could not download $ASSET from $REPO (tried $url and gh)."
  fi
fi

mkdir "$tmp/app"
tar -xzf "$tmp/$ASSET" -C "$tmp/app"
node "$tmp/app/factory/bin/t3-sdlc.js" install --from-dir "$tmp/app"
