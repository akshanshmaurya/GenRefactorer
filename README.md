# GenRefactorer

GenRefactorer is a VS Code extension that brings a generative AI refactoring assistant directly into your editor. Paste legacy code, trigger a refactor pass, and review the AI-suggested cleanup before applying it to your workspace.

## Features

- **AI-powered refactor command** that rewrites the current selection using your chosen aggressiveness level.
- **On-demand explanations** outlining the changes performed during the latest refactor.
- **Flexible configuration** for API endpoint, authentication, documentation injection, and refactor style.
- **Preview flow** that lets you inspect suggestions in a scratch document before applying them.
- **Output channel logging** for traceability and debugging.
- **Automatic inline suggestions** that watch the active document, surface background refactors in a side-by-side diff, and let you apply or dismiss them instantly.
- **Selection quick actions** that pop up whenever you highlight code so you can refactor or explain the snippet without touching the command palette.
- **Assistant side panel** that streams workspace context (active file + diagnostics), keeps a running log with severity markers, and exposes quick actions on the path to the full Copilot-style experience described in the roadmap.
- **MCP bridge + remote quick actions** so Gemini/MCP servers (mocked or real) can register buttons, request context, push edits, run tasks, and even automate git workflows directly from VS Code.

## Requirements

- Node.js 18+
- An API endpoint capable of performing code transformations (you supply the service and key).
- Without a configured endpoint, the extension falls back to the built-in heuristic refactorer.

## Extension Commands

- `GenRefactorer: Refactor Selection` – Sends the current selection to the AI service and optionally applies the result.
- `GenRefactorer: Explain Selection` – Generates a concise explanation of the highlighted code (LLM or heuristic fallback) and prints it to the output panel.
- `GenRefactorer: Selection Actions` – Opens the quick action picker manually in case you disabled automatic prompts.
- `GenRefactorer: Refresh Assistant Context` – Forces the assistant sidebar to capture a fresh snapshot of the active editor + diagnostics (useful while testing the new panel).
- `GenRefactorer: Send Context Snapshot to MCP` – Pushes the latest workspace snapshot through the MCP bridge (when enabled) so external automation can reason about the repo.
- `GenRefactorer: Run MCP Action` – Invokes a remote action registered by your MCP server/mocked endpoint (triggered automatically when you click a remote button in the assistant panel).
- `GenRefactorer: Explain Refactor` – Prints a summary of the most recent refactor to the output panel.
- `GenRefactorer: Open Settings` – Jumps to the extension settings section.

## Configuration

| Setting | Description |
| --- | --- |
| `genRefactorer.apiEndpoint` | URL of the refactoring backend service. |
| `genRefactorer.apiKey` | API key used to authenticate. Stored as machine-scoped. |
| `genRefactorer.refactorStyle` | Refactoring aggressiveness (`conservative`, `balanced`, `aggressive`). |
| `genRefactorer.includeDocumentation` | Adds inline documentation when the backend supports it. |
| `genRefactorer.autoRefactorOnSelection` | Enables the background refactor experience for the active editor. |
| `genRefactorer.autoRefactorDebounceMs` | Delay (ms) after typing stops before a background refactor is requested. |
| `genRefactorer.maxAutoRefactorCharacters` | Maximum document size the background pass will attempt (defaults to 8k characters). |
| `genRefactorer.showSelectionActions` | When `true`, GenRefactorer automatically shows a quick action picker (Refactor vs Explain) whenever you select code. |
| `genRefactorer.assistant.enableMcpBridge` | Enables the experimental MCP bridge so the assistant can show its connection status (disabled by default). |
| `genRefactorer.assistant.mcpEndpoint` | URL of the MCP server to connect to when the bridge is enabled. |
| `genRefactorer.assistant.mcpAuthToken` | Optional authentication token sent to the MCP server (stored as machine-scoped). |

## Getting Started

1. Run `npm install` to install dependencies.
2. Press `F5` or run the **Run Extension** launch configuration.
3. Select a block of code and execute `GenRefactorer: Refactor Selection` from the command palette (or simply start editing to let the background suggestion system surface ideas automatically).
4. Open the **GenRefactorer** view in the Activity Bar to pin the assistant panel; use its buttons to trigger refactors, explanations, or context refreshes without the command palette.
5. For a clean evaluation, temporarily disable other AI assistants so GenRefactorer is the only source of suggestions.
6. (Optional) To use the bundled backend, run it as described in [server/README.md](server/README.md), choose a provider via `LLM_PROVIDER` (`openai` or `gemini`), supply the corresponding API key, and point `genRefactorer.apiEndpoint` to `http://localhost:5050/refactor`.

## Assistant Panel Guide

The GenRefactorer assistant view ships with the first milestone of the Copilot-style workflow:

- **Quick Actions:** Buttons are driven by the extension, so future MCP or git automations can appear without updating the webview code. Today you get refactor, explain, selection actions, and refresh context. Hover for descriptions.
- **Status + Logs:** Command invocations push status updates (`idle`, `processing`, `error`) plus structured log entries with timestamps and severity colors. Logs persist (up to 50 entries) even as the panel reloads.
- **Workspace Context Snapshot:** The panel listens to the `WorkspaceContextManager` and shows the current file name, language, selection span, preview text (trimmed to 4k chars), and the latest diagnostics summary. Manual refresh is available via the panel itself or the command palette.
- **MCP Bridge Indicator:** The header now shows whether the MCP bridge is disconnected, connecting, ready, or in error. Toggle `genRefactorer.assistant.enableMcpBridge`, set your WebSocket endpoint/token, and use the **Send Context to MCP** action to stream snapshots into your automation surface.

### MCP Bridge (Experimental)

1. Enable `genRefactorer.assistant.enableMcpBridge` in VS Code settings.
2. Provide a WebSocket endpoint (for example `ws://localhost:5055`) where your MCP/Gemini server listens, plus an optional bearer token via `genRefactorer.assistant.mcpAuthToken`.
3. Watch the assistant header for state changes (Disconnected → Connecting → Ready). Connection retries are automatic with exponential backoff.
4. Use the **Send Context to MCP** action (or run the matching command) to push the latest `WorkspaceContextSnapshot` to your backend. Incoming/outgoing messages are logged in the assistant panel for traceability.
5. Once connected, any actions registered by the MCP server appear as buttons in the panel. The reference Gemini server ships with:

- **Summarize Active File** – Streams the active editor preview into Gemini and logs a natural-language summary.
- **Auto-Fix Diagnostics** – Reads the latest diagnostics array and inserts suggestion comments near the first few errors.
- **Stage & Commit (AI)** – Generates a commit message (Gemini if configured, fallback otherwise) and runs `git add/commit` via streamed process output.

**Usage tips:**

1. Pin the assistant view, then trigger a refactor/explain directly from the panel to watch logs update in real time.
2. Keep the Diagnositcs section visible while working through lint errors—the list mirrors VS Code's Problems panel but stays contextualized within the assistant workflow.
3. When testing new backend flows, tap **Refresh Context** before kicking off a run so the panel reflects your active file preview and selection text.
4. Once the MCP bridge reads *Ready*, click any remote quick action to see the orchestrator send structured requests (edits, git commands, or streamed terminal tasks) to your workspace.

### Mock MCP Server

A lightweight WebSocket server lives under `server/src/mcpMockServer.ts` so you can exercise the bridge without wiring a full Gemini/IAP stack. It registers two sample actions:

- **Apply File Banner** – Inserts a comment header at the top of the active editor by sending an `assistant/applyEdits` payload.
- **Run npm format** – Streams a `assistant/taskRequest` payload that fires `npm run format` in a dedicated VS Code terminal.

To run it:

```bash
cd server
npm run mcp:mock:start
```

Pair it with the bridge settings (`enableMcpBridge = true`, `mcpEndpoint = ws://localhost:5055`) and pin the assistant panel to watch logs, registered actions, and edit/task requests flow through the orchestrator.

### Gemini MCP Server

Ready to test model-driven actions? A richer WebSocket server lives under `server/src/mcpGeminiServer.ts` and uses the Gemini API (or a heuristic fallback) to power remote workflows.

```bash
cd server
GEMINI_API_KEY=your-key npm run mcp:gemini:start
```

Environment variables:

| Variable | Description |
| --- | --- |
| `GEMINI_API_KEY` | Required to call Gemini. When omitted, the server falls back to deterministic suggestions. |
| `GEMINI_MODEL` | Optional override (defaults to `gemini-1.5-pro`). |
| `MCP_GEMINI_PORT` | Port for the Gemini server (defaults to `5056`). |
| `MCP_WORKSPACE_DIR` | Absolute path used when running git commands (defaults to the active file’s folder). |

With the Gemini server running, enable the MCP bridge and set `mcpEndpoint` to `ws://localhost:5056`. You’ll see the three reference actions (Summarize, Auto-Fix Diagnostics, Stage & Commit) appear in the assistant panel, and their process output streams directly into the assistant logs.

## Assistant Roadmap

GenRefactorer is marching toward a Copilot-like experience that owns the full lifecycle (context gathering, MCP action routing, git automation). The current milestone delivered the sidebar foundation plus live context streaming. The upcoming milestones include:

1. **Action Orchestrator & MCP hooks:** surface streaming conversations, queue actions (lint fix, dependency install), and hand them to a local MCP server.
2. **Inline Suggestions 2.0:** push assistant-generated code edits directly into inline diff decorations, keeping the panel as the command center/log.
3. **Git Automation:** expose staged changes, commit templates, and one-click push flow wired into the assistant actions list.

Track progress and interim deliverables in [docs/assistant-architecture.md](docs/assistant-architecture.md) and the changelog.

For an end-to-end summary of the implementation status and how each milestone was delivered, see [docs/progress-report.md](docs/progress-report.md).

## Testing

- `npm test` launches the VS Code test runner with Mocha.

## Known Limitations

- The sample refactor logic ships with a mock implementation. Replace the local fallback in `RefactorService` with real API calls when integrating your backend.
- Only the primary selection is refactored. Multi-selection support is a future enhancement.
- Remote refactoring expects a JSON API that accepts the request body documented below and returns `refactoredCode` plus an optional `explanation`.

## Backend Contract

### Request

```http
POST <apiEndpoint>
Authorization: Bearer <apiKey>
Content-Type: application/json

{
  "code": "<string>",
  "languageId": "<string>",
  "style": "conservative | balanced | aggressive",
  "includeDocumentation": true,
  "mode": "refactor | explain"
}
```

### Response

```json
{
  "refactoredCode": "<string>",
  "explanation": "<optional string>"
}
```

When `mode` is set to `explain`, only the `explanation` field is populated.

## Release Notes

See [CHANGELOG.md](CHANGELOG.md) for details.
