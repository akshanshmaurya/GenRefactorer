import { WebSocketServer } from 'ws';
const PORT = Number(process.env.MCP_PORT ?? 5055);
const server = new WebSocketServer({ port: PORT });
server.on('listening', () => {
    console.log(`[MCP-Mock] Listening on ws://localhost:${PORT}`);
});
server.on('connection', (socket) => {
    console.log('[MCP-Mock] Client connected');
    const state = {};
    sendLog(socket, 'MCP mock connected. Registering sample actions...');
    registerSampleActions(socket);
    socket.on('message', (data) => {
        handleMessage(socket, state, data.toString());
    });
    socket.on('close', () => {
        console.log('[MCP-Mock] Client disconnected');
    });
});
function handleMessage(socket, state, raw) {
    let message;
    try {
        message = JSON.parse(raw);
    }
    catch (error) {
        console.warn('[MCP-Mock] Failed to parse message:', raw);
        return;
    }
    switch (message.type) {
        case 'context.snapshot':
            state.lastContext = message.payload;
            break;
        case 'assistant/actionTriggered':
            handleActionTriggered(socket, state, message.payload);
            break;
        default:
            console.log('[MCP-Mock] Ignoring message type:', message.type);
    }
}
function registerSampleActions(socket) {
    const payload = {
        actions: [
            {
                id: 'apply-file-banner',
                label: 'Apply File Banner',
                description: 'Prepends a banner comment to the active file.',
                emphasis: 'primary',
                sendContextOnInvoke: true
            },
            {
                id: 'run-format-task',
                label: 'Run npm format',
                description: 'Fires npm run format in the workspace terminal.',
                sendContextOnInvoke: false
            }
        ]
    };
    socket.send(JSON.stringify({ type: 'assistant/registerActions', payload }));
}
function handleActionTriggered(socket, state, payload) {
    if (!payload?.actionId) {
        return;
    }
    if (payload.context) {
        state.lastContext = payload.context;
    }
    switch (payload.actionId) {
        case 'apply-file-banner':
            runBannerAction(socket, state);
            break;
        case 'run-format-task':
            runFormatTask(socket);
            break;
        default:
            sendLog(socket, `Unknown actionId received: ${payload.actionId}`, 'warn');
    }
}
function runBannerAction(socket, state) {
    const active = state.lastContext?.activeEditor;
    if (!active?.uri) {
        sendLog(socket, 'No active editor context. Requesting snapshot...', 'warn');
        socket.send(JSON.stringify({ type: 'assistant/contextRequest', payload: {} }));
        return;
    }
    const comment = `// MCP Assistant applied a banner to ${active.fileName}\n`;
    const payload = {
        actionId: 'apply-file-banner',
        description: `Inserted banner at top of ${active.fileName}.`,
        edits: [
            {
                uri: active.uri,
                edits: [
                    {
                        range: {
                            start: { line: 0, character: 0 },
                            end: { line: 0, character: 0 }
                        },
                        newText: comment
                    }
                ]
            }
        ]
    };
    socket.send(JSON.stringify({ type: 'assistant/applyEdits', payload }));
}
function runFormatTask(socket) {
    const payload = {
        actionId: 'run-format-task',
        command: 'npm',
        args: ['run', 'format'],
        terminalName: 'GenRefactorer MCP Mock'
    };
    sendLog(socket, 'Requesting workspace format task via VS Code terminal...');
    socket.send(JSON.stringify({ type: 'assistant/taskRequest', payload }));
    socket.send(JSON.stringify({
        type: 'assistant/actionComplete',
        payload: { actionId: 'run-format-task', status: 'success', message: 'Format task triggered.' }
    }));
}
function sendLog(socket, message, level = 'info') {
    socket.send(JSON.stringify({ type: 'assistant/log', payload: { message, level } }));
}
