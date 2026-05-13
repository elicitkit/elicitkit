import type { AskSet } from "@elicitkit/core";

export interface PrHunk {
  id: string;
  header?: string;
  before?: string;
  after: string;
}
export interface PrFile {
  path: string;
  hunks: PrHunk[];
}
export interface PrReviewInput {
  /** PR title — shown in the prompt for context. */
  title?: string;
  files: PrFile[];
  /** Drop the risk-rating ask. Default: included. */
  includeRisk?: boolean;
  /** Drop the blocking-concerns ask. Default: included. */
  includeConcerns?: boolean;
}

const META = { specVersion: "0.1.0", minTier: "tui" as const };

/**
 * The flagship pack: turn a pull request into one structured review
 * round-trip. The wedge (`ask_code_diff`, per hunk) plus the three things a
 * reviewer always also decides — overall verdict, risk, and any blocker.
 * Pure: returns a v0.1 AskSet, no I/O, no MCP — usable from any surface.
 */
export function buildPrReviewAskSet(input: PrReviewInput): AskSet {
  if (!input.files?.length) {
    throw new Error("pr-review: at least one file with hunks is required");
  }
  const ctx = input.title ? ` — ${input.title}` : "";

  const asks: AskSet["asks"] = [
    {
      id: "diff",
      type: "ask_code_diff",
      prompt: `Review these changes hunk by hunk${ctx}`,
      help: "Accept what should ship; reject anything you are not comfortable with.",
      spec: { granularity: "hunk", files: input.files },
      meta: META,
    },
    {
      id: "verdict",
      type: "ask_select",
      prompt: "Overall verdict on this PR?",
      spec: {
        options: [
          { id: "approve", label: "Approve", description: "ship it" },
          { id: "nits", label: "Approve with nits", description: "minor, non-blocking" },
          { id: "changes", label: "Request changes", description: "must address first" },
        ],
      },
      meta: META,
    },
  ];

  if (input.includeRisk !== false) {
    asks.push({
      id: "risk",
      type: "ask_rating",
      prompt: "How risky is merging this?",
      spec: { max: 5, labels: { min: "trivial", max: "high blast radius" } },
      meta: META,
    });
  }

  if (input.includeConcerns !== false) {
    asks.push({
      id: "concerns",
      type: "ask_text",
      prompt: "Any blocking concerns or follow-ups?",
      required: false,
      spec: { multiline: true, placeholder: "optional — markdown ok" },
      meta: META,
    });
  }

  return { specVersion: "0.1.0", asks };
}
