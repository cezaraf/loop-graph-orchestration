import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchema, ValidateFunction } from "ajv";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { PolicyError } from "./util.js";
const root = fileURLToPath(new URL("../schemas/", import.meta.url));
export const SCHEMAS: Record<string, AnySchema> = Object.fromEntries(
  fs
    .readdirSync(root)
    .filter((n) => n.endsWith(".schema.json"))
    .map((n) => [
      n.replace(".schema.json", ""),
      JSON.parse(fs.readFileSync(path.join(root, n), "utf8")) as AnySchema,
    ]),
);
const cache = new Map<string, ValidateFunction>();
export function validateContract<T = unknown>(name: string, value: unknown): T {
  const schema = SCHEMAS[name];
  if (!schema) throw new PolicyError(`Unknown contract: ${name}`);
  let check = cache.get(name);
  if (!check) {
    check = new Ajv2020({
      strict: false,
      allErrors: true,
      validateFormats: false,
    }).compile(schema);
    cache.set(name, check);
  }
  if (!check(value))
    throw new PolicyError(`Invalid ${name}: ${JSON.stringify(check.errors)}`);
  return value as T;
}
export function validateSchema(schema: AnySchema, value: unknown): string[] {
  function refs(v: unknown): void {
    if (Array.isArray(v)) {
      v.forEach(refs);
      return;
    }
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (
          (k === "$ref" || k === "$dynamicRef") &&
          (typeof x !== "string" || !x.startsWith("#"))
        )
          throw new PolicyError("External JSON Schema refs disabled");
        refs(x);
      }
    }
  }
  refs(schema);
  const check = new Ajv2020({
    strict: true,
    strictTypes: false,
    allowUnionTypes: true,
    allErrors: true,
    validateFormats: false,
  }).compile(schema);
  return check(value)
    ? []
    : (check.errors ?? []).map((e) => `${e.instancePath}: ${e.message}`);
}
