# Release candidate validation

Validated on 2026-10-16, Windows, Node 24.14.1, pnpm 11.7.0, real Microsoft Edge (headless browser automation). The candidate was installed into a new source directory with no copied node_modules, build output, DSH profile or browser profile. Existing package-manager download caches were allowed; this is a clean project install, not a clean OS/VM.

| Check | Result |
|---|---|
| Harness `pnpm install --frozen-lockfile` | PASS |
| Plugin `npm ci` | PASS |
| Paired `node scripts/build.mjs` | PASS, full Host/Client/Web build and plugin generation |
| Plugin `npm test` | PASS, existing test expectations unchanged |
| Existing input-bar, chat-view and tool-registration identity suites | PASS, 3 files / 161 tests |
| Isolated profile setup and cold start | PASS, empty sessions before first request |
| Real Chat request | PASS, provider/model identity returned; request tools exactly web_search, no cwd/Coding/runtime context |
| Real Coding request | PASS, actual read/write tools in disposable Workspace; output bytes verified |
| Chat → Coding → Chat | PASS through actual browser controls; actual presets/cwd checked |
| Candidate secret/privacy scan | PASS after review: Gitleaks 8.30.1 found 44 translation Git-blob hashes and 3 synthetic test-fixture matches; no confirmed credential findings |
| Original worktree/evidence preservation | PASS, HEAD/status/content hashes unchanged |

The existing M1.1 UI-D product Gate remains PASS. **The full DSH repository Gate remains FAIL** and was not rerun or waived. The inherited UI-D covered long streaming/history/drafts, model switching, attachments, window sizes/125% zoom and manual native directory selection. Those scenarios were not all repeated for this source-only assembly.

## Failures retained and resolved within release scope

1. Direct Harness build in a repository without HEAD failed. The release build wrapper now supplies the existing upstream commit-metadata option in source-archive mode; no Harness build expectations were changed.
2. Setup inside the agent filesystem sandbox failed with junction EPERM. The unchanged setup succeeded in the normal Windows host; this does not waive the separate full-repository symlink failure.
3. First clean Chat creation failed because the out-of-profile plugin could not resolve its optional dsh-tool-web peer. Setup now links exactly the bundled Harness peer. The failed runtime and logs were preserved; the same browser assertions passed with a fresh runtime after the assembly fix.
4. Gitleaks returned 47 raw candidates. All were individually reviewed as non-secret upstream translation hashes or synthetic fixtures; no blanket path exclusion or product-test change was used.
5. Initial index whitespace check flagged Windows CRLF in files without text attributes. Root attributes now canonicalize text to LF; original product tests and generated-client consistency remain unchanged.

The source-wide whitespace check still flags three pre-existing locations in `harness/vendor/cosmokit/README.md` and `plugin/test/robustness.test.mjs` (trailing whitespace/blank EOF). They remain unchanged upstream content, are not secret or runtime failures, and are not represented as a passing whitespace check. Newly authored release scripts/documentation pass their focused whitespace check.

No commits or upstream history were imported. The candidate Git index is the proposed first-commit content; the new repository has zero commits/remotes/tags. Final file/index/privacy scans and source-tree equivalence are recorded in the private release report. Raw logs contain private runtime details and are deliberately excluded from this source distribution. Results describe a bounded experimental acceptance, not a proof of absence of every vulnerability.
