"""Actual process/HTTP patch protocol interoperability without vendor SDKs."""

import asyncio
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sys
import threading
import pytest
from lgo.engine import Engine
from lgo.util import digest


def patch_graph(adapter, profile):
    v = {"kind": "file_contains", "path": "src/result.txt", "contains": "verified"}
    return {
        "schema_version": "1.0",
        "change_id": "adapter-demo",
        "spec_hash": digest("spec"),
        "units": [
            {
                "id": "worker",
                "objective": "Produce a verified patch",
                "task_id": "1.1",
                "requirement_ids": ["demo::Patch"],
                "inputs": [],
                "outputs": ["src/result.txt"],
                "dependencies": [],
                "resources": [],
                "file_scope": ["src/**"],
                "acceptance": ["Independent marker check"],
                "verifiers": [v],
                "agent": {"adapter": adapter, "profile": profile},
                "risk": "LOW",
                "timeout_seconds": 3,
                "budget": {"max_cost": 1, "max_tokens": 100},
                "max_attempts": 3,
            }
        ],
        "integration_verifiers": [v],
    }


@pytest.mark.asyncio
async def test_process_adapter_real_stdin_json_roundtrip(tmp_path):
    code = "import json,sys; r=json.load(sys.stdin); print(json.dumps({'schema_version':'1.0','files':{'src/result.txt':'verified'},'usage':{'cost':0,'tokens':0},'summary':'process fixture','idempotency_key':r['idempotency_key']}))"
    e = Engine(
        tmp_path,
        {
            "schema_version": "1.0",
            "concurrency": 1,
            "commands": {},
            "allow_process_agents": True,
            "agent_commands": {"fixture": [sys.executable, "-c", code]},
        },
    )
    try:
        r = await e.execute(e.start(patch_graph("process", "fixture"))["id"])
        assert r["state"] == "ACCEPTED" and r["nodes"]["worker"]["attempts"] == 1
        assert (Path(r["workspace"]) / "src/result.txt").read_text() == "verified"
        assert not (tmp_path / "src").exists()
    finally:
        e.close()


@pytest.mark.asyncio
async def test_http_harness_real_patch_roundtrip(tmp_path):
    seen = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            seen.append(request)
            body = json.dumps(
                {
                    "schema_version": "1.0",
                    "files": {"src/result.txt": "verified"},
                    "usage": {"cost": 0, "tokens": 0},
                    "summary": "HTTP fixture",
                    "idempotency_key": request["idempotency_key"],
                }
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_port}/agent"
    e = Engine(
        tmp_path,
        {
            "schema_version": "1.0",
            "concurrency": 1,
            "commands": {},
            "agent_endpoints": {"fixture": url},
            "allowed_agent_endpoints": [url],
        },
    )
    try:
        r = await e.execute(e.start(patch_graph("http", "fixture"))["id"])
        assert r["state"] == "ACCEPTED"
        assert len(seen) == 1 and seen[0]["unit_id"] == "worker"
    finally:
        e.close()
        await asyncio.to_thread(server.shutdown)
        server.server_close()
        thread.join(timeout=2)
