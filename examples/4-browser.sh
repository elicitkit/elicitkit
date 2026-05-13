#!/usr/bin/env bash
# DEMO 4 — the actual panel a human sees (the 'url' tier, self-contained).
# Renders the sample AskSet to a standalone HTML file and opens it.
#
#   bash examples/4-browser.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."
ASKSET="${1:-examples/survey-askset.json}"

OUT="${TMPDIR:-/tmp}/elicitkit-panel.html"
node packages/cli/dist/bin.js render "$ASKSET" --out "$OUT"
echo "panel written: $OUT"

# open it (macOS `open`, Linux `xdg-open`) — harmless if neither exists
( open "$OUT" 2>/dev/null || xdg-open "$OUT" 2>/dev/null || true )
echo "Toggle Accept/Reject per hunk, fill it in, hit Submit → it shows the"
echo "exact JSON an agent forwards to elicit_submit. Copy-paste channel, no"
echo "server needed (this is the standalone 'url' tier)."
