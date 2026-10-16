# Agent Note: Composer mode navigation slot

Status: implemented

English | [中文](2026-10-10-composer-mode-navigation.zh.md)

## Problem

The isolated M1 integration needs a mode navigation entry inside the native composer. A separate toolbar duplicates session actions, while changing an existing Session preset risks conflating its history and capabilities.

## Decision

`conversation.input.mode` is a single, optional-Session child of the composer bar. `InputBar` renders it first in the lower tool row, including when the editor is inert. The native shell contributes no default mode control.

The isolated external M1 plugin contributes Chat/Coding navigation. It reads actual presets for labels and uses Workspace membership separately for blank-session reuse. Switching opens a matching blank Session or creates one through existing APIs. It preserves drafts and does not select a preset on an existing Session. Coding requires an explicit Workspace; global new opens Chat. The plugin suppresses the native blank-session preset selector to avoid conflicting mutation semantics.

## Alternatives considered

Keeping the additional toolbar retains duplicate actions. Mutating the current preset violates the session-preservation requirement. Replacing the composer would duplicate attachments, permissions, model selection and scrolling ownership. The small declared slot keeps those owners intact.

## Consequences

The M1 plugin requires the isolated harness build containing this slot. This is an isolated experience build, not a security release. Backend creation transactions and Chat tool policy remain outside this change. Native Workspace management remains in the sidebar; the composer shows read-only membership independently of the mode label.

## Isolated presentation

The native hero Workspace row and header preset label expose data attributes. Only the M1 plugin styles these markers: it hides the redundant Workspace trigger while retaining its anchor geometry and native picker, and hides header labels for the two modes already named in the composer. Other presets retain their header label. The plugin uses the native font family, font-size preference, content-width axis and scrollports; it changes composer spacing and mode-dialog styling without replacing those owners. Its read-only context derives Workspace membership through framework hooks and never changes navigation or session data.

## Testing

The read-only context row has an opaque native background so transcript text cannot show through it above the composer fade. Chat restores a saved reading anchor in a microtask after the mount commit: ancestor refs must publish the native content width before anchor geometry is sampled. It ignores the queued restore after unmount. Fresh-session bottom positioning and continuous scroll following retain their existing owners and algorithms.

The input component test verifies navigation remains usable while sending is disabled without a Session. Plugin tests cover bidirectional navigation, reuse, concurrent actions, failure recovery and preset-derived labels. Chat tests cover restore after ancestor layout and cancellation on unmount. The isolated browser exercises responsive layouts, native 125% page zoom, long replies, streaming follow, reading-position restoration and multiline draft preservation. These product checks do not clear the separate full-repository Gate.
