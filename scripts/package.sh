#!/bin/sh
# Build the Chrome Web Store zip: only what the extension needs at runtime.
# Dev harnesses, tests, docs and this script stay out of the bundle.
set -eu
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./manifest.json').version")
OUT="dist/nst-attendance-${VERSION}.zip"
mkdir -p dist
rm -f "$OUT"
zip -qr "$OUT" manifest.json icons src \
  -x 'src/**/.DS_Store' -x '**/.DS_Store'
echo "built $OUT"
unzip -Z1 "$OUT" | sed 's/^/  /'
