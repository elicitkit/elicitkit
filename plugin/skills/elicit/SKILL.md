---
name: elicit
description: Use when you need a real decision or structured input from the user — approvals, picking among options, ratings, numbers, dates, ranking priorities, or per-hunk code-change review. Prefer this over asking in free-form chat whenever the answer has a defined shape.
when_to_use: The user must choose, confirm, approve, rate, schedule, prioritize, or review changes; or you're about to ask 2+ related questions; or a wrong free-text answer would be costly to misparse.
---

# Eliciting structured input

When you need input from the user that has a **defined shape**, call the
`elicit` MCP tool (from the bundled `elicitkit` server) instead of asking in
prose. It renders an interactive prompt and returns **typed, validated**
answers — no parsing guesswork, and `declined`/`deferred` are explicit.

**You compose the AskSet. Never ask the user to.** The user prompts you in
plain language (e.g. *"review this PR"*, *"help me prioritize these
features"*, *"plan the deploy"*); from that natural-language intent **you**
pick the right `ask_*` types, fill in the `spec` fields, and call `elicit`
with the AskSet. The user does not author JSON, does not see the AskSet,
does not pick types — they only answer the rich question(s) the host
renders.

**Ask the minimum number of well-targeted questions.** Treat the user's
attention as the budget: 3–8 sharp, decision-bearing questions is
usually enough; 20 indirect ones is almost never the right answer.
Before adding each Ask, ask yourself "would the wrong answer here
actually change what I do next?" — if not, drop it. Prefer one
high-leverage `ask_select` over four redundant `ask_text` follow-ups.
Never instruct the user to write or edit JSON.

## How

Call `elicit` with one argument, `askSet`:

```json
{ "specVersion": "0.1.0", "asks": [ <one or more Ask objects> ] }
```

Every Ask: `{ "id", "type", "prompt", "spec", "meta": { "specVersion": "0.1.0", "minTier": "tui" } }`
(`help` optional; `required` defaults true; set `"required": false` to allow skip).

Pick the **type** that matches the answer's shape:

| Need | type | `spec` essentials | value |
|---|---|---|---|
| free text | `ask_text` | `{ multiline?, placeholder? }` | string |
| one of N / many of N | `ask_select` | `{ options:[{id,label,description?}], multiple?, min?, max? }` | id or id[] |
| yes/no (with stakes) | `ask_confirm` | `{ affirm?, deny?, consequence? }` | boolean |
| accept/reject code changes | `ask_code_diff` | `{ files:[{path,hunks:[{id,header?,before?,after}]}] }` | `{accepted:[],rejected:[]}` |
| a quantity | `ask_number` | `{ min?, max?, step?, unit?, integer? }` | number |
| a 1–N score | `ask_rating` | `{ max?, icon?, labels? }` | integer |
| a value in a range | `ask_slider` | `{ min, max, step?, unit? }` | number |
| a date/time | `ask_date` | `{ min?, max?, time? }` | ISO string |
| order by preference | `ask_rank` | `{ items:[{id,label,description?}] }` | ids in ranked order |

## Two tools — pick by intent

- **`elicit`** — the interactive ask (default). The server picks the best
  tier the client can render; in a terminal that's a native prompt.
- **`elicit_render`** — when the user wants **HTML / a file / a
  questionnaire / a shareable or standalone panel** (e.g. "give me it as
  HTML", "make an HTML questionnaire", "save the questionnaire", "send me
  a page"). One-shot deliverable, **not** an interactive round:
  1. call `elicit_render`,
  2. **save the HTML to a `.html` file** (file-writing tool; never dump it
     into chat),
  3. give the user the file path, and **STOP**.
  Do **not** also call `elicit`. Do **not** wait for, prompt for, or
  poll for answers. Do **not** treat a round as pending. Only if the user
  *later, on their own* pastes back the panel's JSON payload may you
  forward it verbatim to `elicit_submit` — it is optional and
  user-initiated, never something you solicit here.

## Rules

- **Do not fabricate answers.** They come back from the tool result
  (`structuredContent.answers`), inline for the elicitation tier. Wait for it.
- Batch related questions into one `askSet` (one round-trip) rather than many
  separate calls.
- If the result has `_meta.elicitkit.token` (panel/tui tiers), the user's
  answers arrive via the `elicit_submit` tool — for the `url` tier the user
  pastes a JSON payload back; forward it verbatim to `elicit_submit`.
- Honor `declined`/`deferred` — the user choosing not to answer is a valid,
  first-class outcome; don't loop or coerce.
- Don't pass `supportedTiers` unless you actually know the host's UI
  capabilities — the server detects them itself and picks the best tier.
