#!/bin/sh
# Build the release assets:
#   dist/t3-sdlc.tar.gz      the app layout ~/.t3-sdlc/app expects (and the source INSTALL.md copies skills from)
#   dist/install.sh          the factory installer for engineers
#   dist/INSTALL.md          the one-line, agent-driven install for every role
#   dist/skill-<name>.zip    each role-kit skill as an uploadable zip (Claude desktop and claude.ai)
# Usage: scripts/pack.sh [version]   version defaults to package.json's; a leading "v" is dropped.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
VERSION=${1:-}
VERSION=${VERSION#v}
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

cd "$ROOT"
cp -R roles policy skills kit docs examples LICENSE README.md INSTALL.md package.json "$STAGE/"
mkdir -p "$STAGE/factory"
cp -R factory/bin factory/src factory/package.json "$STAGE/factory/"
cp factory/package-lock.json "$STAGE/factory/"
# Runtime dependencies (the explainer's diagram renderer) ship inside the tarball.
(cd "$STAGE/factory" && npm ci --omit=dev --no-audit --no-fund --silent)
if [ -n "$VERSION" ]; then
  node -e 'const f=process.argv[1],p=JSON.parse(require("fs").readFileSync(f));p.version=process.argv[2];require("fs").writeFileSync(f,JSON.stringify(p,null,2)+"\n")' "$STAGE/package.json" "$VERSION"
fi

mkdir -p dist
tar -czf dist/t3-sdlc.tar.gz -C "$STAGE" .
cp install.sh dist/install.sh
cp INSTALL.md dist/INSTALL.md
rm -f dist/skill-*.zip
for s in $(node -p "require('./kit/roles.json').kitSkills.join(' ')"); do
  (cd skills && zip -qr "$ROOT/dist/skill-$s.zip" "$s" -x '*.DS_Store')
done
echo "dist/t3-sdlc.tar.gz ($(node -p "require('$STAGE/package.json').version"))"
