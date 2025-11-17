# Milestone 2 Plan: Action Orchestrator & MCP Bridge

## Goal
Deliver the plumbing that lets the GenRefactorer assistant panel talk to a centralized dispatcher and sets the stage for Gemini MCP-powered automations.

## Success Criteria

- Assistant actions are defined declaratively and sourced from the Action Orchestrator (no hardcoded buttons inside the webview HTML).
- The orchestrator module can register actions, emit status/log events, and route execution to existing refactor/explain commands.
- A placeholder MCP bridge exists with configuration, lifecycle hooks, and status reporting to the assistant (even if it returns "disconnected" for now).
- Documentation captures the new flow plus any settings required to enable/observe it.

## Scope & Deliverables

| Area | Deliverable |
| --- | --- |
| Action Orchestrator | `src/actionOrchestrator.ts` exporting interfaces (`AssistantIntent`, `ActionTicket`, `ActionResult`) and a class that registers built-in intents (refactor, explain, refresh context). |
| Panel Integration | `AssistantPanelProvider` reads available actions from the orchestrator via dependency injection instead of static helper arrays. Actions include metadata for tooltips and future MCP gating. |
| Event Bus | Shared `AssistantEventBus` (type-safe emitter) relays status/log/context updates between orchestrator, panel, and future MCP bridge. |
| MCP Bridge Skeleton | `src/mcpBridge.ts` with configuration (`genRefactorer.assistant.mcpEndpoint`, token), connection state machine (Disconnected → Connecting → Ready), and reporting hooks into the event bus. |
| Configuration | Extend `package.json` contributes section with assistant + MCP settings, documenting them in README + CHANGELOG. |
| Documentation | Update `README.md` (Assistant Panel Guide + Roadmap) to mention the action orchestrator and MCP bridge placeholder. Add this plan to `docs/assistant-architecture.md`. |

## Work Breakdown

1. **Type Definitions**
   - Create `src/types/assistant.ts` with shared types for actions, events, intents, MCP payloads.
2. **Assistant Event Bus**
   - Lightweight wrapper over `vscode.EventEmitter` supporting: `statusChanged`, `logEntry`, `contextUpdated`, `actionsChanged`, `bridgeStateChanged`.
3. **Action Orchestrator**
   - Constructor accepts dependencies (RefactorService, WorkspaceContextManager, event bus).
   - Registers built-in actions using `registerAction({ id, label, run })`.
   - Provides methods for panel/commands to retrieve actions and dispatch intents.
4. **Panel Wiring**
   - Replace current `getDefaultAssistantActions()` helper in `extension.ts` with orchestrator-provided list.
   - Subscribe panel to the event bus for actions/logs/status.
5. **MCP Bridge Skeleton**
   - Implement stub class that reads settings, exposes `connect()`, `disconnect()`, and emits state transitions.
   - For now, keep connection disabled unless `assistant.enableMcpBridge` is true; emit warnings if settings missing.
6. **Configuration & Docs**
   - Add new settings to `package.json` and describe them in README.
   - Record the milestone plan and implementation notes in `docs/assistant-architecture.md` + CHANGELOG entry.
7. **Validation**
   - Run `npm run compile` and manually verify the assistant panel reflects orchestrator-provided actions/status.

## Testing Strategy

- Unit-level coverage via existing compile/type checks.
- Manual integration test: start extension, open assistant view, ensure buttons still trigger refactor/explain, observe status/log updates.
- Simulate MCP bridge state changes using mock commands (e.g., `assistant.debug.toggleBridge`), ensuring the panel displays connection state.

## Risks & Mitigations

- **Event Storming:** Excessive status/log events could spam the webview. Mitigate with throttling/merging inside event bus.
- **API Churn:** Types will evolve once MCP integration lands. Keep them in a dedicated `types` module to minimize refactors.
- **User Settings Confusion:** Clearly label new settings as experimental and off by default; provide warnings in logs when MCP configs are incomplete.

## Timeline (Target)

- Type definitions + event bus: 0.5 day
- Orchestrator scaffold + wiring: 1 day
- MCP bridge skeleton + settings: 0.5 day
- Documentation & validation: 0.5 day

Total: ~2.5 focused days for Milestone 2 foundation.
