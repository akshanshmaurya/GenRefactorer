# GenRefactorer Backend

Local HTTP service that powers the GenRefactorer VS Code extension. It exposes a `/refactor` endpoint compatible with the extension's request/response contract.

## Setup

```bash
cd server
npm install
```

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

## Endpoints

- `GET /health` – Lightweight status probe.
- `POST /refactor` – Accepts JSON payload:

```json
{
  "code": "<string>",
  "languageId": "<optional string>",
  "style": "conservative | balanced | aggressive",
  "includeDocumentation": true
}
```

Returns:

```json
{
  "refactoredCode": "<string>",
  "explanation": "<string>"
}
```

## Notes

- The current implementation applies deterministic heuristics (whitespace cleanup, doc banner insertion, lightweight language tweaks). Extend `src/refactorEngine.ts` to call your AI model or more advanced tooling.
- Adjust `PORT` via the `PORT` environment variable if you don't want to use 5050.
