#!/usr/bin/env node
// Operator-side only. Possession of an HMAC key does not prove human identity.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { ApprovalAuthority, atomicJson, now } from "../dist/index.js";
const args = Object.fromEntries(
  Array.from({ length: Math.floor((process.argv.length - 2) / 2) }, (_, i) => [
    process.argv[2 + i * 2],
    process.argv[3 + i * 2],
  ]),
);
for (const k of ["--key", "--project", "--request", "--output", "--actor"])
  if (!args[k]) throw new Error(`Missing ${k}`);
if (!process.stdin.isTTY)
  throw new Error(
    "Use an interactive operator terminal; workers cannot approve",
  );
let request = JSON.parse(fs.readFileSync(args["--request"], "utf8"));
request = request.approval_request ?? request.gate?.approval_request ?? request;
console.log(JSON.stringify(request, null, 2));
const ui = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
try {
  const expected = "AUTORIZAR " + request.binding;
  if ((await ui.question(`After reviewing, type ${expected}: `)) !== expected)
    throw new Error("Not authorized");
  const token = new ApprovalAuthority(
    path.resolve(args["--key"]),
    path.resolve(args["--project"]),
  ).sign({ ...request, actor: args["--actor"], expires_at: now() + 600 });
  atomicJson(path.resolve(args["--output"]), token);
} finally {
  ui.close();
}
