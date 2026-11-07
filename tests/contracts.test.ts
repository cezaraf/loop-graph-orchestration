import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { SCHEMAS, validateContract } from "../dist/contracts.js";
for (const name of Object.keys(SCHEMAS)) {
  const example = JSON.parse(
    fs.readFileSync(
      new URL(`../schemas/examples/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
  test(`contract ${name}: valid fixture`, () =>
    assert.doesNotThrow(() => validateContract(name, example.valid)));
  test(`contract ${name}: invalid fixture`, () =>
    assert.throws(() => validateContract(name, example.invalid)));
}
test("unknown contract and unsupported wire version fail closed", () => {
  assert.throws(() => validateContract("unknown", {}));
  const example = JSON.parse(
    fs.readFileSync(
      new URL("../schemas/examples/agent_result.json", import.meta.url),
      "utf8",
    ),
  );
  assert.throws(() =>
    validateContract("agent_result", {
      ...example.valid,
      schema_version: "99.0",
    }),
  );
});
