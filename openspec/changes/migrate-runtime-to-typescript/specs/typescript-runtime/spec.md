## ADDED Requirements

### Requirement: Run engineering orchestration in TypeScript
The framework SHALL execute its core and CLI using TypeScript compiled for Node.js, without requiring Python for installation, operation, tests or the example's orchestration.

#### Scenario: Install the npm artifact
- **WHEN** an engineer installs the packed npm artifact with only production dependencies
- **THEN** the CLI and deterministic worker loop SHALL execute using Node.js

### Requirement: Preserve verifiable orchestration behavior
The runtime SHALL preserve contract validation, dependency scheduling, actual parallel execution, local correction, authority gates and durable recovery.

#### Scenario: Correct a failing worker
- **WHEN** a worker violates an external verifier
- **THEN** only that worker SHALL receive correction feedback and independent passed units SHALL remain accepted

#### Scenario: Recover a killed controller
- **WHEN** a controller is killed with a passed unit and a mock unit in flight
- **THEN** the runtime SHALL recover the checkpoint, reclaim the dead lease and preserve the passed unit's attempt count

### Requirement: Migrate legacy state with evidence and backup
The runtime SHALL reject implicit legacy-store reuse and SHALL validate legacy event history, source and accepted output hashes before creating a backup and migrating operational state.

#### Scenario: Resume a Python checkpoint
- **WHEN** an operator explicitly migrates an intact Python0.1 store
- **THEN** accepted patches SHALL be retained, a consistent backup SHALL exist and integration and authority decisions SHALL require revalidation

#### Scenario: Reject tampered state
- **WHEN** history, policy or accepted output evidence differs
- **THEN** migration SHALL stop without changing the legacy store

### Requirement: Preserve official OpenSpec interoperability
The runtime SHALL consume official OpenSpec structured interfaces and preserve native proposal/spec/design/tasks artifacts while applying evidence-based progress and archive gates.

#### Scenario: Synchronize verified progress
- **WHEN** task-linked units are verified and their outputs are delivered to the consumer
- **THEN** only those task checkboxes SHALL be synchronized and the specification fingerprint SHALL remain stable
