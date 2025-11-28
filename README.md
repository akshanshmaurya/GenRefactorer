# GenRefactorer

GenRefactorer is a VS Code extension that brings a generative AI refactoring assistant directly into your editor, powered by **Google Gemini**. It refactors legacy code, explains complex logic, detects security vulnerabilities, and even handles git commits—all without requiring a separate backend server.

## Features

- **AI-Powered Refactoring**: Intelligently rewrites code based on your preferred style (`conservative`, `balanced`, `aggressive`) using Gemini.
- **Smart Explanations**: Generates concise, context-aware explanations for any code selection.
- **Security Vulnerability Detection**: Scans your code for security flaws (SQLi, XSS, etc.) and suggests fixes with severity ratings.
- **Smart Git Commits**: Generates meaningful commit messages based on your changes and handles staging/committing directly from VS Code.
- **Zero-Config Setup**: Automatically detects your API key from a `.env` file or VS Code settings.
- **Assistant Panel**: A dedicated side panel for tracking status, logs, and quick actions.
- **MCP Bridge (Experimental)**: Connects to local MCP servers for advanced workflows.

## Requirements

- **Google Gemini API Key**: Get one from [Google AI Studio](https://aistudio.google.com/).
- **Git**: Required for the Smart Commit feature.

## Extension Commands

- `GenRefactorer: Refactor Selection` – Refactors the selected code.
- `GenRefactorer: Explain Selection` – Explains the selected code.
- `GenRefactorer: Scan for Security Vulnerabilities` – Analyzes code for security issues.
- `GenRefactorer: Smart Commit Changes` – Generates a commit message and commits the current file.
- `GenRefactorer: Selection Actions` – Opens a quick picker for available actions.
- `GenRefactorer: Open Settings` – Opens the extension settings.

## Configuration

| Setting | Description | Default |
| --- | --- | --- |
| `genRefactorer.apiKey` | Your Google Gemini API Key. Can also be read from a `.env` file (`GEMINI_API_KEY`). | `""` |
| `genRefactorer.model` | The Gemini model to use (e.g., `gemini-2.5-flash`, `gemini-1.5-pro`). | `gemini-2.5-flash` |
| `genRefactorer.refactorStyle` | Aggressiveness of refactoring (`conservative`, `balanced`, `aggressive`). | `balanced` |
| `genRefactorer.includeDocumentation` | Whether to add documentation comments to refactored code. | `true` |
| `genRefactorer.autoRefactorOnSelection` | Enable background refactoring suggestions. | `false` |

## Getting Started

1.  **Install**: Install the extension.
2.  **Configure API Key**:
    *   Set `genRefactorer.apiKey` in VS Code settings.
    *   OR create a `.env` file in your workspace root with `GEMINI_API_KEY=your_key`.
3.  **Use It**:
    *   Select code and run `GenRefactorer: Refactor Selection`.
    *   Select code and run `GenRefactorer: Scan for Security Vulnerabilities`.
    *   Open a file in a git repo and run `GenRefactorer: Smart Commit Changes`.

## Assistant Panel

The GenRefactorer view in the Activity Bar provides:
- **Status & Logs**: Real-time updates on what the AI is doing.
- **Quick Actions**: One-click access to common commands.
- **Context Snapshot**: View the current active context being sent to the AI.

## MCP Bridge (Experimental)

GenRefactorer can connect to a Model Context Protocol (MCP) server for advanced, agentic workflows.
1.  Enable `genRefactorer.assistant.enableMcpBridge`.
2.  Set `genRefactorer.assistant.mcpEndpoint` (e.g., `ws://localhost:5055`).
3.  Use "Send Context to MCP" to stream workspace data to your external agent.

## Release Notes

See [CHANGELOG.md](CHANGELOG.md) for details.
