#!/usr/bin/env bash
# DEMO 1 — CLI surface (the shell-out reach: no AI, no server).
#
# WHAT IT IS: a normal program (this bash script) needs a structured decision
# from a human. It runs `elicitkit ask`, the human answers IN THE TERMINAL,
# and the script gets back machine-readable JSON it can act on. No AI, no
# browser, no network. Think: a deploy script, a git hook, a Makefile.
#
#   bash examples/1-cli.sh                 # uses the rich survey
#   bash examples/1-cli.sh examples/sample-askset.json
#
set -euo pipefail
cd "$(dirname "$0")/.."
ASKSET="${1:-examples/survey-askset.json}"

echo "── A script asks the developer (survey: text · select · confirm · diff) ──"
echo "   Try it yourself interactively:  node packages/cli/dist/bin.js ask $ASKSET"
echo

# Pre-canned answers so the demo runs hands-free. Order = question order:
#   title risk envs migrate  3 hunks  number rating slider date rank color notes
ANSWERS=$'Spring hardening\n2\n1,3\ny\ny\nn\ny\n4\n5\n25\n2026-06-01\n2,1,3\n1\n\n'

OUT=$(printf '%s' "$ANSWERS" | node packages/cli/dist/bin.js ask "$ASKSET")

echo
echo "── stdout: pure JSON — exactly what the calling script consumes ──"
echo "$OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(JSON.parse(s),null,2)))'

echo
echo 'Real use:  DECISION=$(… | jq -r ".[] | select(.id==\"migrate\").value")'
echo '           [ "$DECISION" = "true" ] && npm run db:migrate'
