import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import {
  Engine,
  runProcess,
  HttpAgentAdapter,
  TimeoutError,
  delay,
} from "../dist/index.js";
import type { AgentRequest, AgentResult } from "../dist/types.js";
import { temp, unit, graph, config } from "./helpers.ts";

test("real process adapter exchanges structured stdin/stdout without proprietary SDK", async () => {
  const a = unit("a");
  a.agent = { adapter: "process", profile: "fixture" };
  const code =
    "let data='';process.stdin.on('data',d=>data+=d);process.stdin.on('end',()=>{const r=JSON.parse(data);console.log(JSON.stringify({schema_version:'1.0',files:{'src/a.txt':'ok'},usage:{cost:0,tokens:0},summary:'fixture',idempotency_key:r.idempotency_key}))});";
  const e = new Engine(temp(), {
    config: config({
      allow_process_agents: true,
      agent_commands: { fixture: [process.execPath, "-e", code] },
    }),
  });
  try {
    const r = await e.execute(e.start(graph(a)).id);
    assert.equal(r.state, "ACCEPTED");
    assert.equal(r.nodes.a.attempts, 1);
  } finally {
    e.close();
  }
});
test("process adapters require explicit Boolean authorization", () => {
  const a = unit("a");
  a.agent = { adapter: "process", profile: "fixture" };
  const e = new Engine(temp(), {
    config: config({
      agent_commands: { fixture: [process.execPath, "-e", "process.exit(0)"] },
    }),
  });
  try {
    assert.throws(() => e.start(graph(a)), /disabled/);
  } finally {
    e.close();
  }
});
test("process stdout is bounded and host secrets are not inherited", async () => {
  process.env.LGO_TEST_SECRET = "not-for-worker";
  try {
    const r = await runProcess([
      process.execPath,
      "-e",
      'console.log(process.env.LGO_TEST_SECRET??"absent")',
    ]);
    assert.equal(r.stdout.trim(), "absent");
    await assert.rejects(
      () =>
        runProcess([
          process.execPath,
          "-e",
          'process.stdout.write("x".repeat(2**21))',
        ]),
      /exceeds/,
    );
  } finally {
    delete process.env.LGO_TEST_SECRET;
  }
});
test("timeout terminates the full ordinary child process group", async () => {
  const root = temp(),
    marker = path.join(root, "late-effect");
  const childCode = `setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad'),450)`;
  const code = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'inherit'});setInterval(()=>{},1000)`;
  await assert.rejects(
    () => runProcess([process.execPath, "-e", code], { timeoutSeconds: 0.08 }),
    TimeoutError,
  );
  await delay(550);
  assert.ok(!fs.existsSync(marker));
});
test("explicit cancellation kills running process", async () => {
  const controller = new AbortController();
  const promise = runProcess(
    [process.execPath, "-e", "setInterval(()=>{},1000)"],
    { signal: controller.signal, timeoutSeconds: 5 },
  );
  setTimeout(
    () => controller.abort(new DOMException("Cancelled", "AbortError")),
    30,
  );
  await assert.rejects(promise, /Cancelled/);
});

test("HTTP harness roundtrip and redirect rejection use real local server", async () => {
  const seen: AgentRequest[] = [];
  let redirect = false;
  const server = http.createServer((req, res) => {
    if (redirect) {
      res.writeHead(302, { Location: "/unexpected" });
      res.end();
      return;
    }
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const r = JSON.parse(body) as AgentRequest;
      seen.push(r);
      const response: AgentResult = {
        schema_version: "1.0",
        files: { "src/a.txt": "ok" },
        usage: { cost: 0, tokens: 0 },
        summary: "HTTP fixture",
        idempotency_key: r.idempotency_key,
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/agent`,
    a = unit("a");
  a.agent = { adapter: "http", profile: "fixture" };
  const e = new Engine(temp(), {
    config: config({
      agent_endpoints: { fixture: url },
      allowed_agent_endpoints: [url],
    }),
  });
  try {
    const r = await e.execute(e.start(graph(a)).id);
    assert.equal(r.state, "ACCEPTED");
    assert.equal(seen.length, 1);
    redirect = true;
    await assert.rejects(() => new HttpAgentAdapter(url).execute(seen[0]));
    assert.equal(seen.length, 1);
  } finally {
    e.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
