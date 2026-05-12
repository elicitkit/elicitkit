export { validateAskSet, validateAnswer } from "./validate.js";
export type { ValidationResult } from "./validate.js";
export { validateAnswers, valueError } from "./answers.js";
export type { AnswersResult } from "./answers.js";
export { signToken, verifyToken, newSecret, newRoundId } from "./sign.js";
export type { VerifyResult } from "./sign.js";

// Re-export the canonical model so consumers depend only on @elicitkit/core.
export type {
  Ask,
  AskSet,
  Answer,
  AnswerStatus,
  Tier,
  AskText,
  AskSelect,
  AskConfirm,
  AskCodeDiff,
  AskNumber,
  AskRating,
  AskSlider,
  AskDate,
  AskRank,
  AskColor,
  SelectOption,
  SelectDisplay,
  RankItem,
  DiffFile,
  DiffHunk,
} from "@elicitkit/spec";
export { SPEC_VERSION, SCHEMA_ID } from "@elicitkit/spec";
