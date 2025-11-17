# GenRefactorer Assistant Progress Report

> Last updated: 2025-11-17

## 1. Foundation & Refactor Flow

- **Auto Refactor + Preview** (`src/autoRefactorController.ts`, `src/previewProvider.ts`) continuously watches the active editor, prepares AI suggestions, and renders a side-by-side diff using the `gen-refactorer-preview` document scheme.
- **Selection Commands** (`genRefactorer.refactorSelection`, `genRefactorer.explainSelection`, `genRefactorer.showSelectionActions`) let you refactor/explain highlighted code or open the quick-action picker without touching the command palette.
- **Backend Contract** documented under `server/README.md`; local Node/Express service supports `/refactor` with heuristic fallback plus Gemini/OpenAI providers.

### How it was implemented

1. Scaffolded the VS Code extension entry point (`src/extension.ts`) with command registrations and configuration wiring.
2. Added `RefactorService` to encapsulate API calls and fallback heuristics.
3. Introduced preview/content provider so inline suggestions render without writing temp files.

## 2. Assistant Panel (Milestone 1)

- **Webview View** (`src/assistantPanel.ts`) lives in the GenRefactorer activity-bar container and now renders:
  - Quick actions (refactor, explain, selection actions, refresh context, send context to MCP).
  - Status indicator + persistent log entries (up to 50, with severity colors and timestamps).
  - Workspace snapshot (file metadata, selection range, preview text, diagnostics list).
  - MCP bridge indicator showing live connection status.
- **WorkspaceContextManager** (`src/workspaceContextManager.ts`) streams active editor info + diagnostics with throttling and exposes a `onDidChangeSnapshot` event.

### Implementation notes (Panel)

1. Panel HTML/JS listens for message types (`assistant.status`, `assistant.log`, `assistant.context`, `assistant.actions`, `assistant.bridge`).
2. Context manager fires updates whenever editors, selections, documents, or diagnostics change.
3. Panel stores last-known snapshot/logs so late webview loads receive immediate state replays.

## 3. Assistant Event Bus & Orchestrator (Milestone 2 groundwork)

- **Types** (`src/types/assistant.ts`) define shared contracts for status/log entries, actions, bridge states, and MCP messages.
- **Event Bus** (`src/assistantEventBus.ts`) provides `publishStatus`, `log`, `publishContext`, `publishActions`, `publishBridgeState`, and `publishBridgeMessage`. Subscribers: panel, orchestrator, MCP bridge.
- **Action Orchestrator** (`src/actionOrchestrator.ts`) owns the quick-action definitions and publishes changes to the panel via the bus.
- Extension activation now instantiates the bus, orchestrator, panel, context manager, and registers default actions in one place.

### Implementation notes (Event Bus + Orchestrator)

1. All commands now report to the assistant via `assistantBus` (status + logs) instead of direct panel calls.
2. The bus sequences log IDs for consistent ordering and allows future listeners (e.g., telemetry).
3. Quick actions are declarative, making it easy to insert MCP-driven buttons later.

## 4. MCP Bridge (Experimental)

- **Transport** (`src/mcpBridge.ts`): WebSocket-based client with optional bearer auth, exponential backoff reconnect (up to 30s), and automatic hello message. Outbound/inbound traffic is surfaced through the event bus.
- **Settings** (`package.json` + README):
  - `genRefactorer.assistant.enableMcpBridge`
  - `genRefactorer.assistant.mcpEndpoint`
  - `genRefactorer.assistant.mcpAuthToken`
- **Commands/Actions**:
  - `GenRefactorer: Send Context Snapshot to MCP` (`genRefactorer.assistant.sendContextToMcp`) pushes the latest `WorkspaceContextSnapshot` to the connected server.
  - Quick action button mirrors the command inside the assistant panel.
- **Panel UI** displays connection status and logs each bridge message for auditing.

### How to use

1. Enable the bridge in settings, set your MCP WebSocket endpoint (e.g., `ws://localhost:5055`), and optionally supply an auth token.
2. Watch the assistant header for state transitions: Disconnected → Connecting → Ready. Errors auto-retry with exponential backoff.
3. Use the **Send Context to MCP** action to stream the current snapshot to your MCP/Gemini service. Logs will show outbound/inbound messages.
4. Extend `src/mcpBridge.ts` and the orchestrator to route Gemini tool calls as future milestones.

## 5. MCP Coordinator & Servers

- **Coordinator** (`src/mcpCoordinator.ts`) listens to the bridge event stream, registers remote actions with the orchestrator, relays context requests, applies diff payloads, and launches VS Code terminals when MCP asks to run a task.
- **Unified command** (`genRefactorer.assistant.runMcpAction`) powers every MCP-sourced quick action so buttons inside the assistant view can execute structured tool calls without webview changes.
- **Mock MCP Server** (`server/src/mcpMockServer.ts`) offers a lightweight WebSocket endpoint that registers sample actions (apply file banner, run `npm run format`), demonstrating `assistant/applyEdits` and `assistant/taskRequest` flows end to end.

### Usage overview

1. Start the mock server via `npm run mcp:mock:start` inside `server/` (optional `MCP_PORT` env var).
2. Enable the bridge settings and watch the assistant panel show the registered MCP actions moments after the connection reads **Ready**.
3. Trigger a remote action in the panel to see structured edits or tasks applied locally; the coordinator logs every step and updates assistant status automatically.

## 6. Gemini MCP Server & Advanced Workflows

- **Gemini server** (`server/src/mcpGeminiServer.ts`) upgrades the mock transport into a model-driven host. It registers three reference actions: summarize the active file, auto-fix diagnostics (inserts Gemini comments near errors), and stage + commit using an AI-crafted message.
- **Gemini client** (`server/src/geminiClient.ts`) encapsulates prompt calls with graceful fallbacks when `GEMINI_API_KEY` is missing, so the workflow still behaves deterministically.
- **Diagnostics-aware actions** now rely on the streaming context snapshot: the MCP server inspects `snapshot.diagnostics`, requests apply-edit payloads, and the coordinator merges them into the workspace.
- **Git automation** is enabled via structured task sequences. The server issues an `assistant/taskRequest` with `mode: process` plus a `git add`/`git commit` sequence; the coordinator executes each step locally and reports success or errors back to the assistant UI.
- **Task streaming**: process-mode commands capture stdout/stderr and replay each line through `assistant.log`, so long-running tasks (tests, git, npm) stream directly inside the panel instead of hiding in the terminal.

## 7. Documentation Updates

- `README.md`: Expanded assistant guide, configuration table, and dedicated MCP bridge section with step-by-step instructions.
- `docs/milestone-2-action-orchestrator.md`: Detailed plan covering scope, deliverables, testing, risks, and timeline for the action orchestrator + MCP integration milestone.
- `CHANGELOG.md`: Tracks assistant panel upgrades, event bus/orchestrator work, MCP bridge transport, and new commands/settings.
- This progress report summarises what has been shipped so far and how it was implemented.

## 8. Next Steps (per roadmap)

1. **Tool-call persistence**: add stateful chat threads so Gemini can reason across multiple requests (not just single-shot actions) and keep explaining previous refactors.
2. **Diagnostics patching**: move from comment hints to full diff application, including multi-file edits and optional undo previews.
3. **Git push & review hooks**: extend MCP actions beyond commit to push branches, open PRs, and summarize staged diffs inside the assistant.
4. **Inline Suggestions 2.0**: feed assistant-generated edits directly into inline diff decorations while logging activity in the panel.

## 9. File Reference

| Area | Key Files |
| --- | --- |
| Assistant UI | `src/assistantPanel.ts` |
| Context Capture | `src/workspaceContextManager.ts` |
| Event Bus & Actions | `src/assistantEventBus.ts`, `src/actionOrchestrator.ts`, `src/types/assistant.ts` |
| MCP Bridge & Coordinator | `src/mcpBridge.ts`, `src/mcpCoordinator.ts` |
| MCP Servers | `server/src/mcpMockServer.ts`, `server/src/mcpGeminiServer.ts`, `server/src/geminiClient.ts` |
| Extension Wiring | `src/extension.ts`, `package.json` |
| Documentation | `README.md`, `CHANGELOG.md`, `docs/milestone-2-action-orchestrator.md`, `docs/progress-report.md` |

Refer to these components whenever you need to understand or extend the assistant’s functionality.
