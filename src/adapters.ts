import { spawn } from "node:child_process";
import type {
  AgentAdapter,
  AgentConfig,
  AgentRequest,
  AgentResult,
  Config,
  WorkUnit,
} from "./types.js";
import {
  PolicyError,
  TimeoutError,
  canonical,
  delay,
  throwIfAborted,
} from "./util.js";
export class TransientAgentError extends Error {}
export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}
export async function runProcess(
  argv: string[],
  options: {
    payload?: string;
    cwd?: string;
    timeoutSeconds?: number;
    signal?: AbortSignal;
  } = {},
): Promise<ProcessResult> {
  if (!argv.length || argv.some((v) => typeof v !== "string"))
    throw new PolicyError("Invalid argv");
  throwIfAborted(options.signal);
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: options.cwd,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C.UTF-8" },
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = Buffer.alloc(0),
      err = Buffer.alloc(0),
      failure: unknown;
    const max = 2 ** 20;
    function kill(reason: unknown) {
      failure ??= reason;
      if (child.pid) {
        try {
          if (process.platform === "win32") child.kill("SIGKILL");
          else process.kill(-child.pid, "SIGKILL");
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ESRCH") failure = e;
        }
      }
    }
    const abort = () =>
      kill(
        options.signal?.reason ?? new DOMException("Cancelled", "AbortError"),
      );
    const timer = setTimeout(
      () => kill(new TimeoutError("Process timeout")),
      (options.timeoutSeconds ?? 30) * 1000,
    );
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (data: Buffer) => {
      if (out.length + data.length > max)
        kill(new PolicyError("Process output exceeds 1 MiB"));
      else out = Buffer.concat([out, data]);
    });
    child.stderr.on("data", (data: Buffer) => {
      if (err.length + data.length > max)
        kill(new PolicyError("Process output exceeds 1 MiB"));
      else err = Buffer.concat([err, data]);
    });
    child.stdin.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code !== "EPIPE") kill(e);
    });
    child.on("error", (e) => {
      failure ??= e;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (failure) reject(failure);
      else
        resolve({
          code: code ?? -1,
          stdout: out.toString(),
          stderr: err.toString(),
        });
    });
    child.stdin.end(options.payload ?? "");
  });
}
export class MockAgentAdapter implements AgentAdapter {
  readonly idempotent = true;
  constructor(private readonly agent: AgentConfig) {}
  async execute(
    request: AgentRequest,
    signal?: AbortSignal,
  ): Promise<AgentResult> {
    const attempts = this.agent.attempts ?? [{ files: {} }];
    const result = attempts[Math.min(request.attempt - 1, attempts.length - 1)];
    if (!result) throw new PolicyError("Empty mock attempts");
    await delay((result.delay_seconds ?? 0) * 1000, signal);
    if (result.raise === "transient")
      throw new TransientAgentError("controlled transient transport failure");
    if (result.raise) throw new Error("controlled agent failure");
    return {
      schema_version: "1.0",
      files: result.files ?? {},
      usage: result.usage ?? { cost: 0, tokens: 0 },
      summary: "mock fixture patches",
      idempotency_key: request.idempotency_key,
    };
  }
}
export class ProcessAgentAdapter implements AgentAdapter {
  readonly idempotent = false;
  constructor(
    private readonly argv: string[],
    private readonly timeoutSeconds = 30,
  ) {}
  async execute(
    request: AgentRequest,
    signal?: AbortSignal,
  ): Promise<AgentResult> {
    const r = await runProcess(this.argv, {
      payload: canonical(request) + "\n",
      timeoutSeconds: this.timeoutSeconds,
      signal,
    });
    if (r.code)
      throw new Error(
        `Adapter process failed (${r.code}): ${r.stderr.slice(0, 1000)}`,
      );
    return JSON.parse(r.stdout) as AgentResult;
  }
}
export class HttpAgentAdapter implements AgentAdapter {
  readonly idempotent = false;
  constructor(private readonly url: string) {}
  async execute(
    request: AgentRequest,
    signal?: AbortSignal,
  ): Promise<AgentResult> {
    const timeout = AbortSignal.timeout(10000);
    const response = await fetch(this.url, {
      method: "POST",
      body: canonical(request),
      headers: { "Content-Type": "application/json" },
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) throw new Error(`HTTP adapter status ${response.status}`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty HTTP response");
    let body = Buffer.alloc(0);
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (body.length + value.length > 2 ** 20)
          throw new PolicyError("Oversized HTTP agent response");
        body = Buffer.concat([body, value]);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return JSON.parse(body.toString()) as AgentResult;
  }
}
export function adapterFor(unit: WorkUnit, config: Config): AgentAdapter {
  const a = unit.agent;
  if (a.adapter === "mock") return new MockAgentAdapter(a);
  if (a.adapter === "process" && config.allow_process_agents === true) {
    const argv = config.agent_commands?.[a.profile ?? ""];
    if (argv) return new ProcessAgentAdapter(argv, unit.timeout_seconds);
  }
  if (a.adapter === "http") {
    const url = config.agent_endpoints?.[a.profile ?? ""];
    if (url && config.allowed_agent_endpoints?.includes(url))
      return new HttpAgentAdapter(url);
  }
  throw new PolicyError(`Adapter disabled or unconfigured: ${a.adapter}`);
}
