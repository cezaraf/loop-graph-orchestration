// Trusted deterministic offline oracles, separate from Spring/browser integration.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
const ROOT = process.cwd(),
  read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8"),
  json = (p) => JSON.parse(read(p));
const source = "backend/src/main/java/dev/lgo/example/";
function run(argv) {
  const r = spawnSync(argv[0], argv.slice(1), {
    encoding: "utf8",
    timeout: 15000,
    shell: false,
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.error) throw r.error;
  assert.equal(r.status, 0, "Java oracle failed");
}
function backend() {
  assert.ok(
    read(source + "ApiAdvice.java").includes("NotFoundPolicy.status()"),
    "REST advice must use tested policy",
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lgo-java-oracle-"));
  try {
    const check = path.join(dir, "PolicyCheck.java");
    fs.writeFileSync(
      check,
      'import dev.lgo.example.NotFoundPolicy; public class PolicyCheck { public static void main(String[] a) { int actual=NotFoundPolicy.status(); if(actual!=404) throw new AssertionError("Expected HTTP 404 Actual HTTP "+actual); System.out.println("HTTP 404 policy PASS"); }}',
    );
    run([
      "java",
      "com.sun.tools.javac.Main",
      "-d",
      dir,
      path.join(ROOT, source, "NotFoundPolicy.java"),
      check,
    ]);
    run(["java", "-cp", dir, "PolicyCheck"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const controller = read(source + "TipoExameController.java");
  for (const method of [
    "GetMapping",
    "PostMapping",
    "PutMapping",
    "DeleteMapping",
  ])
    assert.ok(
      controller.includes("@" + method),
      `CRUD method absent: ${method}`,
    );
  assert.ok(controller.includes("@Valid"));
  assert.ok(
    read(source + "TipoExameRepository.java").includes("JpaRepository"),
  );
  console.log(
    "backend source and executable Java policy PASS; full Spring tests separate",
  );
}
function frontend() {
  const p = json("frontend/package.json");
  assert.ok(p.dependencies["@angular/core"] && p.dependencies.primeng);
  const s = read("frontend/src/app.component.ts");
  for (const value of [
    "p-table",
    "p-button",
    "pInputText",
    "this.http.post",
    "this.http.put",
    "this.http.delete",
    "encodeURIComponent",
    "form.invalid",
  ])
    assert.ok(s.includes(value), `frontend contract missing: ${value}`);
  assert.ok(!s.includes("[innerHTML]"));
  console.log("frontend source architecture PASS; browser E2E separate");
}
function contract() {
  const data = json("contract/openapi.json");
  assert.equal(data.openapi, "3.1.0");
  const p = data.paths["/api/tipos-exame/{codigo}"];
  for (const status of ["200", "404"]) assert.ok(p.get.responses[status]);
  assert.ok(p.delete.responses["204"]);
  for (const status of ["201", "400", "409"])
    assert.ok(data.paths["/api/tipos-exame"].post.responses[status]);
  console.log("OpenAPI deterministic contract PASS");
}
function security() {
  const properties = read("backend/src/main/resources/application.properties");
  assert.ok(properties.includes("server.address=127.0.0.1"));
  assert.ok(properties.includes("server.error.include-stacktrace=never"));
  assert.ok(!read(source + "TipoExameController.java").includes("Repository"));
  const all = fs
    .readdirSync(path.join(ROOT, source))
    .filter((f) => f.endsWith(".java"))
    .map((f) => read(source + f))
    .join("");
  assert.ok(!all.includes("Runtime.getRuntime"));
  assert.ok(read(source + "TipoExame.java").includes("@NotBlank"));
  console.log(
    "security and architecture source checks PASS; unauthenticated loopback demo only",
  );
}
function integration() {
  for (const check of [contract, backend, frontend, security]) check();
  console.log(
    "offline composite integration PASS; HTTP Spring/browser suites separate",
  );
}
try {
  const check = { backend, frontend, contract, security, integration }[
    process.argv[2]
  ];
  assert.ok(check, "Unknown oracle");
  check();
} catch (error) {
  console.error(
    JSON.stringify({
      verdict: "FAIL",
      oracle: process.argv[2],
      reason: error.message,
    }),
  );
  process.exitCode = 1;
}
