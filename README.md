# GenRefactorer

GenRefactorer is a VS Code extension that brings a generative AI refactoring assistant directly into your editor. Paste legacy code, trigger a refactor pass, and review the AI-suggested cleanup before applying it to your workspace.

## Features

- **AI-powered refactor command** that rewrites the current selection using your chosen aggressiveness level.
- **On-demand explanations** outlining the changes performed during the latest refactor.
- **Flexible configuration** for API endpoint, authentication, documentation injection, and refactor style.
- **Preview flow** that lets you inspect suggestions in a scratch document before applying them.
- **Output channel logging** for traceability and debugging.

## Requirements

- Node.js 18+
- An API endpoint capable of performing code transformations (you supply the service and key).
- Without a configured endpoint, the extension falls back to the built-in heuristic refactorer.

## Extension Commands

- `GenRefactorer: Refactor Selection` – Sends the current selection to the AI service and optionally applies the result.
- `GenRefactorer: Explain Refactor` – Prints a summary of the most recent refactor to the output panel.
- `GenRefactorer: Open Settings` – Jumps to the extension settings section.

## Configuration

| Setting | Description |
| --- | --- |
| `genRefactorer.apiEndpoint` | URL of the refactoring backend service. |
| `genRefactorer.apiKey` | API key used to authenticate. Stored as machine-scoped. |
| `genRefactorer.refactorStyle` | Refactoring aggressiveness (`conservative`, `balanced`, `aggressive`). |
| `genRefactorer.includeDocumentation` | Adds inline documentation when the backend supports it. |

## Getting Started

1. Run `npm install` to install dependencies.
2. Press `F5` or run the **Run Extension** launch configuration.
3. Select a block of code and execute `GenRefactorer: Refactor Selection` from the command palette.
4. (Optional) To use the bundled backend, run it as described in [server/README.md](server/README.md) and set `genRefactorer.apiEndpoint` to `http://localhost:5050/refactor`.

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
  "includeDocumentation": true
}
```

### Response

```json
{
  "refactoredCode": "<string>",
  "explanation": "<optional string>"
}
```

## Release Notes

See [CHANGELOG.md](CHANGELOG.md) for details.
