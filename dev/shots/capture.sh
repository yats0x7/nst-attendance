#!/bin/sh
# Capture the Chrome Web Store tiles at the exact 1280x800 the store requires.
#
# Run `npm run serve` first. Output lands in docs/screenshots/store/.
# Harness only; nothing here ships inside the extension.
set -eu
cd "$(dirname "$0")/../.."

CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
BASE=${BASE:-http://127.0.0.1:8731}
OUT=docs/screenshots/store
mkdir -p "$OUT"

for tile in 1 2 3 4 5; do
  dark=""
  # The privacy tile is the one that reads better dark; the rest match the
  # portal, which is light.
  [ "$tile" = 5 ] && dark="&dark=1"
  "$CHROME" --headless --disable-gpu --hide-scrollbars \
    --force-color-profile=srgb --window-size=1280,800 \
    --virtual-time-budget=4000 \
    --screenshot="$OUT/tile-$tile.png" \
    "$BASE/dev/shots/store.html?tile=$tile$dark" >/dev/null 2>&1
  printf '%s  %s\n' "$OUT/tile-$tile.png" "$(sips -g pixelWidth -g pixelHeight "$OUT/tile-$tile.png" | awk '/pixel/{printf "%sx", $2}' | sed 's/x$//')"
done

# The small promo tile beside store search results.
"$CHROME" --headless --disable-gpu --hide-scrollbars \
  --force-color-profile=srgb --window-size=440,280 \
  --virtual-time-budget=4000 \
  --screenshot="$OUT/promo-440x280.png" \
  "$BASE/dev/shots/promo.html" >/dev/null 2>&1
printf '%s  %s\n' "$OUT/promo-440x280.png" "$(sips -g pixelWidth -g pixelHeight "$OUT/promo-440x280.png" | awk '/pixel/{printf "%sx", $2}' | sed 's/x$//')"
