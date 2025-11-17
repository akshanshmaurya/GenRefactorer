import * as vscode from 'vscode';
import {
  ActionsUpdate,
  AssistantLogEntry,
  AssistantStatus,
  BridgeMessageUpdate,
  BridgeStateUpdate,
  ContextUpdate,
  LogUpdate,
  StatusUpdate
} from './types/assistant';
import { WorkspaceContextSnapshot } from './workspaceContextManager';

export class AssistantEventBus implements vscode.Disposable {
  private readonly statusEmitter = new vscode.EventEmitter<StatusUpdate>();
  private readonly logEmitter = new vscode.EventEmitter<LogUpdate>();
  private readonly contextEmitter = new vscode.EventEmitter<ContextUpdate>();
  private readonly actionsEmitter = new vscode.EventEmitter<ActionsUpdate>();
  private readonly bridgeEmitter = new vscode.EventEmitter<BridgeStateUpdate>();
  private readonly bridgeMessageEmitter = new vscode.EventEmitter<BridgeMessageUpdate>();
  private _disposed = false;
  private logSequence = 0;

  public readonly onStatusChanged = this.statusEmitter.event;
  public readonly onLogEntry = this.logEmitter.event;
  public readonly onContextChanged = this.contextEmitter.event;
  public readonly onActionsChanged = this.actionsEmitter.event;
  public readonly onBridgeStateChanged = this.bridgeEmitter.event;
  public readonly onBridgeMessage = this.bridgeMessageEmitter.event;

  public dispose(): void {
    if (this._disposed) {
      return;
    }
    this.statusEmitter.dispose();
    this.logEmitter.dispose();
    this.contextEmitter.dispose();
    this.actionsEmitter.dispose();
    this.bridgeEmitter.dispose();
    this.bridgeMessageEmitter.dispose();
    this._disposed = true;
  }

  public publishStatus(status: AssistantStatus, lastMessage?: string): void {
    this.statusEmitter.fire({ status, lastMessage });
  }

  public publishLog(entry: AssistantLogEntry): void {
    this.logEmitter.fire({ entry });
  }

  public log(message: string, level: AssistantLogEntry['level'] = 'info'): AssistantLogEntry {
    this.logSequence += 1;
    const entry: AssistantLogEntry = {
      id: `log-${this.logSequence}`,
      message,
      level,
      timestamp: new Date().toISOString()
    };
    this.publishLog(entry);
    return entry;
  }

  public publishContext(snapshot: WorkspaceContextSnapshot): void {
    this.contextEmitter.fire({ snapshot });
  }

  public publishActions(actions: ActionsUpdate['actions']): void {
    this.actionsEmitter.fire({ actions });
  }

  public publishBridgeState(update: BridgeStateUpdate): void {
    this.bridgeEmitter.fire(update);
  }

  public publishBridgeMessage(update: BridgeMessageUpdate): void {
    this.bridgeMessageEmitter.fire(update);
  }
}
