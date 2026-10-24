<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!-- Copyright (C) 2026 AlbiDR -->

# Playlist Tidy for Spotify — CleanStack Architecture

Status: Accepted  
Decision type: Authoritative Design Reference (ADR)  
Applies to: Website, CLI, shared sorting engine, and GitHub Actions automation

## 1. Purpose and authority

This document is the architectural source of truth for Playlist Tidy for Spotify. It defines the boundaries, invariants, and verification standards that keep the application predictable and safe while it reads and reorders Spotify playlists.

Implementation details may evolve without changing this ADR when they remain inside these boundaries. Any change that weakens a playlist-integrity invariant, changes the dependency direction, adds a new kind of Spotify mutation, or changes credential ownership requires an explicit ADR amendment before implementation.

The product is independently developed and is not affiliated with or endorsed by Spotify.

## 2. Product boundary

Playlist Tidy for Spotify performs one focused operation: it reorders occurrences in a playlist owned by the authenticated user so that the newest-added occurrences appear first.

It provides two interfaces over one implementation:

1. A static GitHub Pages website for login, playlist selection, preview, and an explicit sort action.
2. A Node.js CLI used locally and by a scheduled GitHub Actions workflow.

The product does not:

- add, remove, replace, create, or delete playlist items;
- create duplicate playlists;
- sort playlists owned by another user;
- provide a general Spotify client;
- store user data in a database;
- promise offline mutation or deferred writes;
- hide failed or ambiguous writes from the user.

## 3. Architectural principles

### 3.1 Keep the system proportionate

- **KISS:** prefer the smallest design that satisfies the stated invariants.
- **YAGNI:** introduce no layer, service, cache, framework, or abstraction for a hypothetical requirement.
- **Single source of truth:** each rule has one canonical representation.
- **Single responsibility:** pure ordering, Spotify transport, orchestration, and presentation remain separate.
- **Principle of least astonishment:** previews describe the same moves that a real run would attempt from the same coherent state.
- **Framework as a detail:** the sorting kernel has no browser, Node.js, Vite, GitHub, or Spotify transport dependency.
- **Composition over inheritance:** capabilities are assembled through small interfaces.
- **Fail closed:** uncertain ownership, identity, snapshot state, validation, or write outcome stops further writes.

### 3.2 Make unsafe behavior structurally unavailable

Application code receives a narrow reorder capability, not a generic HTTP client. No production interface exposes add, remove, replace, create, or delete operations. Tests and dependency rules enforce this boundary.

### 3.3 Evidence over assumption

Protocol behavior that cannot be proven from authoritative documentation or deterministic tests remains an explicit live-verification gate. The implementation must not silently turn an assumption into a guarantee.

## 4. Structural architecture

The project uses four code layers plus a minimal control surface.

```text
src/
├── core/                  # Pure playlist domain and algorithms
├── adapters/              # Spotify, OAuth, validation, time, and logging adapters
├── applications/          # Preview, sort, login, and configured-run use cases
└── interfaces/
    ├── web/               # Static browser interface
    └── cli/               # Node.js command-line interface

tests/                     # Cross-layer integration and contract tests
scripts/                   # Build-time or verification utilities only
.github/workflows/         # CI, Pages deployment, and scheduled sorting
```

### 4.1 Dependency law

```yaml
# @machine-readable: architecture-isolation
layers:
  - id: core
    level: 0
    allowed_imports: []
    forbidden_runtime_apis: [dom, node, network, storage]
  - id: adapters
    level: 1
    allowed_imports: [applications, core]
    role: port-implementation
  - id: applications
    level: 2
    allowed_imports: [core]
    dependency_access: ports-only
  - id: interfaces
    level: 3
    allowed_imports: [applications, core, adapters]
    role: composition-root
```

Additional rules:

- `core` contains deterministic functions and immutable domain values only.
- `applications` define or consume narrow ports; they do not import a concrete Spotify adapter.
- `adapters` translate external representations into validated domain values and implement application ports.
- `interfaces` assemble concrete dependencies and convert use-case results into UI or CLI output.
- The web and CLI interfaces never import from one another.
- Tests may cross boundaries when exercising an explicit integration contract.

### 4.2 Layer responsibilities

#### Core

The core owns:

- stable newest-added-first ordering;
- null-date ordering;
- occurrence identity inside one coherent snapshot;
- cross-snapshot membership keys and ordered-state signatures;
- canonical range-move semantics;
- range-move planning;
- plan application in memory;
- membership and ordered-state comparison;
- invariant checks.

It accepts already-validated domain values and performs no I/O.

#### Adapters

Adapters own:

- Spotify OAuth and token exchange;
- Spotify request construction;
- response schema validation and DTO mapping;
- paginated playlist reads;
- the single allowed reorder write;
- bounded retry primitives for operations where retry is safe;
- clock, sleep, structured logging, and credential sinks.

Raw Spotify payloads do not cross the adapter boundary.

#### Applications

Applications own:

- authenticating and identifying the current user;
- validating playlist ownership;
- obtaining a coherent playlist view;
- previewing a plan;
- executing a plan under a deadline;
- snapshot checks and per-step reconciliation;
- ambiguous-write recovery;
- post-run verification;
- sorting configured playlists;
- reporting typed outcomes.

#### Interfaces

Interfaces own:

- dependency assembly;
- user input and environment parsing;
- browser callback handling;
- rendering progress, previews, results, and complete errors;
- CLI exit codes;
- translating workflow inputs into application commands.

No interface may implement its own sorting or reconciliation behavior.

## 5. Playlist domain contract

### 5.1 Occurrences, not unique tracks

A playlist is an ordered sequence of occurrences. Duplicate URIs are separate occurrences. Unavailable, local, and null-item entries remain occurrences and are not pinned or discarded.

Within one fetched snapshot, original position is the internal occurrence identity used by the planner. Position is not treated as identity across snapshots.

### 5.2 Target order

The target ordering is:

1. non-null `added_at` values in descending chronological order;
2. equal timestamps in their current relative order;
3. null `added_at` values at the bottom in their current relative order.

The sort must be stable and deterministic.

### 5.3 Cross-snapshot comparison

Two separate concepts are mandatory:

- **Membership key:** the item URI when present, otherwise `null|<item-type>`.
- **Ordered-state signature:** URI or null, normalized `added_at`, item type, and `added_by.id`, plus any stronger stable identity Spotify makes available.

Membership preservation compares multisets of membership keys. Ordered-state verification compares the full signature sequence. Signature-identical occurrences are interchangeable.

Known limitation: if Spotify exposes no distinguishing identity or metadata for two unidentified occurrences, replacement of one by an indistinguishable occurrence cannot be detected. This limitation must be documented, not concealed.

### 5.4 Canonical range move

One pure transition function defines move behavior for the planner, tests, fake Spotify server, reconciliation, and documentation.

For a list, a move removes `[source, source + length)` and inserts it before a destination expressed in pre-removal coordinates:

- when `destination < source`, insert at `destination`;
- when `destination > source + length`, insert at `destination - length` after removal;
- a destination in `[source, source + length]` is a no-op and is never emitted.

No other module may reimplement this calculation.

### 5.5 Planner contract

The planner:

- produces legal contiguous range moves;
- favors block moves rather than unnecessary single-occurrence moves;
- emits no move for an already-sorted playlist;
- preserves the exact occurrence multiset;
- reaches the stable target order when its plan is applied through the canonical transition;
- is deterministic for a given coherent input;
- matches the optimal number of legal range moves for all tested playlists of up to six occurrences, using an exhaustive oracle independent of planner strategy.

## 6. Spotify boundary

### 6.1 Validation gate

Every external value is untrusted. Spotify payloads, OAuth callbacks, environment variables, workflow inputs, and browser inputs are schema-validated at entry.

Validation performs three distinct steps:

1. verify external shape and bounds;
2. normalize protocol representations;
3. map to domain types.

Malformed, incomplete, or semantically impossible data yields a typed failure before it reaches the core.

### 6.2 Allowed Spotify operations

Production code may use only the endpoints required to:

- identify the current user;
- list or inspect playlists;
- page through playlist items;
- exchange or refresh OAuth tokens;
- reorder a contiguous playlist range.

The transport must not provide application code with a generic mutation method. Endpoint paths are centralized and contract-tested.

### 6.3 Coherent reads

Playlist items are fetched page by page. The snapshot identifier is checked around the paged read. If it changes during paging, the mixed view is discarded and the full read restarts within the configured retry budget and total deadline.

No plan is computed from pages belonging to different snapshots.

### 6.4 Ownership

Before sorting, the application obtains the current user and playlist owner. Only an exact owner-ID match authorizes a reorder. Collaborative access or edit capability without ownership is insufficient.

Failure to establish ownership is a non-write outcome with a clear playlist identifier in the user-facing message.

## 7. Write-safety protocol

### 7.1 Before the first write

The application:

1. fetches a coherent view;
2. verifies ownership;
3. derives target order and plan;
4. returns immediately if the plan is empty;
5. rechecks the current snapshot before issuing the first move.

Every reorder request includes the snapshot against which its expected transition was calculated.

### 7.2 After every successful write

Until live evidence proves stale snapshots are rejected atomically, the application refetches a coherent view before issuing the next planned move. Both must match the expected intermediate state:

- the returned snapshot identifier; and
- the complete ordered-state signature sequence.

Any difference stops the current plan. The application may refetch and recompute within the refetch cap and deadline; it never continues with stale positional instructions.

### 7.3 Ambiguous write outcomes

A reorder request is never replayed blindly after a timeout, network failure, or server-side 5xx response. The write might already have been applied.

The application instead:

1. fetches a new coherent view;
2. determines whether the expected transition is already reflected;
3. continues from the verified state when safe, or discards and recomputes the plan;
4. counts the recovery against the retry budget and deadline.

A rate-limit response may be retried only when the API guarantees that the rejected request was not applied. `Retry-After` is honored with a bounded sleep.

### 7.4 Post-run verification

After the final write, a coherent refetch must prove:

- the snapshot is the one expected from the last acknowledged write;
- the full ordered-state signature sequence equals the expected target;
- `added_at` is independently non-increasing with nulls last;
- the membership-key multiset is unchanged.

A changed snapshot is reported as a concurrent edit and is eligible for a fresh plan within policy. A mismatch at the expected snapshot is an integrity failure and produces a non-zero CLI exit or visible web error.

### 7.5 Bounds

All retry and recovery behavior is bounded by:

- a configurable refetch-attempt limit;
- a configurable per-playlist deadline;
- bounded exponential backoff for retryable reads;
- a maximum rate-limit sleep.

Defaults are declared once in configuration, named by purpose, and covered by tests. A bound being configurable does not make an unbounded value valid.

## 8. Authentication and credential ownership

### 8.1 Website

The website uses Authorization Code with PKCE and a high-entropy state value. The callback rejects missing or mismatched state.

The website:

- stores the access token in memory only;
- discards any refresh token returned to it;
- never places tokens in local storage, cookies, URLs, logs, DOM attributes, or visible output;
- uses session storage only for the one-time PKCE verifier and state;
- deletes those values after callback processing;
- loads no third-party runtime scripts;
- ships a restrictive Content Security Policy.

The GitHub Pages shared-origin limitation and the optional dedicated-domain hardening must be documented.

### 8.2 Automation

The local CLI is the only enrollment path for the automation credential. It binds its loopback listener to `127.0.0.1`, validates OAuth state, and sends the resulting refresh token to the repository secret through standard input. It does not print or persist the token unless an explicit diagnostic option is deliberately invoked.

The GitHub Action is the sole long-lived refresh-token owner. If Spotify rotates a refresh token, persistence of the replacement must succeed before the run is considered successful.

### 8.3 Least privilege

Spotify scopes, GitHub workflow permissions, repository secrets, and any token capable of updating a secret are limited to the minimum required capability. Secrets and playlist configuration are never included in the repository or static build output.

## 9. Error and logging contract

Errors are typed by operational meaning rather than HTTP status alone. At minimum the system distinguishes:

- validation failure;
- authentication or refresh failure;
- authorization or owner mismatch;
- rate limiting;
- transient read failure;
- ambiguous write outcome;
- concurrent edit;
- retry-budget exhaustion;
- deadline exceeded;
- post-run integrity failure;
- unsupported Spotify behavior.

Raw strings are not thrown. Errors retain safe causal context but redact authorization headers, access tokens, refresh tokens, OAuth codes, PKCE verifiers, and secret-bearing command input.

Real runs log the playlist identifier, timestamps, snapshots before and after, planned and applied move counts, recovery decisions, and final outcome. Dry runs log plans but issue zero writes.

Web error text must wrap, remain selectable, and offer a way to copy the complete safe message. CLI failures use non-zero exit codes.

## 10. Interface contracts

### 10.1 Website

The website must:

- clearly distinguish Preview from Sort now;
- require an explicit user action before a write;
- show ownership and unsupported-playlist errors without offering a write path;
- remain operable by keyboard;
- provide meaningful focus states and accessible labels;
- use touch targets of at least 44 by 44 CSS pixels;
- avoid presenting a success state before post-run verification completes.

### 10.2 CLI and Action

The CLI provides explicit commands for login, preview or dry run, and sorting. Inputs are parsed and validated once at the control boundary.

The scheduled and manually dispatched workflow share one concurrency group with `cancel-in-progress: false`. The workflow runs from the intended default branch, declares minimal permissions, pins third-party actions to immutable commits, and never echoes secrets.

## 11. Testing and proof obligations

### 11.1 Core tests

Core behavior requires deterministic unit and property tests for:

- stable equal-date ordering;
- null dates;
- duplicate URIs;
- local, unavailable, and null items;
- empty and single-occurrence playlists;
- already-sorted and reverse-sorted inputs;
- forward, backward, block, and no-op transition semantics;
- membership preservation;
- plan application reaching the target;
- idempotence;
- exhaustive optimality through six occurrences.

Hand-written transition examples must exist independently of the canonical implementation.

### 11.2 Adapter and application tests

A fake Spotify server must exercise:

- paging and mixed-snapshot restart;
- validation failures;
- owner mismatch;
- OAuth state mismatch;
- expired access token refresh;
- rate limits and `Retry-After`;
- retryable read failures;
- applied-but-errored writes;
- failed-before-application writes;
- concurrent edits before, between, and after moves;
- reconciliation caps and deadlines;
- refresh-token rotation persistence;
- post-run signature and membership failures.

Tests must assert that no forbidden Spotify mutation endpoint is called.

### 11.3 Static security tests

The built website is checked for forbidden token persistence, third-party runtime scripts, accidental environment embedding, and missing security policy. Logs are tested for redaction.

Architectural dependency rules are enforced in CI rather than relying only on review.

### 11.4 Required verification gate

Every proposed integration must pass:

```text
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

No deployment or release proceeds with a failed required check.

## 12. Live Spotify verification gates

The following behavior must be tested against a disposable owned playlist before the corresponding capability is declared supported:

1. Browser CORS from the deployed Pages origin for authorization, token exchange, and required API calls.
2. Forward block reordering with `range_length > 1` matches the canonical transition.
3. A stale snapshot identifier is either rejected atomically or its weaker behavior is handled and documented.
4. Refresh responses are checked for token rotation.
5. Repeated web logins do not invalidate the automation refresh-token lineage.

If web login invalidates the automation credential, the project must choose and document one supported architecture before release:

- separate Spotify applications and client IDs when permitted;
- Action and local CLI sorting without deployed web sorting; or
- an explicitly accepted manual re-enrollment workflow.

The product must not advertise simultaneous web and scheduled sorting until the chosen branch passes an integration test.

## 13. Governance and lifecycle

- Git history and reviewed source are the implementation source of truth.
- Changes follow Conventional Commits and Semantic Versioning once releases begin.
- User-visible changes are recorded in a changelog.
- Production source files carry the project SPDX and copyright header where the file format permits comments.
- Dependencies require a current, stated purpose; unused dependencies and dead code are removed.
- A defect fix includes a regression test that addresses the failure class when practical.
- CI configuration, endpoint contracts, security assumptions, and live probe results are reviewed as production code.
- Generated output, credentials, local environment files, and playlist IDs are not committed.

## 14. Forbidden paths

The following are architectural violations:

1. Reimplementing ordering or range-move semantics outside `core`.
2. Computing a plan from a mixed-snapshot paginated read.
3. Treating a URI as a unique playlist occurrence.
4. Continuing positional moves after observed state diverges from the expected intermediate state.
5. Blindly replaying an ambiguously failed reorder request.
6. Calling add, remove, replace, create, or delete playlist mutation endpoints.
7. Sorting a playlist without proving exact ownership.
8. Allowing raw Spotify payloads into application or presentation logic.
9. Persisting browser tokens or exposing automation credentials to the web build.
10. Logging secrets, OAuth codes, authorization headers, or PKCE verifiers.
11. Duplicating use-case behavior between web and CLI interfaces.
12. Reporting success before post-run verification.
13. Shipping while a required verification check fails.
14. Hiding an unresolved Spotify behavior assumption behind a generic success path.

## 15. Initial implementation sequence

The project begins in this order:

1. Establish repository controls, TypeScript configuration, formatting, linting, tests, and architectural import checks.
2. Implement domain types, stable ordering, identity, and canonical transition.
3. Implement and exhaustively verify the range-move planner.
4. Define application ports and typed outcomes.
5. Implement validated Spotify read and reorder adapters with the fake server.
6. Implement preview, execution, reconciliation, and post-run verification use cases.
7. Build the CLI and secure local enrollment flow.
8. Build the static website and PKCE callback.
9. Add CI, Pages deployment, and scheduled sorting workflows.
10. Perform and record the live Spotify gates before release.

## 16. Decision summary

Playlist Tidy for Spotify uses a small CleanStack architecture centered on a pure playlist kernel and narrow external capabilities. Safety comes from structural limitations, validated boundaries, coherent snapshots, deterministic planning, per-step reconciliation, and independent post-run verification. The website and automation are two composition roots over the same domain and application behavior; neither is allowed to become a separate implementation.
