import * as vscode from 'vscode';
import { AssistantEventBus } from './assistantEventBus';
import { WorkspaceContextSnapshot } from './workspaceContextManager';
import { AssistantAction, AssistantLogEntry, AssistantStatus, BridgeStateUpdate } from './types/assistant';

interface AssistantPanelState {
  status: AssistantStatus;
  lastMessage?: string;
}

export class AssistantPanelProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'genRefactorer.assistantPanel';
  private view?: vscode.WebviewView;
  private state: AssistantPanelState = { status: 'idle' };
  private contextSnapshot?: WorkspaceContextSnapshot;
  private actions: AssistantAction[] = [];
  private readonly logEntries: AssistantLogEntry[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private bridgeState: BridgeStateUpdate = { state: 'disconnected', message: 'MCP bridge not connected.' };

  public constructor(private readonly _context: vscode.ExtensionContext, private readonly bus: AssistantEventBus) {
    this.disposables.push(
      this.bus.onStatusChanged((payload) => {
        this.state = { status: payload.status, lastMessage: payload.lastMessage };
        this.postMessage({ type: 'assistant.status', payload: this.state });
      }),
      this.bus.onLogEntry((payload) => {
        this.addLogEntry(payload.entry);
      }),
      this.bus.onContextChanged((payload) => {
        this.contextSnapshot = payload.snapshot;
        this.postMessage({ type: 'assistant.context', payload: payload.snapshot });
      }),
      this.bus.onActionsChanged((payload) => {
        this.actions = payload.actions;
        this.postMessage({ type: 'assistant.actions', payload: payload.actions });
      }),
      this.bus.onBridgeStateChanged((payload) => {
        this.bridgeState = payload;
        this.postMessage({ type: 'assistant.bridge', payload });
      })
    );
  }

  public dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true
    };
    webviewView.webview.html = this.renderHtml();

    webviewView.webview.onDidReceiveMessage((message) => {
      if (message && message.type === 'assistant.command') {
        void vscode.commands.executeCommand(message.command, ...(message.args ?? []));
      }
    });

    if (this.contextSnapshot) {
      this.postMessage({ type: 'assistant.context', payload: this.contextSnapshot });
    }

    this.postMessage({ type: 'assistant.status', payload: this.state });

    if (this.actions.length) {
      this.postMessage({ type: 'assistant.actions', payload: this.actions });
    }

    if (this.logEntries.length) {
      this.logEntries.forEach((entry) => this.postMessage({ type: 'assistant.log', payload: entry }));
    }

    if (this.bridgeState) {
      this.postMessage({ type: 'assistant.bridge', payload: this.bridgeState });
    }
  }

  private postMessage(message: unknown): void {
    if (!this.view) {
      return;
    }
    void this.view.webview.postMessage(message);
  }

  private addLogEntry(entry: AssistantLogEntry): void {
    this.logEntries.push(entry);
    if (this.logEntries.length > 50) {
      this.logEntries.shift();
    }
    this.postMessage({ type: 'assistant.log', payload: entry });
  }

  private renderHtml(): string {
    const nonce = getNonce();
    const { status } = this.state;

    return /* html */ `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <style>
            :root {
              color-scheme: light dark;
            }
            body {
              margin: 0;
              padding: 0;
              font-family: var(--vscode-font-family);
              font-size: 13px;
              color: var(--vscode-foreground);
              background: var(--vscode-sideBar-background);
            }
            .panel-header {
              padding: 12px 16px;
              border-bottom: 1px solid var(--vscode-panel-border);
            }
            h1 {
              margin: 0;
              font-size: 14px;
            }
            h2 {
              margin: 0 0 4px;
              font-size: 13px;
            }
            .status {
              font-size: 12px;
              color: var(--vscode-descriptionForeground);
            }
            .bridge-state {
              font-size: 11px;
              color: var(--vscode-descriptionForeground);
            }
            .bridge-state[data-state="ready"] {
              color: var(--vscode-testing-iconPassed);
            }
            .bridge-state[data-state="error"] {
              color: var(--vscode-editorError-foreground);
            }
            .actions {
              padding: 12px 16px;
              display: flex;
              gap: 8px;
              flex-wrap: wrap;
            }
            button {
              padding: 6px 12px;
              border: 1px solid var(--vscode-button-border, transparent);
              border-radius: 4px;
              background: var(--vscode-button-secondaryBackground);
              color: var(--vscode-button-secondaryForeground);
              cursor: pointer;
            }
            button.primary {
              background: var(--vscode-button-background);
              color: var(--vscode-button-foreground);
            }
            button:disabled {
              opacity: 0.5;
              cursor: not-allowed;
            }
            ul {
              list-style: none;
              padding: 0 16px 16px;
              margin: 0;
            }
            li {
              margin-bottom: 8px;
            }
            .log {
              font-family: var(--vscode-editor-font-family);
              font-size: 12px;
              background: var(--vscode-textBlockQuote-background);
              padding: 12px 16px;
              margin: 0 16px 16px;
              border-radius: 4px;
              max-height: 160px;
              overflow-y: auto;
            }
            section.context,
            section.diagnostics {
              border-top: 1px solid var(--vscode-panel-border);
              padding: 12px 16px;
            }
            section.context header,
            section.diagnostics header {
              padding: 0;
              border: none;
              margin-bottom: 8px;
            }
            .context-block {
              display: grid;
              gap: 4px;
            }
            .preview {
              margin-top: 8px;
            }
            pre {
              font-family: var(--vscode-editor-font-family);
              font-size: 12px;
              background: var(--vscode-editor-background);
              padding: 8px;
              border-radius: 4px;
              max-height: 180px;
              overflow: auto;
            }
            .diagnostics li {
              font-size: 12px;
            }
            .status[data-state="processing"] {
              color: var(--vscode-progressBar-background);
            }
            .status[data-state="error"] {
              color: var(--vscode-editorError-foreground);
            }
            .actions[data-actions] {
              border-top: 1px solid var(--vscode-panel-border);
              border-bottom: 1px solid var(--vscode-panel-border);
            }
            .actions .empty-actions {
              color: var(--vscode-descriptionForeground);
              font-size: 12px;
            }
            .log-entries {
              padding: 0 16px 16px;
              margin: 0;
              list-style: none;
            }
            .log-entry {
              display: flex;
              flex-direction: column;
              gap: 2px;
              border-left: 3px solid transparent;
              padding: 6px 8px;
              margin-bottom: 6px;
              background: var(--vscode-textBlockQuote-background);
              border-radius: 4px;
            }
            .log-entry .meta {
              font-size: 10px;
              color: var(--vscode-descriptionForeground);
            }
            .log-entry.level-info {
              border-color: var(--vscode-button-secondaryBackground);
            }
            .log-entry.level-warn {
              border-color: var(--vscode-editorWarning-foreground);
            }
            .log-entry.level-error {
              border-color: var(--vscode-editorError-foreground);
            }
          </style>
        </head>
        <body>
          <header class="panel-header">
            <h1>GenRefactorer Assistant</h1>
            <div class="status" data-state="${status}">Status: <span data-status>${status}</span></div>
            <div class="bridge-state" data-bridge-state data-state="${this.bridgeState.state}">
              Bridge: <span data-bridge-label>${this.bridgeState.state}</span>
            </div>
          </header>
          <section class="actions" data-actions>
            <div class="empty-actions">No quick actions available.</div>
          </section>
          <section>
            <ul class="log-entries" data-log></ul>
          </section>
          <section class="log" data-last-message>Awaiting assistant activity...</section>
          <section class="context">
            <header>
              <h2>Workspace Context</h2>
              <div class="timestamp" data-context-timestamp>Snapshot pending...</div>
            </header>
            <div class="context-block">
              <div><strong>File:</strong> <span data-active-file>-</span></div>
              <div><strong>Language:</strong> <span data-language>-</span></div>
              <div><strong>Selection:</strong> <span data-selection>-</span></div>
            </div>
            <div class="preview">
              <strong>Preview</strong>
              <pre data-preview>Open a file to see its preview.</pre>
            </div>
          </section>
          <section class="diagnostics">
            <header>
              <h2>Diagnostics</h2>
              <div data-diagnostics-summary>No diagnostics captured.</div>
            </header>
            <ul data-diagnostics></ul>
          </section>
          <script nonce="${nonce}">
            const vscode = acquireVsCodeApi();
            const statusEl = document.querySelector('[data-status]');
            const statusContainer = document.querySelector('.status');
            const bridgeStateEl = document.querySelector('[data-bridge-state]');
            const bridgeLabelEl = document.querySelector('[data-bridge-label]');
            const logList = document.querySelector('[data-log]');
            const lastMessageEl = document.querySelector('[data-last-message]');
            const activeFileEl = document.querySelector('[data-active-file]');
            const languageEl = document.querySelector('[data-language]');
            const selectionEl = document.querySelector('[data-selection]');
            const previewEl = document.querySelector('[data-preview]');
            const diagnosticsSummaryEl = document.querySelector('[data-diagnostics-summary]');
            const diagnosticsListEl = document.querySelector('[data-diagnostics]');
            const contextTimestampEl = document.querySelector('[data-context-timestamp]');
            const actionsContainer = document.querySelector('[data-actions]');
            let currentActions = [];

            window.addEventListener('message', (event) => {
              const message = event.data;
              if (message?.type === 'assistant.status') {
                statusEl.textContent = message.payload.status;
                statusContainer?.setAttribute('data-state', message.payload.status);
                if (message.payload.lastMessage) {
                  lastMessageEl.textContent = message.payload.lastMessage;
                }
              } else if (message?.type === 'assistant.log') {
                appendLogEntry(message.payload);
              } else if (message?.type === 'assistant.context') {
                renderContext(message.payload);
              } else if (message?.type === 'assistant.actions') {
                currentActions = Array.isArray(message.payload) ? message.payload : [];
                renderActions(currentActions);
              } else if (message?.type === 'assistant.bridge') {
                renderBridgeState(message.payload);
              }
            });

            function renderActions(actions) {
              if (!actionsContainer) {
                return;
              }

              actionsContainer.innerHTML = '';
              if (!actions || !actions.length) {
                const empty = document.createElement('div');
                empty.className = 'empty-actions';
                empty.textContent = 'No quick actions available.';
                actionsContainer.appendChild(empty);
                return;
              }

              actions.forEach((action) => {
                const button = document.createElement('button');
                button.textContent = action.label;
                if (action.emphasis === 'primary') {
                  button.classList.add('primary');
                }
                button.setAttribute('data-command', action.command);
                if (action.args) {
                  button.setAttribute('data-args', JSON.stringify(action.args));
                }
                if (action.description) {
                  button.title = action.description;
                }
                if (action.disabled) {
                  button.disabled = true;
                }
                button.addEventListener('click', () => {
                  const args = button.getAttribute('data-args');
                  vscode.postMessage({
                    type: 'assistant.command',
                    command: button.getAttribute('data-command'),
                    args: args ? JSON.parse(args) : []
                  });
                });
                actionsContainer.appendChild(button);
              });
            }

            function renderBridgeState(update) {
              if (!update || !bridgeStateEl || !bridgeLabelEl) {
                return;
              }
              bridgeStateEl.setAttribute('data-state', update.state);
              bridgeLabelEl.textContent = update.state + (update.message ? ' - ' + update.message : '');
              if (update.message) {
                bridgeStateEl.title = update.message;
              }
            }

            function appendLogEntry(entry) {
              if (!entry || !logList) {
                return;
              }

              const item = document.createElement('li');
              const timestamp = new Date(entry.timestamp).toLocaleTimeString();
              item.className = 'log-entry level-' + (entry.level || 'info');

              const meta = document.createElement('div');
              meta.className = 'meta';
              meta.textContent = '[' + timestamp + '] ' + entry.level.toUpperCase();
              const message = document.createElement('div');
              message.textContent = entry.message;

              item.appendChild(meta);
              item.appendChild(message);
              logList.prepend(item);
              lastMessageEl.textContent = entry.message;

              while (logList.childElementCount > 50) {
                logList.removeChild(logList.lastElementChild);
              }
            }

            function renderContext(snapshot) {
              if (!snapshot) {
                return;
              }

              contextTimestampEl.textContent = new Date(snapshot.timestamp).toLocaleString();

              if (snapshot.activeEditor) {
                activeFileEl.textContent = snapshot.activeEditor.fileName;
                languageEl.textContent = snapshot.activeEditor.languageId;
                selectionEl.textContent = formatSelection(snapshot.activeEditor.selection);
                previewEl.textContent = snapshot.activeEditor.preview || 'File preview unavailable.';
              } else {
                activeFileEl.textContent = 'No active file';
                languageEl.textContent = '-';
                selectionEl.textContent = '-';
                previewEl.textContent = 'Open a file to capture its context.';
              }

              const diagnostics = snapshot.diagnostics || [];
              diagnosticsSummaryEl.textContent = diagnostics.length
                ? diagnostics.length + ' diagnostic' + (diagnostics.length === 1 ? '' : 's') + ' captured'
                : 'No diagnostics captured.';

              diagnosticsListEl.innerHTML = '';
              if (!diagnostics.length) {
                const emptyState = document.createElement('li');
                emptyState.textContent = 'Workspace is clean.';
                diagnosticsListEl.appendChild(emptyState);
                return;
              }

              diagnostics.slice(0, 20).forEach((diagnostic) => {
                const item = document.createElement('li');
                const startLine = diagnostic.range.start.line + 1;
                const startChar = diagnostic.range.start.character + 1;
                item.innerHTML =
                  '<strong>' +
                  diagnostic.severity.toUpperCase() +
                  '</strong> - ' +
                  diagnostic.fileName +
                  ' [' +
                  startLine +
                  ':' +
                  startChar +
                  '] - ' +
                  diagnostic.message;
                diagnosticsListEl.appendChild(item);
              });
            }

            function formatSelection(selection) {
              if (!selection) {
                return 'No selection.';
              }
              const startLine = selection.start.line + 1;
              const endLine = selection.end.line + 1;
              if (startLine === endLine) {
                return (
                  'Line ' +
                  startLine +
                  ' (' +
                  (selection.start.character + 1) +
                  ' -> ' +
                  (selection.end.character + 1) +
                  ')'
                );
              }
              return 'Lines ' + startLine + '-' + endLine;
            }
          </script>
        </body>
      </html>
    `;
  }
}

function getNonce(): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 16; i += 1) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}
