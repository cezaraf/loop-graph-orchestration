from __future__ import annotations
import asyncio
import json
import os
import signal
from typing import Protocol
from .util import PolicyError, canonical


class AgentAdapter(Protocol):
    idempotent: bool

    async def execute(self, request: dict) -> dict: ...


class MockAgentAdapter:
    """Pure patch-producing fixture adapter. No tools, shell or credentials."""

    idempotent = True

    def __init__(self, agent):
        self.agent = agent

    async def execute(self, request):
        attempts = self.agent.get("attempts", [{"files": {}}])
        result = attempts[min(request["attempt"] - 1, len(attempts) - 1)]
        await asyncio.sleep(result.get("delay_seconds", 0))
        if result.get("raise") == "transient":
            raise TransientAgentError("controlled transient transport failure")
        if result.get("raise"):
            raise ValueError("controlled agent failure")
        return {
            "schema_version": "1.0",
            "files": result.get("files", {}),
            "usage": result.get("usage", {"cost": 0, "tokens": 0}),
            "summary": "mock fixture patches",
            "idempotency_key": request["idempotency_key"],
        }


class TransientAgentError(Exception):
    pass


async def process(argv, payload=None, cwd=None, timeout=30):
    """No shell, minimal environment, bounded output; kill complete process group."""
    if not argv or not all(isinstance(x, str) for x in argv):
        raise PolicyError("Invalid argv")
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "LANG": "C.UTF-8",
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    proc = await asyncio.create_subprocess_exec(
        *argv,
        cwd=cwd,
        env=env,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,
        limit=2**20,
    )

    async def bounded_read(stream):
        result = bytearray()
        while chunk := await stream.read(65536):
            result.extend(chunk)
            if len(result) > 2**20:
                raise PolicyError("Process output exceeds 1 MiB")
        return bytes(result)

    async def communicate():
        if payload is not None:
            proc.stdin.write(payload)
            await proc.stdin.drain()
        proc.stdin.close()
        out, err = await asyncio.gather(
            bounded_read(proc.stdout), bounded_read(proc.stderr)
        )
        await proc.wait()
        return (
            proc.returncode,
            out.decode(errors="replace"),
            err.decode(errors="replace"),
        )

    try:
        return await asyncio.wait_for(communicate(), timeout)
    except BaseException:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        await proc.wait()
        raise


class ProcessAgentAdapter:
    """Trusted configured CLI emits AgentResult JSON from AgentRequest stdin.

    This is not an OS sandbox. Disabled unless explicitly enabled by host policy.
    The process receives no workspace path, environment secrets or authority key.
    """

    idempotent = False

    def __init__(self, argv, timeout=30):
        self.argv = argv
        self.timeout = timeout

    async def execute(self, request):
        code, out, err = await process(
            self.argv, (canonical(request) + "\n").encode(), timeout=self.timeout
        )
        if code:
            raise RuntimeError(f"Adapter process failed ({code}): {err[:1000]}")
        return json.loads(out)


class HttpAgentAdapter:
    """Trusted harness endpoint producing patches, not an OpenAI model endpoint."""

    idempotent = False

    def __init__(self, url):
        self.url = url

    async def execute(self, request):
        # urllib runs in thread. Cancellation of network thread relies on socket timeout.
        import urllib.request

        def call():
            req = urllib.request.Request(
                self.url,
                canonical(request).encode(),
                {"Content-Type": "application/json"},
            )

            # Do not follow redirects to an unconfigured authority.
            class NoRedirect(urllib.request.HTTPRedirectHandler):
                def redirect_request(self, *args, **kwargs):
                    return None

            with urllib.request.build_opener(NoRedirect()).open(req, timeout=10) as res:
                data = res.read(2**20 + 1)
                if len(data) > 2**20:
                    raise PolicyError("Oversized HTTP agent response")
                return json.loads(data)

        return await asyncio.to_thread(call)


def adapter_for(unit, config):
    agent = unit["agent"]
    kind = agent.get("adapter")
    if kind == "mock":
        return MockAgentAdapter(agent)
    if kind == "process" and config.get("allow_process_agents"):
        argv = config.get("agent_commands", {}).get(agent.get("profile"))
        if argv:
            return ProcessAgentAdapter(argv, unit["timeout_seconds"])
    if kind == "http":
        url = config.get("agent_endpoints", {}).get(agent.get("profile"))
        if url and url in config.get("allowed_agent_endpoints", []):
            return HttpAgentAdapter(url)
    raise PolicyError(f"Adapter disabled or unconfigured: {kind}")
