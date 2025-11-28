import * as vscode from 'vscode';
import { AssistantEventBus } from './assistantEventBus';
import { WorkspaceContextSnapshot } from './workspaceContextManager';
import {
  AssistantAction,
  AssistantChatMessage,
  AssistantLogEntry,
  AssistantStatus,
  BridgeStateUpdate
} from './types/assistant';

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
  private readonly chatMessages: AssistantChatMessage[] = [];

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
      }),
      this.bus.onChatMessage((payload) => {
        this.chatMessages.push(payload);
        this.postMessage({ type: 'assistant.chat', payload });
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
      if (!message) {
        return;
      }
      if (message.type === 'assistant.command') {
        void vscode.commands.executeCommand(message.command, ...(message.args ?? []));
      } else if (message.type === 'assistant.chatPrompt') {
        const text: unknown = message.payload?.message;
        const includeContext: unknown = message.payload?.includeContext;
        if (typeof text === 'string') {
          void vscode.commands.executeCommand(
            'genRefactorer.assistant.chatPrompt',
            text,
            includeContext === undefined ? true : Boolean(includeContext)
          );
        }
      }
    });

    if (this.contextSnapshot) {
      this.postMessage({ type: 'assistant.context', payload: this.contextSnapshot });
    }

    this.postMessage({ type: 'assistant.status', payload: this.state });
    this.postMessage({ type: 'assistant.actions', payload: this.actions });

    if (this.logEntries.length) {
      this.logEntries.forEach((entry) => this.postMessage({ type: 'assistant.log', payload: entry }));
    }

    if (this.bridgeState) {
      this.postMessage({ type: 'assistant.bridge', payload: this.bridgeState });
    }

    this.postMessage({ type: 'assistant.chat.replace', payload: this.chatMessages });
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
              --tab-border: var(--vscode-panel-border);
              --tab-active-foreground: var(--vscode-panelTitle-activeForeground);
              --tab-inactive-foreground: var(--vscode-panelTitle-inactiveForeground);
              --tab-active-border: var(--vscode-panelTitle-activeBorder);
            }
            body {
              margin: 0;
              padding: 0;
              font-family: var(--vscode-font-family);
              font-size: 13px;
              color: var(--vscode-foreground);
              background: var(--vscode-sideBar-background);
              display: flex;
              flex-direction: column;
              height: 100vh;
              overflow: hidden;
            }
            
            /* Header & Tabs */
            .header-container {
              flex-shrink: 0;
              background: var(--vscode-sideBar-background);
              border-bottom: 1px solid var(--vscode-panel-border);
            }
            .panel-header {
              padding: 8px 16px;
              display: flex;
              justify-content: space-between;
              align-items: center;
            }
            h1 { margin: 0; font-size: 13px; font-weight: 600; }
            .status-badges { display: flex; gap: 8px; font-size: 11px; }
            .status-badge { 
              padding: 2px 6px; 
              border-radius: 3px; 
              background: var(--vscode-badge-background); 
              color: var(--vscode-badge-foreground);
            }
            .status-badge[data-state="error"] { background: var(--vscode-editorError-foreground); color: white; }
            .status-badge[data-state="ready"] { background: var(--vscode-testing-iconPassed); color: white; }

            .tabs {
              display: flex;
              padding: 0 8px;
              gap: 16px;
            }
            .tab {
              padding: 8px 4px;
              cursor: pointer;
              color: var(--tab-inactive-foreground);
              border-bottom: 2px solid transparent;
              font-size: 12px;
              font-weight: 500;
              text-transform: uppercase;
            }
            .tab:hover { color: var(--tab-active-foreground); }
            .tab.active {
              color: var(--tab-active-foreground);
              border-bottom-color: var(--tab-active-border);
            }

            /* Main Content Area */
            .tab-content {
              flex: 1;
              overflow: hidden;
              display: none;
              flex-direction: column;
            }
            .tab-content.active { display: flex; }

            /* Chat Tab */
            .chat-container {
              flex: 1;
              display: flex;
              flex-direction: column;
              overflow: hidden;
            }
            .suggestion-chips {
              display: flex;
              gap: 8px;
              padding: 12px 16px;
              overflow-x: auto;
              white-space: nowrap;
              border-bottom: 1px solid var(--vscode-panel-border);
              flex-shrink: 0;
            }
            .chip {
              padding: 4px 10px;
              border-radius: 12px;
              background: var(--vscode-button-secondaryBackground);
              color: var(--vscode-button-secondaryForeground);
              font-size: 11px;
              cursor: pointer;
              border: 1px solid transparent;
              user-select: none;
            }
            .chip:hover {
              background: var(--vscode-button-secondaryHoverBackground);
            }
            .chip.primary {
              background: var(--vscode-button-background);
              color: var(--vscode-button-foreground);
            }
            .chip.primary:hover {
              background: var(--vscode-button-hoverBackground);
            }

            .chat-history {
              flex: 1;
              overflow-y: auto;
              padding: 16px;
              display: flex;
              flex-direction: column;
              gap: 16px;
            }
            .chat-message {
              display: flex;
              flex-direction: column;
              gap: 4px;
              max-width: 90%;
            }
            .chat-message.user { align-self: flex-end; align-items: flex-end; }
            .chat-message.assistant { align-self: flex-start; align-items: flex-start; }
            
            .message-bubble {
              padding: 8px 12px;
              border-radius: 8px;
              font-size: 13px;
              line-height: 1.4;
              word-wrap: break-word;
            }
            .chat-message.user .message-bubble {
              background: var(--vscode-button-background);
              color: var(--vscode-button-foreground);
              border-bottom-right-radius: 2px;
            }
            .chat-message.assistant .message-bubble {
              background: var(--vscode-editor-inactiveSelectionBackground);
              color: var(--vscode-editor-foreground);
              border-bottom-left-radius: 2px;
            }
            .message-meta { font-size: 10px; opacity: 0.7; margin: 0 4px; }

            /* Markdown Styles */
            .markdown strong { font-weight: 600; }
            .markdown em { font-style: italic; }
            .markdown code {
              font-family: var(--vscode-editor-font-family);
              background: rgba(127, 127, 127, 0.2);
              padding: 2px 4px;
              border-radius: 3px;
              font-size: 12px;
            }
            .markdown pre {
              background: var(--vscode-textBlockQuote-background);
              padding: 8px;
              border-radius: 4px;
              overflow-x: auto;
              margin: 4px 0;
            }
            .markdown pre code {
              background: none;
              padding: 0;
            }
            .markdown ul { padding-left: 20px; margin: 4px 0; }
            .markdown li { margin-bottom: 4px; }

            /* Input Area */
            .input-area {
              padding: 12px;
              border-top: 1px solid var(--vscode-panel-border);
              background: var(--vscode-sideBar-background);
            }
            .input-box {
              display: flex;
              flex-direction: column;
              gap: 8px;
              background: var(--vscode-input-background);
              border: 1px solid var(--vscode-input-border);
              border-radius: 6px;
              padding: 8px;
            }
            .input-box:focus-within {
              border-color: var(--vscode-focusBorder);
            }
            textarea {
              width: 100%;
              border: none;
              background: transparent;
              color: var(--vscode-input-foreground);
              font-family: var(--vscode-font-family);
              resize: none;
              outline: none;
              min-height: 20px;
              max-height: 100px;
            }
            .input-footer {
              display: flex;
              justify-content: space-between;
              align-items: center;
            }
            .context-toggle {
              display: flex;
              align-items: center;
              gap: 4px;
              font-size: 11px;
              color: var(--vscode-descriptionForeground);
              cursor: pointer;
            }
            .send-btn {
              padding: 4px 12px;
              background: var(--vscode-button-background);
              color: var(--vscode-button-foreground);
              border: none;
              border-radius: 4px;
              cursor: pointer;
              font-size: 11px;
              font-weight: 600;
            }
            .send-btn:hover { background: var(--vscode-button-hoverBackground); }

            /* Activity & Context Tabs */
            .list-container {
              padding: 0;
              margin: 0;
              list-style: none;
              overflow-y: auto;
              flex: 1;
            }
            .list-item {
              padding: 8px 16px;
              border-bottom: 1px solid var(--vscode-panel-border);
              font-size: 12px;
            }
            .list-item-header {
              display: flex;
              justify-content: space-between;
              margin-bottom: 4px;
              font-weight: 600;
              color: var(--vscode-descriptionForeground);
            }
            .context-section { padding: 16px; }
            .context-row { margin-bottom: 8px; font-size: 12px; }
            .context-label { font-weight: 600; color: var(--vscode-descriptionForeground); }
            .preview-box {
              margin-top: 8px;
              background: var(--vscode-textBlockQuote-background);
              padding: 8px;
              border-radius: 4px;
              font-family: var(--vscode-editor-font-family);
              font-size: 11px;
              overflow-x: auto;
            }
          </style>
        </head>
        <body>
          <div class="header-container">
            <div class="panel-header">
              <h1>GenRefactorer</h1>
              <div class="status-badges">
                <div class="status-badge" data-status>${status}</div>
                <div class="status-badge" data-bridge-state>${this.bridgeState.state}</div>
              </div>
            </div>
            <div class="tabs">
              <div class="tab active" data-tab="chat">Chat</div>
              <div class="tab" data-tab="activity">Activity</div>
              <div class="tab" data-tab="context">Context</div>
            </div>
          </div>

          <!-- Chat Tab -->
          <div class="tab-content active" id="chat">
            <div class="suggestion-chips" data-chips>
              <!-- Chips injected by JS -->
            </div>
            <div class="chat-container">
              <div class="chat-history" data-chat-log>
                <div class="chat-empty" style="text-align: center; color: var(--vscode-descriptionForeground); margin-top: 40px;">
                  Start a conversation or use a quick action above.
                </div>
              </div>
              <div class="input-area">
                <div class="input-box">
                  <textarea data-chat-input rows="1" placeholder="Ask GenRefactorer..."></textarea>
                  <div class="input-footer">
                    <label class="context-toggle">
                      <input type="checkbox" data-chat-context checked /> Include Context
                    </label>
                    <button class="send-btn" data-send-btn>Send</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Activity Tab -->
          <div class="tab-content" id="activity">
            <ul class="list-container" data-log></ul>
          </div>

          <!-- Context Tab -->
          <div class="tab-content" id="context">
            <div class="context-section">
              <div class="context-row"><span class="context-label">File:</span> <span data-active-file>-</span></div>
              <div class="context-row"><span class="context-label">Language:</span> <span data-language>-</span></div>
              <div class="context-row"><span class="context-label">Selection:</span> <span data-selection>-</span></div>
              <div class="context-row">
                <span class="context-label">Diagnostics:</span>
                <ul data-issues style="margin: 4px 0 0 0; padding-left: 16px;"></ul>
              </div>
              <div class="context-row">
                <span class="context-label">Preview:</span>
                <div class="preview-box" data-preview>No preview available</div>
              </div>
            </div>
          </div>

          <script nonce="${nonce}">
            const vscode = acquireVsCodeApi();
            
            // Elements
            const tabs = document.querySelectorAll('.tab');
            const tabContents = document.querySelectorAll('.tab-content');
            const chipsContainer = document.querySelector('[data-chips]');
            const chatLog = document.querySelector('[data-chat-log]');
            const chatInput = document.querySelector('[data-chat-input]');
            const sendBtn = document.querySelector('[data-send-btn]');
            const contextToggle = document.querySelector('[data-chat-context]');
            const logList = document.querySelector('[data-log]');
            
            // Context Elements
            const activeFileEl = document.querySelector('[data-active-file]');
            const languageEl = document.querySelector('[data-language]');
            const selectionEl = document.querySelector('[data-selection]');
            const issuesListEl = document.querySelector('[data-issues]');
            const previewEl = document.querySelector('[data-preview]');
            const statusBadge = document.querySelector('[data-status]');
            const bridgeBadge = document.querySelector('[data-bridge-state]');

            // State
            let chatHistory = [];
            
            // Tab Switching
            tabs.forEach(tab => {
              tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tabContents.forEach(c => c.classList.remove('active'));
                
                tab.classList.add('active');
                document.getElementById(tab.dataset.tab).classList.add('active');
              });
            });

            // Auto-resize textarea
            chatInput.addEventListener('input', function() {
              this.style.height = 'auto';
              this.style.height = (this.scrollHeight) + 'px';
            });

            // Send Message
            function sendMessage() {
              const text = chatInput.value.trim();
              if (!text) return;
              
              vscode.postMessage({
                type: 'assistant.chatPrompt',
                payload: {
                  message: text,
                  includeContext: contextToggle.checked
                }
              });
              
              chatInput.value = '';
              chatInput.style.height = 'auto';
            }

            sendBtn.addEventListener('click', sendMessage);
            chatInput.addEventListener('keydown', (e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            });

            // Quick Actions (Chips)
            const defaultActions = [
              { label: 'Refactor', command: 'genRefactorer.refactorSelection', primary: true },
              { label: 'Explain', command: 'genRefactorer.explainSelection' },
              { label: 'Fix Bugs', command: 'genRefactorer.assistant.fixDiagnostics' },
              { label: 'Scan Security', command: 'genRefactorer.scanSecurity' },
              { label: 'Commit', command: 'genRefactorer.commitChanges' }
            ];

            function renderChips(actions) {
              chipsContainer.innerHTML = '';
              // Merge default actions with remote actions if needed, or just use defaults for now
              // For this UI, we'll stick to the core set + any dynamic ones
              
              const allActions = [...defaultActions];
              if (actions && actions.length) {
                actions.forEach(a => {
                  if (!allActions.find(da => da.command === a.command)) {
                    allActions.push(a);
                  }
                });
              }

              allActions.forEach(action => {
                const chip = document.createElement('div');
                chip.className = 'chip' + (action.primary ? ' primary' : '');
                chip.textContent = action.label;
                chip.addEventListener('click', () => {
                  vscode.postMessage({
                    type: 'assistant.command',
                    command: action.command,
                    args: action.args || []
                  });
                });
                chipsContainer.appendChild(chip);
              });
            }

            // Markdown Parser (Lightweight)
            function parseMarkdown(text) {
              if (!text) return '';
              let html = text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
              
              // Code blocks
              html = html.replace(/\\\`\\\`\\\`([\\s\\S]*?)\\\`\\\`\\\`/g, '<pre><code>$1</code></pre>');
              
              // Inline code
              html = html.replace(/\\\`([^\\\`]+)\\\`/g, '<code>$1</code>');
              
              // Bold
              html = html.replace(/\\*\\*([^\\*]+)\\*\\*/g, '<strong>$1</strong>');
              
              // Italic
              html = html.replace(/\\*([^\\*]+)\\*/g, '<em>$1</em>');
              
              // Lists
              html = html.replace(/^\\s*-\\s+(.*)$/gm, '<ul><li>$1</li></ul>');
              html = html.replace(/<\\/ul>\\s*<ul>/g, ''); // Merge adjacent lists
              
              return html;
            }

            // Chat Rendering
            function renderChat(messages) {
              chatLog.innerHTML = '';
              if (!messages.length) {
                chatLog.innerHTML = '<div class="chat-empty" style="text-align: center; color: var(--vscode-descriptionForeground); margin-top: 40px;">Start a conversation or use a quick action above.</div>';
                return;
              }

              messages.forEach(msg => {
                const div = document.createElement('div');
                div.className = 'chat-message ' + (msg.role || 'assistant');
                
                const meta = document.createElement('div');
                meta.className = 'message-meta';
                meta.textContent = msg.role === 'user' ? 'You' : 'GenRefactorer';
                
                const bubble = document.createElement('div');
                bubble.className = 'message-bubble markdown';
                bubble.innerHTML = parseMarkdown(msg.message);
                
                div.appendChild(meta);
                div.appendChild(bubble);
                chatLog.appendChild(div);
              });
              
              chatLog.scrollTop = chatLog.scrollHeight;
            }

            // Message Handling
            window.addEventListener('message', event => {
              const msg = event.data;
              switch (msg.type) {
                case 'assistant.status':
                  statusBadge.textContent = msg.payload.status;
                  statusBadge.setAttribute('data-state', msg.payload.status === 'error' ? 'error' : 'idle');
                  break;
                case 'assistant.bridge':
                  bridgeBadge.textContent = msg.payload.state;
                  bridgeBadge.setAttribute('data-state', msg.payload.state);
                  break;
                case 'assistant.actions':
                  renderChips(msg.payload);
                  break;
                case 'assistant.chat':
                  chatHistory.push(msg.payload);
                  renderChat(chatHistory);
                  break;
                case 'assistant.chat.replace':
                  chatHistory = msg.payload || [];
                  renderChat(chatHistory);
                  break;
                case 'assistant.log':
                  const li = document.createElement('li');
                  li.className = 'list-item';
                  li.innerHTML = '<div class="list-item-header"><span>' + msg.payload.level.toUpperCase() + '</span><span>' + new Date(msg.payload.timestamp).toLocaleTimeString() + '</span></div><div>' + msg.payload.message + '</div>';
                  logList.prepend(li);
                  break;
                case 'assistant.context':
                  updateContext(msg.payload);
                  break;
              }
            });

            function updateContext(snapshot) {
              if (!snapshot) return;
              if (snapshot.activeEditor) {
                activeFileEl.textContent = snapshot.activeEditor.fileName;
                languageEl.textContent = snapshot.activeEditor.languageId;
                selectionEl.textContent = 'Ln ' + (snapshot.activeEditor.selection.start.line + 1);
                previewEl.textContent = snapshot.activeEditor.preview || 'No preview';
              }
              
              issuesListEl.innerHTML = '';
              if (snapshot.diagnostics && snapshot.diagnostics.length) {
                snapshot.diagnostics.forEach(d => {
                  const li = document.createElement('li');
                  li.textContent = d.message;
                  li.style.marginBottom = '4px';
                  issuesListEl.appendChild(li);
                });
              } else {
                issuesListEl.innerHTML = '<li>No issues detected.</li>';
              }
            }
            
            // Initial Render
            renderChips([]);
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
