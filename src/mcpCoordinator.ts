import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { AssistantEventBus } from './assistantEventBus';
import { ActionOrchestrator } from './actionOrchestrator';
import { McpBridge } from './mcpBridge';
import { WorkspaceContextManager } from './workspaceContextManager';
import {
  AssistantAction,
  BridgeMessageUpdate,
  McpActionCompletePayload,
  McpActionInvocationPayload,
  McpActionStateUpdatePayload,
  McpApplyEditsPayload,
  McpChatMessagePayload,
  McpChatResponsePayload,
  McpContextRequestPayload,
  McpLogPayload,
  McpRegisterActionsPayload,
  McpRemoteActionDescriptor,
  McpTaskRequestPayload,
  McpTaskSequenceEntry
} from './types/assistant';

interface RemoteActionRecord {
  descriptor: McpRemoteActionDescriptor;
  clientId: string;
}

export class McpCoordinator implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly remoteActions = new Map<string, RemoteActionRecord>();
  private readonly inflightActions = new Set<string>();
  private terminal?: vscode.Terminal;

  public constructor(
    private readonly bus: AssistantEventBus,
    private readonly bridge: McpBridge,
    private readonly contextManager: WorkspaceContextManager,
    private readonly orchestrator: ActionOrchestrator
  ) {
    this.disposables.push(
      this.bus.onBridgeMessage((update) => this.handleBridgeMessage(update)),
      this.bus.onBridgeStateChanged((update) => {
        if (update.state === 'disconnected' || update.state === 'error') {
          this.clearRemoteActions();
        }
      })
    );
  }

  public dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.terminal?.dispose();
    this.remoteActions.clear();
    this.inflightActions.clear();
  }

  public invokeRemoteAction(remoteActionId: string): void {
    const mapping = this.remoteActions.get(remoteActionId);
    if (!mapping) {
      void vscode.window.showWarningMessage(`Unknown MCP action: ${remoteActionId}`);
      return;
    }

    const payload: McpActionInvocationPayload = {
      actionId: remoteActionId,
      timestamp: new Date().toISOString(),
      context: mapping.descriptor.sendContextOnInvoke !== false ? this.contextManager.getSnapshot() : undefined
    };

    const sent = this.bridge.send({ type: 'assistant/actionTriggered', payload });
    if (!sent) {
      return;
    }

    this.bus.log(`MCP action requested: ${mapping.descriptor.label}`);
    this.inflightActions.add(remoteActionId);
    this.updateAssistantStatus();
  }

  public sendChatMessage(message: string, includeContext = true): void {
    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }

    const payload: McpChatMessagePayload = {
      message: trimmed,
      context: includeContext ? this.contextManager.getSnapshot() : undefined
    };

    const sent = this.bridge.send({ type: 'assistant/chatMessage', payload });
    if (sent) {
      this.bus.publishStatus('processing', 'Waiting for Gemini response...');
      this.bus.log(`Sent MCP chat message: ${trimmed}`);
    }
  }

  private handleBridgeMessage(update: BridgeMessageUpdate): void {
    if (update.direction !== 'inbound') {
      return;
    }

    switch (update.message.type) {
      case 'assistant/registerActions':
        void this.handleRegisterActions(update.message.payload as McpRegisterActionsPayload | undefined);
        break;
      case 'assistant/contextRequest':
        this.handleContextRequest(update.message.payload as McpContextRequestPayload | undefined);
        break;
      case 'assistant/actionStateUpdate':
        this.handleActionStateUpdate(update.message.payload as McpActionStateUpdatePayload | undefined);
        break;
      case 'assistant/applyEdits':
        void this.handleApplyEdits(update.message.payload as McpApplyEditsPayload | undefined);
        break;
      case 'assistant/taskRequest':
        this.handleTaskRequest(update.message.payload as McpTaskRequestPayload | undefined);
        break;
      case 'assistant/log':
        this.handleLog(update.message.payload as McpLogPayload | undefined);
        break;
      case 'assistant/chatResponse':
        this.handleChatResponse(update.message.payload as McpChatResponsePayload | undefined);
        break;
      case 'assistant/actionComplete':
        this.handleActionComplete(update.message.payload as McpActionCompletePayload | undefined);
        break;
      default:
        this.bus.log(`Unhandled MCP message type: ${update.message.type}`, 'warn');
    }
  }

  private async handleRegisterActions(payload?: McpRegisterActionsPayload): Promise<void> {
    if (!payload || !Array.isArray(payload.actions)) {
      this.bus.log('MCP register actions payload missing "actions" array.', 'warn');
      return;
    }

    this.remoteActions.clear();

    const mapped: AssistantAction[] = payload.actions.map((descriptor) => {
      const clientId = this.toClientActionId(descriptor.id);
      this.remoteActions.set(descriptor.id, { descriptor, clientId });
      return {
        id: clientId,
        label: descriptor.label,
        description: descriptor.description,
        command: 'genRefactorer.assistant.runMcpAction',
        args: [descriptor.id],
        emphasis: descriptor.emphasis,
        disabled: descriptor.disabled,
        source: 'mcp'
      } satisfies AssistantAction;
    });

    this.orchestrator.setActionsForSource('mcp', mapped);
    this.bus.log(`Registered ${mapped.length} MCP action${mapped.length === 1 ? '' : 's'}.`);
  }

  private handleContextRequest(_payload?: McpContextRequestPayload): void {
    const snapshot = this.contextManager.getSnapshot();
    this.bridge.send({ type: 'context.snapshot', payload: snapshot });
    this.bus.log('Sent context snapshot to MCP server (on demand).');
  }

  private handleActionStateUpdate(payload?: McpActionStateUpdatePayload): void {
    if (!payload?.actionId) {
      return;
    }
    const mapping = this.remoteActions.get(payload.actionId);
    if (!mapping) {
      return;
    }

    this.orchestrator.updateAction(mapping.clientId, {
      disabled: payload.disabled,
      label: payload.label ?? mapping.descriptor.label,
      description: payload.description ?? mapping.descriptor.description,
      emphasis: payload.emphasis ?? mapping.descriptor.emphasis,
      source: 'mcp'
    });
  }

  private async handleApplyEdits(payload?: McpApplyEditsPayload): Promise<void> {
    if (!payload?.edits?.length) {
      this.bus.log('MCP apply edits payload missing edits.', 'warn');
      return;
    }

    const workspaceEdit = new vscode.WorkspaceEdit();
    for (const fileEdit of payload.edits) {
      const uri = this.resolveUri(fileEdit.uri);
      if (!uri) {
        this.bus.log(`Skipping MCP edit with unresolved URI: ${fileEdit.uri}`, 'warn');
        continue;
      }

      for (const textEdit of fileEdit.edits ?? []) {
        const range = new vscode.Range(
          new vscode.Position(textEdit.range.start.line, textEdit.range.start.character),
          new vscode.Position(textEdit.range.end.line, textEdit.range.end.character)
        );
        workspaceEdit.replace(uri, range, textEdit.newText);
      }
    }

    const applied = await vscode.workspace.applyEdit(workspaceEdit);
    if (applied) {
      this.bus.log(payload.description ?? 'Applied MCP-provided edits.');
      if (payload.actionId) {
        this.completeAction(payload.actionId, 'success', payload.description ?? 'Edits applied.');
      }
    } else {
      this.bus.log('Failed to apply MCP edits.', 'error');
      if (payload.actionId) {
        this.completeAction(payload.actionId, 'error', 'VS Code rejected the edits.');
      }
    }
  }

  private handleTaskRequest(payload?: McpTaskRequestPayload): void {
    if (!payload) {
      this.bus.log('Received empty MCP task payload.', 'warn');
      return;
    }

    const mode = payload.mode ?? 'terminal';
    const sequence = this.normalizeTaskSequence(payload);

    if (sequence.length === 0) {
      this.bus.log('MCP task request missing command(s).', 'warn');
      return;
    }

    if (mode === 'process') {
      void this.runProcessCommands(sequence, payload);
      return;
    }

    this.runTerminalCommands(sequence, payload);
  }

  private handleLog(payload?: McpLogPayload): void {
    if (!payload?.message) {
      return;
    }
    this.bus.log(payload.message, payload.level ?? 'info');
  }

  private handleChatResponse(payload?: McpChatResponsePayload): void {
    if (!payload?.message) {
      return;
    }
    const prefix = payload.role === 'assistant' ? 'Gemini' : 'MCP';
    this.bus.log(`${prefix}: ${payload.message}`);
    this.bus.publishStatus('idle', 'Gemini conversation updated.');
  }

  private normalizeTaskSequence(payload: McpTaskRequestPayload): McpTaskSequenceEntry[] {
    if (payload.sequence?.length) {
      return payload.sequence.map((entry) => ({ command: entry.command, args: entry.args }));
    }
    if (payload.command) {
      return [{ command: payload.command, args: payload.args }];
    }
    return [];
  }

  private runTerminalCommands(sequence: McpTaskSequenceEntry[], payload: McpTaskRequestPayload): void {
    const terminal = this.ensureTerminal(payload.terminalName ?? 'GenRefactorer MCP Tasks');
    if (payload.cwd) {
      terminal.sendText(this.cdCommand(payload.cwd), true);
    }

    sequence.forEach((entry) => {
      const commandText = [entry.command, ...(entry.args ?? [])].join(' ').trim();
      terminal.sendText(commandText, true);
      this.bus.log(`Running MCP task in terminal: ${commandText}`);
    });

    if (payload.actionId) {
      this.completeAction(payload.actionId, 'success', `Launched ${sequence.length} terminal command(s).`);
    }
  }

  private async runProcessCommands(
    sequence: McpTaskSequenceEntry[],
    payload: McpTaskRequestPayload
  ): Promise<void> {
    try {
      for (const entry of sequence) {
        await this.spawnProcess(entry.command, entry.args ?? [], payload.cwd);
      }
      if (payload.actionId) {
        this.completeAction(payload.actionId, 'success', `Completed ${sequence.length} command(s).`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.bus.log(`MCP task failed: ${message}`, 'error');
      if (payload.actionId) {
        this.completeAction(payload.actionId, 'error', message);
      }
    }
  }

  private spawnProcess(command: string, args: string[], cwd?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const renderedArgs = args.length ? ` ${args.join(' ')}` : '';
      const child = spawn(command, args, {
        cwd
      });

      this.bus.log(`Running MCP task (process): ${command}${renderedArgs}`);

      child.stdout?.on('data', (chunk) => this.logProcessOutput(command, chunk, 'stdout'));
      child.stderr?.on('data', (chunk) => this.logProcessOutput(command, chunk, 'stderr'));

      child.on('error', (error) => {
        reject(error);
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`${command} exited with code ${code}`));
        }
      });
    });
  }

  private logProcessOutput(command: string, chunk: Buffer, stream: 'stdout' | 'stderr'): void {
    const text = chunk.toString();
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        this.bus.log(`[${command} ${stream}] ${line}`, stream === 'stderr' ? 'warn' : 'info');
      });
  }

  private handleActionComplete(payload?: McpActionCompletePayload): void {
    if (!payload?.actionId) {
      return;
    }
    this.completeAction(payload.actionId, payload.status ?? 'success', payload.message);
  }

  private completeAction(actionId: string, status: 'success' | 'error', message?: string): void {
    this.inflightActions.delete(actionId);
    this.updateAssistantStatus(status === 'error');
    if (message) {
      this.bus.log(message, status === 'error' ? 'error' : 'info');
    }
  }

  private updateAssistantStatus(hasError = false): void {
    if (this.inflightActions.size > 0 && !hasError) {
      this.bus.publishStatus('processing', `Running ${this.inflightActions.size} MCP action(s)...`);
      return;
    }

    if (hasError) {
      this.bus.publishStatus('error', 'Latest MCP action reported an error.');
    } else {
      this.bus.publishStatus('idle', 'Assistant ready.');
    }
  }

  private clearRemoteActions(): void {
    this.remoteActions.clear();
    this.orchestrator.setActionsForSource('mcp', []);
    this.bus.log('Cleared MCP actions due to bridge disconnect.');
  }

  private ensureTerminal(name: string): vscode.Terminal {
    if (!this.terminal) {
      this.terminal = vscode.window.createTerminal(name);
      this.terminal.show(true);
      return this.terminal;
    }

    try {
      this.terminal.name; // access to ensure it has not been disposed
    } catch {
      this.terminal = vscode.window.createTerminal(name);
    }
    this.terminal.show(true);
    return this.terminal;
  }

  private cdCommand(path: string): string {
    const escaped = path.replace(/`/g, '``').replace(/"/g, '""');
    return `cd "${escaped}"`;
  }

  private resolveUri(raw: string): vscode.Uri | undefined {
    if (!raw) {
      return undefined;
    }

    try {
      if (raw.startsWith('file:')) {
        return vscode.Uri.parse(raw);
      }
      if (raw.startsWith('/') || raw.match(/^[A-Za-z]:\\/)) {
        return vscode.Uri.file(raw);
      }
      const [firstWorkspace] = vscode.workspace.workspaceFolders ?? [];
      if (firstWorkspace) {
        return vscode.Uri.joinPath(firstWorkspace.uri, raw);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.bus.log(`Failed to resolve MCP URI (${raw}): ${message}`, 'warn');
    }
    return undefined;
  }

  private toClientActionId(remoteId: string): string {
    if (remoteId.startsWith('mcp:')) {
      return remoteId;
    }
    return `mcp:${remoteId}`;
  }
}
