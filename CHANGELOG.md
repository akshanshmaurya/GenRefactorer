# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

- Introduce a background auto-refactor controller that continuously prepares inline suggestions with side-by-side previews.
- Add a preview content provider to keep diff views in sync and wire it into the extension activation.
- Refresh configuration defaults/documentation to cover debounce, size limits, and the automatic suggestion workflow.
- Add explain-selection and selection quick-action commands (plus automatic prompts) so highlighted code can be refactored or summarized immediately.
- Update heuristic refactors to emit single-line `//` banners instead of bulky docblocks and extend the backend with an `/refactor` explain mode.
- Scaffold the GenRefactorer Assistant panel (Activity Bar view), including a context manager snapshot command so the upcoming Copilot-style UX has a dedicated surface and telemetry/logging hooks.
- Stream live workspace context (active editor metadata, preview text, and diagnostics) into the assistant panel and emit change events clients can subscribe to.
- Upgrade the assistant webview with structured status/log messaging, dynamic quick-action buttons, and persistent log history to pave the way for MCP-driven actions.
- Document the assistant panel usage guide plus the multi-milestone roadmap in `README.md` so users know what is available today and what is coming next.
- Capture Milestone 2 planning details (action orchestrator + MCP bridge) in dedicated documentation to guide the next development sprint.
- Add a shared Assistant Event Bus and Action Orchestrator so panel controls/logs/status updates flow through a single dispatcher instead of direct wiring.
- Introduce an MCP bridge skeleton (settings, status indicator, and stubbed connection states) to prepare for future Gemini integrations.
- Replace the MCP bridge stub with a functional WebSocket transport (auto-reconnect, logging, context push command) and expose the `GenRefactorer: Send Context Snapshot to MCP` action.
- Add an MCP coordinator that listens for bridge traffic, registers remote actions inside the assistant panel, applies MCP-provided edits, and launches VS Code terminals for requested tasks (including the new `GenRefactorer: Run MCP Action` command).
- Ship a mock MCP WebSocket server under `server/src/mcpMockServer.ts` so developers can try the bridge immediately (actions demonstrate `assistant/applyEdits` and `assistant/taskRequest` flows).
- Introduce a Gemini-backed MCP server (`server/src/mcpGeminiServer.ts`) plus `GeminiClient` helpers so remote actions can summarize files, suggest diagnostic fixes, and orchestrate git commits with AI-crafted messages.
- Enhance MCP task handling with command sequences, true process execution, and streaming stdout/stderr back into the assistant log for observability.
- Allow MCPs to drive diagnostics and git workflows end-to-end: diagnostic suggestions arrive via `assistant/applyEdits`, while git stage/commit flows run locally using structured task requests.
- Add `docs/progress-report.md` so the assistant roadmap, implementation details, and next steps are documented in one place.

## [0.0.1]

- Scaffold VS Code extension structure for the GenRefactorer AI refactoring assistant.
- Implement placeholder refactoring logic and command registrations.
- Add configuration options, build scripts, and test harness.
- Provide optional local backend service under `server/` offering `/refactor` endpoint compatible with the extension.
- Backend now supports OpenAI- or Gemini-driven refactoring (`LLM_PROVIDER`) when the corresponding API key is configured, falling back to heuristics otherwise.
