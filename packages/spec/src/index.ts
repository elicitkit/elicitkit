import { createRequire } from "node:module";

export * from "./types.js";

export const SPEC_VERSION = "0.1.0";
export const SCHEMA_ID = "https://elicitkit.com/schema/v0.1";

/**
 * The canonical JSON Schema, loaded at runtime via createRequire.
 * Resolved relative to dist/index.js → ../schema (shipped via package "files"),
 * which avoids ESM JSON import-attribute pitfalls on Node 20.
 */
const require = createRequire(import.meta.url);
export const schema = require("../schema/elicitkit-v0.1.schema.json") as Record<
  string,
  unknown
>;
