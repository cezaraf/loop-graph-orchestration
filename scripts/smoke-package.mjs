// Verify the packed artifact in an isolated production-only npm installation.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
const file = process.argv[2];
if (!file) throw new Error("Pass the packed .tgz path");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "lgo-package-smoke-"));
const install = spawnSync(
  "npm",
  [
    "install",
    "--prefix",
    root,
    "--omit=dev",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    path.resolve(file),
  ],
  { encoding: "utf8", timeout: 120000, shell: false },
);
if (install.status !== 0) throw new Error(install.stderr || install.stdout);
const isolated = path.join(root, "node-only-bin");
fs.mkdirSync(isolated);
fs.symlinkSync(process.execPath, path.join(isolated, "node"));
const code = `import assert from 'node:assert/strict';import fs from 'node:fs';import{Engine,digest,validateContract}from ${JSON.stringify(pathToFileURL(path.join(root, "node_modules/@cezaraf/lgo/dist/index.js")).href)};assert.equal(process.env.PATH,${JSON.stringify(isolated)});const v={kind:'file_contains',path:'src/out.txt',contains:'ok'};const graph={schema_version:'1.0',change_id:'package-smoke',spec_hash:digest('spec'),units:[{id:'worker',objective:'Verify installed runtime',task_id:'1.1',requirement_ids:['demo::Output'],inputs:[],outputs:['src/out.txt'],dependencies:[],resources:[],file_scope:['src/**'],acceptance:['External oracle passes'],verifiers:[v],agent:{adapter:'mock',attempts:[{files:{'src/out.txt':'wrong'}},{files:{'src/out.txt':'ok'}}]},risk:'LOW',timeout_seconds:2,budget:{max_cost:1,max_tokens:100},max_attempts:3}],integration_verifiers:[v]};const p=${JSON.stringify(path.join(root, "project"))};fs.mkdirSync(p);const e=new Engine(p);try{const r=await e.execute(e.start(graph).id);assert.equal(r.state,'ACCEPTED');assert.equal(r.nodes.worker.attempts,2);validateContract('execution_manifest',r);console.log(JSON.stringify({installed_package:'@cezaraf/lgo@0.2.0',state:r.state,correction_attempts:r.nodes.worker.attempts,python_available_on_PATH:false,dev_dependencies_installed:false}));}finally{e.close()}`;
const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
  cwd: root,
  env: { PATH: isolated, LANG: "C.UTF-8" },
  encoding: "utf8",
  timeout: 30000,
});
assert.equal(r.status, 0, r.stderr || r.stdout);
assert.ok(!fs.existsSync(path.join(root, "node_modules/typescript")));
assert.ok(!fs.existsSync(path.join(root, "node_modules/@fission-ai/openspec")));
const cli = spawnSync(path.join(root, "node_modules/.bin/lgo"), ["--version"], {
  env: { PATH: isolated },
  encoding: "utf8",
  timeout: 5000,
});
assert.equal(cli.status, 0, cli.stderr);
assert.equal(cli.stdout.trim(), "0.2.0");
console.log(r.stdout.trim());
fs.rmSync(root, { recursive: true, force: true });
