# GenRefactorer Backend

Local HTTP service that powers the GenRefactorer VS Code extension. It exposes a `/refactor` endpoint compatible with the extension's request/response contract.

## Setup

```bash
cd server
npm install
```

## Environment

- Create a `.env` file or export variables before starting the server:

```env
LLM_PROVIDER=openai  # or gemini
OPENAI_API_KEY=sk-your-openai-key
GEMINI_API_KEY=your-gemini-key
# Optional overrides
# OPENAI_MODEL=gpt-4o-mini
# OPENAI_BASE_URL=https://api.openai.com/v1
# GEMINI_MODEL=gemini-1.5-pro
```

If the chosen provider’s API key is missing, the service falls back to heuristic refactoring.

## Development

```bash
npm run dev
```

This starts the service on `http://localhost:5050` with hot reload.

## Build

```bash
npm run build
npm start
```

`npm start` serves the compiled output from `dist/server.js`.

## MCP Mock Server

A lightweight WebSocket server (`src/mcpMockServer.ts`) ships alongside the HTTP backend so you can exercise the VS Code MCP bridge without provisioning Gemini right away.

```bash
npm run mcp:mock:start
```

Optional environment variables:

- `MCP_PORT` – Port to bind (defaults to `5055`).

Once running, point `genRefactorer.assistant.mcpEndpoint` to `ws://localhost:<MCP_PORT>` and enable the bridge setting inside VS Code. The mock registers sample actions that either insert a banner at the top of the active file or run `npm run format` through a dedicated terminal.

### Gemini MCP Server

Need model-driven actions? Run `src/mcpGeminiServer.ts` instead:

```bash
GEMINI_API_KEY=your-key npm run mcp:gemini:start
```

Environment variables:

- `GEMINI_API_KEY` (required for real model calls; falls back to heuristics when omitted)
- `GEMINI_MODEL` (optional, defaults to `gemini-1.5-pro`)
- `MCP_GEMINI_PORT` (optional port, default `5056`)
- `MCP_WORKSPACE_DIR` (optional absolute path used when running git commands; defaults to the active file’s folder inside the context snapshot)

This server registers three reference actions (summarize active file, auto-fix diagnostics, stage & commit). It calls Gemini when available, then emits `assistant/applyEdits` or streamed `assistant/taskRequest` messages so the VS Code coordinator can apply diffs and run git commands locally.

## Endpoints

- `GET /health` – Lightweight status probe.
- `POST /refactor` – Accepts JSON payload:

```json
{
  "code": "<string>",
  "languageId": "<optional string>",
  "style": "conservative | balanced | aggressive",
  "includeDocumentation": true,
  "mode": "refactor | explain"
}
```

Returns:

```json
{
  "refactoredCode": "<string>",
  "explanation": "<string>"
}
```

When `mode` is set to `explain`, the service responds with an `explanation` only (no `refactoredCode`).

## Notes

- The current implementation applies deterministic heuristics (whitespace cleanup, inline banner comment insertion, lightweight language tweaks). Extend `src/refactorEngine.ts` to call your AI model or more advanced tooling.
- Adjust `PORT` via the `PORT` environment variable if you don't want to use 5050.
