import * as vscode from 'vscode';
import WebSocket, { RawData } from 'ws';
import { AssistantEventBus } from './assistantEventBus';
import { BridgeState, McpInboundMessage, McpOutboundMessage } from './types/assistant';

export interface McpBridgeConfiguration {
  enabled: boolean;
  endpoint?: string;
  authToken?: string;
}

const DEFAULT_CONFIG: McpBridgeConfiguration = {
  enabled: false,
  endpoint: undefined,
  authToken: undefined
};

const MAX_BACKOFF_MS = 30_000;

export class McpBridge implements vscode.Disposable {
  private config: McpBridgeConfiguration = DEFAULT_CONFIG;
  private socket?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private state: BridgeState = 'disconnected';
  private disposed = false;
  private lastMessage?: string;
  private retryCount = 0;

  public constructor(private readonly bus: AssistantEventBus) {}

  public dispose(): void {
    this.disposed = true;
    this.clearReconnect();
    this.closeSocket();
  }

  public applyConfiguration(partial: Partial<McpBridgeConfiguration>): void {
    this.config = { ...DEFAULT_CONFIG, ...partial };
    this.restart();
  }

  public send(message: McpOutboundMessage, silent = false): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.bus.log('MCP bridge is not connected. Enable it in settings and wait for Ready state.', 'warn');
      return false;
    }

    try {
      const payload = JSON.stringify(message);
      this.socket.send(payload);
      this.bus.publishBridgeMessage({ direction: 'outbound', message });
      if (!silent) {
        this.bus.log(`Sent MCP message (${message.type}).`);
      }
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.bus.log(`Failed to send MCP message: ${msg}`, 'error');
      this.updateState('error', msg);
      return false;
    }
  }

  private restart(): void {
    this.clearReconnect();
    this.closeSocket();

    if (!this.config.enabled) {
      this.updateState('disconnected', 'MCP bridge disabled. Enable it in settings to connect.');
      return;
    }

    if (!this.config.endpoint) {
      this.updateState('error', 'Set genRefactorer.assistant.mcpEndpoint before enabling the MCP bridge.');
      return;
    }

    this.connect();
  }

  private connect(): void {
    if (this.disposed) {
      return;
    }

    const endpoint = this.config.endpoint as string;
    this.updateState('connecting', `Connecting to MCP server at ${endpoint}...`);
    this.bus.log(`Connecting to MCP bridge (${endpoint})...`);

    try {
      this.socket = new WebSocket(endpoint, {
        headers: this.config.authToken ? { Authorization: `Bearer ${this.config.authToken}` } : undefined
      });
    } catch (error) {
      this.handleError(error);
      this.scheduleReconnect();
      return;
    }

    this.socket.on('open', () => {
      this.retryCount = 0;
      this.updateState('ready', `Connected to ${endpoint}`);
      this.bus.log('MCP bridge connected.');
      this.send({ type: 'assistant/hello', payload: { client: 'GenRefactorer', timestamp: new Date().toISOString() } }, true);
    });

    this.socket.on('message', (data: RawData) => this.handleMessage(data));
    this.socket.on('error', (error: Error) => this.handleError(error));
    this.socket.on('close', (code: number, reason: Buffer) => {
      const reasonText = reason?.toString() ?? 'No reason provided';
      this.bus.log(`MCP bridge closed (${code}): ${reasonText}`, 'warn');
      this.updateState('disconnected', 'Connection closed. Reconnecting...');
      this.scheduleReconnect();
    });
  }

  private handleMessage(data: RawData): void {
    const raw = typeof data === 'string' ? data : data.toString('utf8');
    let parsed: McpInboundMessage;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      this.bus.log(`Received non-JSON MCP payload: ${raw.slice(0, 200)}`, 'warn');
      return;
    }

    this.bus.publishBridgeMessage({ direction: 'inbound', message: parsed, raw });
    const summary = parsed.type ?? 'unknown';
    this.bus.log(`MCP message received (${summary}).`);
  }

  private handleError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.bus.log(`MCP bridge error: ${message}`, 'error');
    this.updateState('error', message);
  }

  private scheduleReconnect(): void {
    if (this.disposed || !this.config.enabled) {
      return;
    }

    this.clearReconnect();
    this.retryCount += 1;
    const delay = Math.min(1000 * 2 ** Math.min(this.retryCount, 5), MAX_BACKOFF_MS);
    this.bus.log(`Retrying MCP bridge connection in ${Math.round(delay / 1000)}s...`, 'warn');
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private closeSocket(): void {
    if (this.socket) {
      try {
        this.socket.terminate();
      } catch (error) {
        // ignore termination errors
      }
      this.socket.removeAllListeners();
      this.socket = undefined;
    }
  }

  private updateState(state: BridgeState, message?: string): void {
    if (this.state === state && this.lastMessage === message) {
      return;
    }
    this.state = state;
    this.lastMessage = message;
    this.bus.publishBridgeState({ state, message });
  }
}
