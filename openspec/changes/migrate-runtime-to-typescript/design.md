## Context

LGO0.1 provides the behavioral baseline. JSON contracts stay at1.0; SQLite operational format becomes2. The application language and harness remain independent of the runtime.

## Decisions

- TypeScript strict compiles to native ESM for Node24.22.1. Runtime dependencies: Ajv2020 and yaml.
- Built-in node:sqlite avoids a native-addon compilation toolchain and Python at installation.
- Node test runner exercises typed tests; no agent SDK is mandatory.
- Signals and process-group termination enforce cancellation for trusted external processes. This is not a security sandbox.
- A SQLite controller lease replaces fcntl for normal execution. PID liveness is checked inside an immediate transaction; a live/reused PID blocks conservatively, a dead PID can be reclaimed.
- Legacy migration validates the exact event chain and input/output hashes, makes a consistent SQLite backup, preserves PASSED nodes, and requires new integration/gate validation. It interoperates with an existing Python fcntl lock through the POSIX flock utility, used only for migration.
- External authority bindings include a TypeScript runtime domain so Python approvals cannot be reused.

## Risks / Trade-offs

Node24 is the validated runtime. Arbitrary CLI processes still require host isolation. Legacy stores with changed source/policy or tampered outputs are blocked for operator reconciliation. Language migration does not implement pending ACP/SSO/OTLP integrations or universal exactly-once effects.

## Migration Plan

1. Stop Python controllers and preserve configuration.
2. Install/build LGO0.2 with npm.
3. Run migrate-state --from-python --dry-run.
4. Run migrate-state --from-python; retain the backup.
5. Resume and revalidate; previously accepted patches are preserved.
6. Restore the backup and Python0.1 code if operator rollback is necessary.
