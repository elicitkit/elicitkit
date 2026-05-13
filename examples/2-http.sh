#!/usr/bin/env bash
# DEMO 2 — HTTP surface. The asker and the answerer are on DIFFERENT machines,
# connected only by a web link (CI / n8n / a backend job → a human in a browser).
#
#   bash examples/2-http.sh                 # rich survey
#   bash examples/2-http.sh examples/sample-askset.json
#
set -euo pipefail
cd "$(dirname "$0")/.."
ASKSET="${1:-examples/survey-askset.json}"
PORT=8791
BASE="http://127.0.0.1:$PORT"

PORT=$PORT node packages/http/dist/bin.js >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
sleep 1

echo "── 1. The robot (CI) POSTs the survey, gets a SIGNED one-time link ──"
RESP=$(curl -s -XPOST "$BASE/elicit" -H content-type:application/json \
  --data "$(node examples/_demo-payload.mjs elicit "$ASKSET")")
node -e 'const o=JSON.parse(process.argv[1]);console.log("  token   :",o.token.slice(0,28)+"…  (id.expiry.HMAC)");console.log("  expires :",o.expiresInMs+"ms");console.log("  panelUrl:",o.panelUrl,"  ← a human opens THIS in a browser")' "$RESP"
TOKEN=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).token)' "$RESP")

echo
echo "── 2. The human answers in the browser. (Here: simulated submission.) ──"
ANSWERS=$(node examples/_demo-payload.mjs answers "$ASKSET" "$TOKEN")
CODE=$(curl -s -o /tmp/ek-sub.json -w '%{http_code}' -XPOST "$BASE/elicit/submit" -H content-type:application/json -d "$ANSWERS")
echo "  submit HTTP $CODE  — validated answers the robot now reads back:"
node -e 'const o=require("/tmp/ek-sub.json");console.log("  "+JSON.stringify(o.answers.map(a=>({id:a.id,status:a.status,value:a.value}))))'

echo
echo "── 3. Security envelope (why this is safe to put behind a Slack link) ──"
R1=$(curl -s -o /dev/null -w '%{http_code}' -XPOST "$BASE/elicit/submit" -H content-type:application/json -d "$ANSWERS")
echo "  replay same link      → HTTP $R1  (one-time: round consumed)"
R2=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/r/${TOKEN%???}AAA")
echo "  tampered link         → HTTP $R2  (bad HMAC signature)"
R3=$(curl -s -o /dev/null -w '%{http_code}' -XPOST "$BASE/elicit/submit" -H content-type:application/json -H 'origin: https://evil.example' -d "$ANSWERS")
echo "  cross-origin browser  → HTTP $R3  (origin not allowed)"
