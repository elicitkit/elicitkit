import * as ajvMod from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv";
import { schema, SCHEMA_ID } from "@elicitkit/spec";

/**
 * ajv ships CJS; under TS NodeNext the default-export type is unreliable
 * (TS2351). We only use compile/getSchema, so we model exactly that and
 * normalise the default/namespace interop at runtime.
 */
type ValidateFn = ((data: unknown) => boolean) & {
  errors?: ErrorObject[] | null;
};
interface AjvLike {
  compile(s: object): ValidateFn;
  getSchema(key: string): ValidateFn | undefined;
}
type Ajv2020Ctor = new (opts?: { allErrors?: boolean; strict?: boolean }) => AjvLike;

const Ajv2020 = ((ajvMod as { default?: unknown }).default ??
  ajvMod) as unknown as Ajv2020Ctor;

const ajv = new Ajv2020({ allErrors: true, strict: false });
// Compiling the root schema registers its $id and all $defs with ajv.
ajv.compile(schema as object);

const askSetValidator = ajv.getSchema(SCHEMA_ID);
const answerValidator = ajv.getSchema(`${SCHEMA_ID}#/$defs/answer`);

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

function run(validator: ValidateFn | undefined, input: unknown): ValidationResult {
  if (!validator) {
    return { ok: false, errors: ["internal: schema validator not registered"] };
  }
  const ok = validator(input);
  if (ok) return { ok: true, errors: [] };
  const errors = (validator.errors ?? []).map((e: ErrorObject) =>
    `${e.instancePath || "(root)"} ${e.message ?? ""}`.trim(),
  );
  return { ok: false, errors };
}

/** Validate a full AskSet payload against the v0.1 spec schema. */
export function validateAskSet(input: unknown): ValidationResult {
  return run(askSetValidator, input);
}

/** Validate a single Answer payload against the v0.1 spec schema. */
export function validateAnswer(input: unknown): ValidationResult {
  return run(answerValidator, input);
}
