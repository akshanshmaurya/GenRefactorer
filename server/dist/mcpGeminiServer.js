import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { GeminiClient } from './geminiClient.js';
const PORT = Number(process.env.MCP_GEMINI_PORT ?? process.env.MCP_PORT ?? 5056);
const gemini = new GeminiClient();
const wss = new WebSocketServer({ port: PORT });
wss.on('listening', () => {
    console.log(`[MCP-Gemini] Listening on ws://localhost:${PORT}`);
    if (!gemini.isConfigured()) {
        console.warn('[MCP-Gemini] GEMINI_API_KEY not set. Falling back to heuristic responses.');
    }
});
wss.on('connection', (socket) => {
    const session = { id: randomUUID(), socket };
    console.log(`[MCP-Gemini] Client connected (${session.id}).`);
    sendLog(socket, 'Gemini MCP bridge connected. Preparing dynamic actions...');
    registerActions(socket);
    socket.on('message', (data) => handleMessage(session, data.toString()));
    socket.on('close', () => {
        console.log(`[MCP-Gemini] Client disconnected (${session.id}).`);
    });
});
function handleMessage(session, raw) {
    let message;
    try {
        message = JSON.parse(raw);
    }
    catch (error) {
        console.warn('[MCP-Gemini] Failed to parse message:', raw, error);
        return;
    }
    if (message.type === 'context.snapshot') {
        session.lastContext = message.payload;
        return;
    }
    if (message.type === 'assistant/actionTriggered') {
        void handleAction(session, message.payload);
    }
}
function registerActions(socket) {
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
async function handleAction(session, payload) {
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
async function summarizeActiveFile(session) {
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
async function diagnosticsAutoFix(session) {
    const diagnostics = session.lastContext?.diagnostics ?? [];
    if (!diagnostics.length) {
        sendLog(session.socket, 'Workspace is clean. Nothing to fix.');
        completeAction(session.socket, 'diagnostics-auto-fix', 'success', 'No diagnostics detected.');
        return;
    }
    const edits = await Promise.all(diagnostics.slice(0, 3).map(async (diag) => {
        const comment = await gemini.proposeFixComment({
            diagnosticMessage: diag.message,
            severity: diag.severity,
            fileName: diag.fileName
        });
        return {
            uri: diag.uri,
            edits: [
                {
                    range: {
                        start: { line: diag.range.start.line, character: 0 },
                        end: { line: diag.range.start.line, character: 0 }
                    },
                    newText: `${comment}\n`
                }
            ]
        };
    }));
    session.socket.send(JSON.stringify({
        type: 'assistant/applyEdits',
        payload: {
            actionId: 'diagnostics-auto-fix',
            description: 'Inserted Gemini suggestions near diagnostics.',
            edits
        }
    }));
    sendLog(session.socket, 'Applied Gemini diagnostic suggestions.');
    completeAction(session.socket, 'diagnostics-auto-fix', 'success', 'Inserted suggestion comments.');
}
async function gitStageCommit(session) {
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
    session.socket.send(JSON.stringify({
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
    }));
    sendLog(session.socket, `Requested git add/commit ("${commitMessage}").`);
}
function requestContext(socket) {
    socket.send(JSON.stringify({ type: 'assistant/contextRequest', payload: {} }));
}
function sendLog(socket, message, level = 'info') {
    socket.send(JSON.stringify({ type: 'assistant/log', payload: { message, level } }));
}
function completeAction(socket, actionId, status, message) {
    socket.send(JSON.stringify({ type: 'assistant/actionComplete', payload: { actionId, status, message } }));
}
function uriToFsPath(uri) {
    if (uri.startsWith('file://')) {
        return fileURLToPath(uri);
    }
    return uri;
}
