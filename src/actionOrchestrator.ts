import { Disposable } from 'vscode';
import { AssistantEventBus } from './assistantEventBus';
import { AssistantAction } from './types/assistant';

export class ActionOrchestrator implements Disposable {
  private readonly actionMap = new Map<string, AssistantAction>();
  private readonly actionSources = new Map<string, string>();
  private readonly sourceIndex = new Map<string, Set<string>>();
  private _disposed = false;

  public constructor(private readonly bus: AssistantEventBus) {}

  public dispose(): void {
    if (this._disposed) {
      return;
    }
    this.actionMap.clear();
    this.actionSources.clear();
    this.sourceIndex.clear();
    this._disposed = true;
  }

  public setActions(actions: AssistantAction[]): void {
    this.setActionsForSource('local', actions);
  }

  public setActionsForSource(source: string, actions: AssistantAction[]): void {
    this.removeActionsBySource(source);
    actions.forEach((action) => this.addAction(action, source));
    this.publish();
  }

  public registerAction(action: AssistantAction, source = 'local'): void {
    this.addAction(action, source);
    this.publish();
  }

  public updateAction(id: string, updates: Partial<AssistantAction>): void {
    const existing = this.actionMap.get(id);
    if (!existing) {
      return;
    }
    this.actionMap.set(id, { ...existing, ...updates });
    this.publish();
  }

  public getActions(): AssistantAction[] {
    return Array.from(this.actionMap.values());
  }

  private publish(): void {
    this.bus.publishActions(this.getActions());
  }

  private addAction(action: AssistantAction, source: string): void {
    const normalizedSource = action.source ?? source;
    const normalizedAction: AssistantAction = { ...action, source: normalizedSource };
    const existingSource = this.actionSources.get(action.id);
    if (existingSource && existingSource !== normalizedSource) {
      this.removeIdFromSource(action.id, existingSource);
    }
    this.actionMap.set(action.id, normalizedAction);
    this.actionSources.set(action.id, normalizedSource);
    const bucket = this.sourceIndex.get(normalizedSource) ?? new Set<string>();
    bucket.add(action.id);
    this.sourceIndex.set(normalizedSource, bucket);
  }

  private removeActionsBySource(source: string): void {
    const bucket = this.sourceIndex.get(source);
    if (!bucket || bucket.size === 0) {
      return;
    }
    bucket.forEach((id) => {
      this.actionMap.delete(id);
      this.actionSources.delete(id);
    });
    bucket.clear();
  }

  private removeIdFromSource(id: string, source: string): void {
    const bucket = this.sourceIndex.get(source);
    bucket?.delete(id);
    if (bucket && bucket.size === 0) {
      this.sourceIndex.delete(source);
    }
  }
}
