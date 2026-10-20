#!/bin/sh
# Build the release tarball: dist/t3-sdlc.tar.gz (the app layout ~/.t3-sdlc/app expects) and dist/install.sh.
# Usage: scripts/pack.sh [version]   version defaults to package.json's; a leading "v" is dropped.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
VERSION=${1:-}
VERSION=${VERSION#v}
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

cd "$ROOT"
cp -R roles policy skills docs examples LICENSE README.md package.json "$STAGE/"
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
echo "dist/t3-sdlc.tar.gz ($(node -p "require('$STAGE/package.json').version"))"
