## Why

The LGO reference needs a TypeScript runtime to improve typed integration with agent harnesses and npm distribution. The migration must preserve verified behavior, recoverable state and the native OpenSpec boundary.

## What Changes

- Replace Python runtime, CLI, tests and scripts with TypeScript/Node.js.
- Keep the sixteen JSON Schema contracts and OpenSpec 1.16.1 interfaces.
- Use built-in SQLite and transactional process leases for a single controller.
- Provide explicit, backed-up migration of Python0.1 checkpoints.
- Port the TipoExame demonstration oracles to Node.js and update CI/docs.

## Capabilities

### New Capabilities

- `typescript-runtime`: Typed local runtime, packaging and safe legacy-state transition.

### Modified Capabilities

None. Existing orchestration behavior remains specified in the build-lgo change; this change adds its runtime migration constraints.

## Impact

Runtime source, CLI packaging, development tooling, operational state version, examples, tests and adoption guides. No remote merge or npm publication is part of this change.
