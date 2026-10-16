# P1F Chat Mode reliability

Baseline: plugin `4053d8a`, DSH `22e4ee5`. Scope: A platform paths; B trusted tool definitions and final schemas; C creation commit/rollback; D authenticated creation and independent-process recovery. No P2 features.

## A — Platform path equality

All production path equality uses the native `node:path.relative` semantics: case-insensitive on Windows and case-sensitive on POSIX. Containment uses the same operation. Stored spelling is preserved; no lowercased paths are written. UUID Session identifiers remain case-sensitive identifiers; the directory path containing that identifier follows platform semantics. Missing, linked, non-directory and out-of-root paths remain rejected.

Tests cover home/process cwd aliases, Workspace equality/ancestor/descendant overlap, recovery casing and sibling rejection, published/durable cwd aliases, and existing junction/escape cases. POSIX assertions run on POSIX hosts; Windows execution is not claimed as POSIX runtime evidence.

### A verification — 2026-10-03

Gate: PASS. The earlier failure was an assertion about realpath spelling: Windows may preserve the input casing. The recovery test now checks `relative(expected, actual) === ''`, the same native path-equivalence contract used in production, without lowercasing either result. It exercises both derived and explicitly configured runtime-root aliases, equivalent Session cwd spelling, and sibling rejection. This continuation did not change the production path logic already implemented in A.

| Check | Result |
| --- | --- |
| `node --test test/chat-runtime.test.mjs` (A and existing runtime cases) | PASS, 13/13 |
| `node scripts/p0/run.mjs` | PASS, paths 3/3, write 8/8, separate-process recovery 2/2 |
| `npm run test:p1e` | PASS, P1 11/11, P1E 3/3, DSH preset/controller regression 21/21 |
| `npm test` (including pretest build) | PASS, 96/96 |
| `node scripts/build-client.mjs --check` | PASS |
| `npm run check:package` | PASS, 14 runtime/package files |
| `git diff --check` | PASS |

P0 evidence was retained locally under ignored `scratch/p0-G3Rx7p`; it is not a commit asset. The Node test launcher first encountered sandbox `spawn EPERM`; the unchanged command passed outside that sandbox. This is separate from the previously reported upstream Windows symlink-discovery permission limitation, which was not rerun and is not counted as PASS here. Chat junction allocation and recovery negative cases ran successfully. No product failure remains in the A Gate. The DSH tree is unchanged at `22e4ee5`.

A closes path case-equivalence only. Tool identity, final schema enforcement, creation transaction semantics and the combined production-process E2E remain open; A PASS does not authorize P2.

## Remaining stages

B verification is recorded below. C will define a publication commit point after persistence confirmation and prevent failed creations from becoming ordinary list/reuse candidates. D will exercise the combined production path across separate OS processes. Each stage has its own verification and commit; B does not authorize progression to C or P2.

## B — Trusted registrations and final schemas

### B verification — 2026-10-03

P1F-B Gate: PASS WITH ENVIRONMENT EXCEPTION. On 2026-10-03 the user accepted Windows file-symlink EPERM as the sole environment exception and authorized separate B commits. Docs: 31/32 gates passed; the blocked case is not counted PASS, and the unmodified `doc-sync` aggregate still exits nonzero. All other product Gates are green. Pre-B baselines are plugin `30f4369` and DSH `22e4ee5`; C/D/P2 remain out of scope.

The implementation uses ToolRuntime-issued registration handles backed by runtime-owned records. Policies intersect record identities, not names, copied definition content or caller-provided fields; unregistering and re-registering does not carry trust, even when the same definition object is reused. The official search helper returns its current registration directly to the Chat composition. Tool resolution and canonical model-schema projection derive from the same scoped identity sets. SystemPrompt projects after the ordinary assembly waterfall; LLM captures the applicable policy before request middleware and projects immediately before adapter dispatch. Registration identity is process-local and is rebuilt on composition/recovery. Registration does not clone or traverse schema trees; final projection reuses the admitted registration's schema without content equality or deep copying. No-policy Standard behavior retains its existing schema processing.

The previous B failure was an unconditional `structuredClone` at registration that overflowed on 5,000-level parameter and PTC output schemas. That snapshot has been removed rather than replaced by another deep copy. The two original tests were the first tests rerun and both passed, with their assertions unchanged. Arbitrary same-process definition mutation is explicitly outside B's authorized threat model; the snapshot-only mutation probes were removed, while shadow, re-registration, malicious execution/classifier/finalizer and monotonic-policy tests remain.

| Check | Observed result and evidence limit |
| --- | --- |
| Original two 5,000-level schema regressions | PASS, 2/2; the name filter intentionally did not execute the other 225 cases in those files |
| B registration identity / final projection owner tests | PASS, 5/5 across tools, system-prompt and llm |
| DSH affected packages: tools, system-prompt, llm, tool-web | PASS, 35 files, 793/793 tests, including the two depth regressions |
| `npm run test:p1e` | PASS: P1 11/11, P1E 6/6, DSH preset/controller 21/21 |
| B combined attacks in P1E | PASS: agent-local and global same-name shadows, global re-registration, prepend-after-next, append-after-next and no-next transformers; every first/subsequent/compaction request has the official schema, official search runs once per attack, malicious callbacks = 0 |
| JSONL recovery within P1E | PASS with fresh Context, newly composed registrations and attacked first restored request; not a new OS-process E2E claim |
| P1F-A | PASS, all 13 chat-runtime cases in `npm test`, including Windows path equivalence and junction negatives |
| `node scripts/p0/run.mjs` | PASS, paths 3/3, persistence 8/8, separate-process recovery 2/2; ignored evidence: `scratch/p0-GY7shE` |
| `npm test` | PASS, including ordinary client/loading/RPC/persistence regressions |
| `node scripts/build-client.mjs --check` | PASS |
| `npm run check:package` | PASS, 15 files, explicitly checks both Chat search/policy modules |
| DSH typecheck | PASS, full `pnpm run typecheck`, final Host check through doc-typecheck and final `typecheck:contracts-ready` |
| DSH lint | PASS after format fixes and the synchronous P1D disposer return adapter; `pnpm run lint` build stage plus successful `lint:contracts-ready` |
| P1D disposer regression after the lint adapter | PASS, admission 8/8; no preset decision or lifecycle change |
| `pnpm run test:docs` | PASS, 15/15 gates |
| Full `pnpm run doc-sync` | 31 passed, 1 failed, 0 skipped; the remaining failure is file symlink creation EPERM in the documentation-site fixture, never counted as PASS |
| Both repositories `git diff --check` | PASS; final report checked again before handoff |

The first full documentation run also reported stale generated event/config references; generators updated their source line numbers, the Chinese counterparts and pair records were synchronized, and those checks passed on rerun. Public API catalogs, package READMEs, subsystem descriptions and a bilingual Agent Note document the generic extensions. The pre-existing P1D guard returned a Promise-returning Cordis disposer under a `() => void` API; a synchronous return adapter clears the full lint Gate without changing admission decisions. No UI, Workspace, RPC or Session-creation transaction code was changed.

Environment limit: `scripts/project-doc-site.spec.ts`, `publishableImage > refuses a target whose real path escapes the repository`, cannot create its temporary file symlink on this Windows host (`EPERM`) and never reaches its assertion. The other 68 documentation-site tests pass. This is distinct from sandbox worker/build EPERM, which is resolved by running the unchanged commands outside the sandbox. The historical preset-discovery file-symlink case was not rerun or relabeled. Chat directory junction negatives did execute and pass. No test was skipped, modified or weakened to hide the file-symlink limitation.

Evidence and residual scope: LLM adapters and the external web provider are deterministic test substitutes; Loader, formal Chat composition, AgentLoop, ToolRuntime, compaction and JSONL are real. No live search service, independently installed release profile, or combined authenticated-RPC-to-new-OS-process B identity E2E is claimed. The host must supply the matching extended DSH and official tool-web module; the plugin declares that host module as an optional peer and documents fail-closed composition requirements. Policies authorize normal runtime registration/dispatch, not arbitrary same-process object mutation or code execution. Creation transaction/rollback issues and the combined process E2E remain C and D, not B fixes or permission to enter P2.
