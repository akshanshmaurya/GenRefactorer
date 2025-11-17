import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { GeminiClient, ConversationTurn } from './geminiClient.js';

interface DiagnosticsEntry {
  uri: string;
  fileName: string;
  message: string;
  severity: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

interface WorkspaceContextSnapshot {
  timestamp: string;
  activeEditor?: {
    uri: string;
    fileName: string;
    languageId: string;
    preview: string;
  };
  diagnostics: DiagnosticsEntry[];
}

interface ChatMessagePayload {
  message: string;
  context?: WorkspaceContextSnapshot;
}

interface ActionTriggeredPayload {
  actionId: string;
  context?: WorkspaceContextSnapshot;
}

interface ClientSession {
  id: string;
  socket: WebSocket;
  lastContext?: WorkspaceContextSnapshot;
  lastSummary?: string;
  chatHistory: ConversationTurn[];
}

const PORT = Number(process.env.MCP_GEMINI_PORT ?? process.env.MCP_PORT ?? 5056);
const gemini = new GeminiClient();
const wss = new WebSocketServer({ port: PORT });
const MAX_CHAT_HISTORY = 20;

wss.on('listening', () => {
  console.log(`[MCP-Gemini] Listening on ws://localhost:${PORT}`);
  if (!gemini.isConfigured()) {
    console.warn('[MCP-Gemini] GEMINI_API_KEY not set. Falling back to heuristic responses.');
  }
});

wss.on('connection', (socket) => {
  const session: ClientSession = { id: randomUUID(), socket, chatHistory: [] };
  console.log(`[MCP-Gemini] Client connected (${session.id}).`);
  sendLog(socket, 'Gemini MCP bridge connected. Preparing dynamic actions...');
  registerActions(socket);

  socket.on('message', (data) => handleMessage(session, data.toString()));
  socket.on('close', () => {
    console.log(`[MCP-Gemini] Client disconnected (${session.id}).`);
  });
});

function handleMessage(session: ClientSession, raw: string): void {
  let message: { type: string; payload?: unknown };
  try {
    message = JSON.parse(raw);
  } catch (error) {
    console.warn('[MCP-Gemini] Failed to parse message:', raw, error);
    return;
  }

  if (message.type === 'context.snapshot') {
    session.lastContext = message.payload as WorkspaceContextSnapshot;
    return;
  }

  if (message.type === 'assistant/chatMessage') {
    void handleChatMessage(session, message.payload as ChatMessagePayload);
    return;
  }

  if (message.type === 'assistant/actionTriggered') {
    void handleAction(session, message.payload as ActionTriggeredPayload);
  }
}

function registerActions(socket: WebSocket): void {
  const payload = {
    actions: [
      {
        id: 'summarize-active-file',
        label: 'Summarize Active File',
        description: 'Use Gemini to summarize the current file.',
        emphasis: 'primary',
        sendContextOnInvoke: true
      },
      {
        id: 'diagnostics-auto-fix',
        label: 'Auto-Fix Diagnostics',
        description: 'Send top diagnostics to Gemini for quick suggestions.',
        sendContextOnInvoke: true
      },
      {
        id: 'git-stage-commit',
        label: 'Stage & Commit (AI)',
        description: 'Let Gemini craft a commit message and run git add/commit.',
        sendContextOnInvoke: true
      }
    ]
  };
  socket.send(JSON.stringify({ type: 'assistant/registerActions', payload }));
}

async function handleAction(session: ClientSession, payload?: ActionTriggeredPayload): Promise<void> {
  if (!payload?.actionId) {
    return;
  }

  if (payload.context) {
    session.lastContext = payload.context;
  }

  switch (payload.actionId) {
    case 'summarize-active-file':
      await summarizeActiveFile(session);
      break;
    case 'diagnostics-auto-fix':
      await diagnosticsAutoFix(session);
      break;
    case 'git-stage-commit':
      await gitStageCommit(session);
      break;
    default:
      sendLog(session.socket, `Unknown actionId: ${payload.actionId}`, 'warn');
  }
}

async function summarizeActiveFile(session: ClientSession): Promise<void> {
  const active = session.lastContext?.activeEditor;
  if (!active) {
    sendLog(session.socket, 'No active editor context available.');
    requestContext(session.socket);
    return;
  }

  const summary = await gemini.summarizeFile({
    fileName: active.fileName,
    languageId: active.languageId,
    content: active.preview
  });

  session.lastSummary = summary;
  sendLog(session.socket, summary);
  completeAction(session.socket, 'summarize-active-file', 'success', 'File summarized.');
}

async function diagnosticsAutoFix(session: ClientSession): Promise<void> {
  const diagnostics = session.lastContext?.diagnostics ?? [];
  if (!diagnostics.length) {
    sendLog(session.socket, 'Workspace is clean. Nothing to fix.');
    completeAction(session.socket, 'diagnostics-auto-fix', 'success', 'No diagnostics detected.');
    return;
  }

  const proposals = await Promise.all(diagnostics.slice(0, 3).map((diag) => buildDiagnosticPatch(diag)));
  const validProposals = proposals.filter((proposal): proposal is DiagnosticPatchProposal => Boolean(proposal));

  if (validProposals.length === 0) {
    sendLog(session.socket, 'Gemini could not prepare diagnostic fixes.', 'warn');
    completeAction(session.socket, 'diagnostics-auto-fix', 'error', 'No patches were generated.');
    return;
  }

  const diffPreview = validProposals
    .map((proposal) => proposal.diffPreview)
    .filter(Boolean)
    .join('\n\n');

  if (diffPreview) {
    sendChatResponse(
      session.socket,
      `Gemini prepared diagnostic patches. Review the diff and use undo if the changes do not look right.\n\n\`\`\`diff\n${diffPreview}\n\`\`\``
    );
  }

  session.socket.send(
    JSON.stringify({
      type: 'assistant/applyEdits',
      payload: {
        actionId: 'diagnostics-auto-fix',
        description: 'Inserted Gemini suggestion comments near diagnostics.',
        preview: true,
        edits: validProposals.map((proposal) => proposal.fileEdit)
      }
    })
  );
  sendLog(session.socket, 'Sent Gemini diagnostic patches (preview).');
  completeAction(session.socket, 'diagnostics-auto-fix', 'success', 'Previewed suggestion comments for diagnostics.');
}

async function gitStageCommit(session: ClientSession): Promise<void> {
  const active = session.lastContext?.activeEditor;
  if (!active) {
    sendLog(session.socket, 'Need an active file to infer repo path.', 'warn');
    requestContext(session.socket);
    return;
  }

  const cwd = process.env.MCP_WORKSPACE_DIR ?? path.dirname(uriToFsPath(active.uri));
  const commitMessage = await gemini.craftCommitMessage({
    summaryHint: session.lastSummary,
    diagnosticsCount: session.lastContext?.diagnostics.length
  });

  session.socket.send(
    JSON.stringify({
      type: 'assistant/taskRequest',
      payload: {
        actionId: 'git-stage-commit',
        mode: 'process',
        cwd,
        sequence: [
          { command: 'git', args: ['add', '-A'] },
          { command: 'git', args: ['commit', '-m', commitMessage] }
        ]
      }
    })
  );
  sendLog(session.socket, `Requested git add/commit ("${commitMessage}").`);
}

function requestContext(socket: WebSocket): void {
  socket.send(JSON.stringify({ type: 'assistant/contextRequest', payload: {} }));
}

async function handleChatMessage(session: ClientSession, payload?: ChatMessagePayload): Promise<void> {
  if (!payload?.message) {
    sendLog(session.socket, 'Chat payload missing message.', 'warn');
    return;
  }

  if (payload.context) {
    session.lastContext = payload.context;
  }

  const userMessage = payload.message.trim();
  if (!userMessage) {
    sendLog(session.socket, 'Ignoring empty chat message.', 'warn');
    return;
  }

  let response: string;
  try {
    response = await gemini.chat(session.chatHistory, userMessage);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendLog(session.socket, `Gemini chat failed: ${message}`, 'error');
    return;
  }

  appendChatTurn(session, 'user', userMessage);
  appendChatTurn(session, 'assistant', response);

  sendChatResponse(session.socket, response);
}

function sendChatResponse(socket: WebSocket, message: string, role: 'assistant' | 'system' = 'assistant'): void {
  socket.send(JSON.stringify({ type: 'assistant/chatResponse', payload: { message, role } }));
}

function sendLog(socket: WebSocket, message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
  socket.send(JSON.stringify({ type: 'assistant/log', payload: { message, level } }));
}

function completeAction(
  socket: WebSocket,
  actionId: string,
  status: 'success' | 'error',
  message?: string
): void {
  socket.send(JSON.stringify({ type: 'assistant/actionComplete', payload: { actionId, status, message } }));
}

function uriToFsPath(uri: string): string {
  if (uri.startsWith('file://')) {
    return fileURLToPath(uri);
  }
  return uri;
}

interface DiagnosticPatchProposal {
  fileEdit: {
    uri: string;
    edits: Array<{
      range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
      };
      newText: string;
    }>;
  };
  diffPreview?: string;
}

async function buildDiagnosticPatch(diag: DiagnosticsEntry): Promise<DiagnosticPatchProposal | undefined> {
  try {
    const comment = await gemini.proposeFixComment({
      diagnosticMessage: diag.message,
      severity: diag.severity,
      fileName: diag.fileName
    });

    const line = diag.range.start.line;
    const edit = {
      uri: diag.uri,
      edits: [
        {
          range: {
            start: { line, character: 0 },
            end: { line, character: 0 }
          },
          newText: `${comment}\n`
        }
      ]
    };

    const contextLine = await readDiagnosticContextLine(diag.uri, line);
    const diffPreview = formatDiffPreview(diag.fileName || diag.uri, line, comment, contextLine);

    return { fileEdit: edit, diffPreview };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[MCP-Gemini] Failed to build diagnostic patch:', message);
    return undefined;
  }
}

async function readDiagnosticContextLine(uri: string, line: number): Promise<string | undefined> {
  const fsPath = uriToFsPath(uri);
  try {
    const content = await fs.readFile(fsPath, 'utf8');
    const lines = content.split(/\r?\n/);
    return lines[line]?.trim();
  } catch {
    return undefined;
  }
}

function formatDiffPreview(fileLabel: string, zeroBasedLine: number, addition: string, contextLine?: string): string {
  const label = path.basename(fileLabel) || fileLabel;
  const safeLabel = label.replace(/\s+/g, '-');
  const diffHeader = `@@ -${zeroBasedLine + 1},0 +${zeroBasedLine + 1},1 @@`;
  const additionLine = addition.split(/\r?\n/).map((line) => `+${line}`).join('\n');
  const parts = [`--- a/${safeLabel}`, `+++ b/${safeLabel}`, diffHeader];
  if (contextLine) {
    parts.push(` ${contextLine}`);
  }
  parts.push(additionLine);
  return parts.join('\n');
}

function appendChatTurn(session: ClientSession, role: 'user' | 'assistant', content: string): void {
  const normalizedRole: ConversationTurn['role'] = role === 'assistant' ? 'model' : 'user';
  session.chatHistory.push({ role: normalizedRole, content });
  if (session.chatHistory.length > MAX_CHAT_HISTORY) {
    session.chatHistory.splice(0, session.chatHistory.length - MAX_CHAT_HISTORY);
  }
}
