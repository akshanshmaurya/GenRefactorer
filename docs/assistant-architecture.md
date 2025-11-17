# GenRefactorer Assistant Architecture Plan

## Objectives

1. Deliver a persistent sidebar assistant (Copilot-style) that can:
   - understand active workspace context (files, diagnostics, git state, test outcomes).
   - surface proactive suggestions, explanations, and fixes without requiring manual selections.
   - execute repo operations (apply edits, run scripts, create commits, push branches) with one-click confirmations.
2. Integrate a Gemini-powered MCP server so large-language-model reasoning can safely inspect the repository via constrained tools.
3. Provide automation hooks for lint/import/package fixes, dependency installs, and language-specific repair flows (JS/TS, Python, Java, etc.).
4. Maintain full auditability: every AI action logged, user prompted before destructive commands, option to disable/override behaviors.

## High-Level Architecture

```text
┌──────────────────────────────────────────────────────────────────────┐
│ VS Code Extension                                                    │
│  ┌──────────────────────┐    ┌────────────────────────────────────┐   │
│  │ Assistant Panel UI   │◄──►│ Action Orchestrator / Dispatcher  │◄──┐│
│  └──────────────────────┘    └────────────────────────────────────┘  ││
│             ▲                             ▲                          ││
│             │                             │                          ││
│  ┌──────────────────────┐    ┌────────────────────────────────────┐  ││
│  │ Workspace Context    │───►│ Gemini MCP Client Bridge          │──┘│
│  │ Manager (indexing)   │    └────────────────────────────────────┘   │
│             │                             ▲                          │
└─────────────┼─────────────────────────────┼────────────────────────────┘
              │                             │
              ▼                             │
      ┌────────────────┐        ┌────────────────────────────────────┐
      │ Diagnostics &  │        │ Gemini MCP Server (Node + Gemini) │
      │ Fix Providers  │        │  • Tools: read/write/search/run   │
      └────────────────┘        │  • Policy / rate limiter          │
                                └────────────────────────────────────┘
```

## Key Components

### 1. Assistant Panel UI

- Implement a `WebviewViewProvider` (e.g., `AssistantPanelProvider`) contributed under `viewsContainers` → `activitybar`. Features:
  - Chat thread panel (messages from user + Gemini + system events).
  - Pinned shortcut buttons: "Fix Diagnostics", "Explain Test Failure", "Commit & Push".
  - Diagnostics list with quick actions (apply fix, ignore, rerun).
  - Command log / audit trail.
- Messaging protocol: webview ↔ extension using `postMessage` to request actions or deliver updates.

### 2. Workspace Context Manager

- Background service inside extension collecting:
  - Active editor content + language metadata.
  - Recent files (MRU), selection info.
  - `vscode.languages.onDidChangeDiagnostics` snapshots grouped by file/severity.
  - Git data (branch, pending changes, last commit) via `vscode.git` extension API or shell fallback.
  - Dependency manifests (`package.json`, `pom.xml`, `requirements.txt`) + parsed dependency graph.
  - Last task outputs (test/lint results) captured via task hooks.
- Expose `getContextSnapshot()` for panel and MCP bridge; throttle to avoid performance hit.

### 3. Action Orchestrator

- Central dispatcher that receives intents (from webview buttons, Gemini tool calls, or commands) and executes them. Responsibilities:
  - Validate requested actions (safe vs privileged) based on user settings.
  - Invoke refactor/explain services, apply edits via `WorkspaceEdit`, show preview diffs.
  - Run shell commands (lint, npm install, mvn package) using VS Code tasks or integrated terminal, with streaming logs back to panel.
  - Handle git workflows: stage files, generate commit message (optionally via Gemini), run `git commit` and `git push` with progress updates.
  - Provide undo/rollback for applied suggestions where possible.

  ### 4. Diagnostics & Fix Providers

  - Per-language adapters listening to diagnostics and generating structured prompts for Gemini:
  - JS/TS: missing imports, eslint errors, package mismatches.
  - Python: import errors, pip dependencies.
  - Java: package/classpath issues, Maven/Gradle sync hints.
- Each adapter can call local heuristics (e.g., auto-add import) or ask Gemini via MCP for patch suggestions.
- Integrate with panel to show proposed fixes grouped by file.

### 5. Gemini MCP Server

- New service (under `mcp/` or reuse `server/` with additional entry point) exposing tools consumed by Gemini:
  - `fs.readFile`, `fs.writeFile`, `fs.search` (bounded glob patterns).
  - `context.snapshot` (fetch cached context from extension via bridge API).
  - `diagnostics.list` (per-file errors/warnings).
  - `git.status`, `git.commit`, `git.push` (commit requires staged diff summary + confirmation token from extension).
  - `task.run` (limited to allowlisted commands, e.g., `npm install`, `npm test`).
- Server authenticates using local tokens; extension mediates all file mutations (Gemini sends diff → extension applies via orchestrator).
- Build on Gemini API with specialized system prompts describing available tools and safety guidelines.

### 6. VS Code ↔ MCP Bridge

- Extension hosts a client connecting to MCP server (likely via WebSocket or stdio).
- When the user asks the assistant something, extension sends prompt + context snapshot to MCP; when Gemini responds with tool calls or suggested actions, client hands them to orchestrator.
- Bridge enforces quotas (max edits/min), logs every exchange for audit.

### 7. Git Automation

- Commands:
  - `genRefactorer.assistant.commit`: gather staged files, request commit message suggestion (Gemini), show preview & confirm.
  - `genRefactorer.assistant.push`: push selected branch, show output.
  - Optional "one-click" button: stage all + commit + push with AI-generated summary.
- Provide fallback when git CLI unavailable (surface actionable error).

### 8. Configuration & Security

- New settings:
  - `assistant.enablePanel`, `assistant.autoDiagnosticsFixes`, `assistant.allowedCommands`, `assistant.requireConfirmations`.
  - MCP connection settings (host/port/token) + provider selection.
  - Logging/audit options.
- Add command to export logs of all AI actions.

## Implementation Phases

1. **Foundation (Milestone 1)**
   - Create assistant panel webview with static UI and manual commands.
   - Build WorkspaceContextManager & Diagnostics collector.
   - Wire panel buttons to existing refactor/explain flows + new diagnostics list.

2. **Gemini MCP Integration (Milestone 2)**

    - Implement MCP server scaffolding (Node + Express + WebSocket/stdio) with file read/search tools.
    - Add MCP client bridge and route panel prompts through Gemini (mock responses first, then real API).
    - Introduce action orchestrator to apply diffs returned by Gemini.
    - Detailed plan captured in [docs/milestone-2-action-orchestrator.md](./milestone-2-action-orchestrator.md) covering scope, deliverables, and testing strategy.

3. **Diagnostics & Fixers (Milestone 3)**
   - Add language-specific adapters that convert VS Code diagnostics to structured prompts.
   - Implement automatic fix suggestions surfaced in panel (preview/apply).
   - Add dependency/package fix workflows (npm install, pip install, Maven sync) with confirmation.

4. **Git & Command Automation (Milestone 4)**
   - Build commit/push commands with Gemini-generated messages and side-panel buttons.
   - Allow MCP to request `git.status` / `git.commit` via orchestrator gating.
   - Add audit log export and advanced settings.

5. **Refinement & Hardening (Milestone 5)**
   - Optimize context streaming, add caching to reduce token usage.
   - Provide undo/rollback, telemetry, and polish UI (themes, icons).
   - Document MCP setup, permissions, and failure handling.

## Immediate Next Steps

1. Scaffold `AssistantPanelProvider` with placeholder UI + command plumbing.
2. Implement `WorkspaceContextManager` (active editor snapshot + diagnostics feed).
3. Define TypeScript interfaces for orchestrator intents/actions.
4. Establish project structure for MCP server (`mcp/` or extend `server/`), including README and basic tool registration.
5. Create configuration schema extensions for assistant & MCP settings.

Once these foundations are in place, we can iterate on MCP integration, automated fixes, and git workflows in parallel.
