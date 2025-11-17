import * as vscode from 'vscode';

export interface DiagnosticsEntry {
  uri: string;
  fileName: string;
  message: string;
  severity: 'error' | 'warning' | 'info' | 'hint';
  source?: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export interface ActiveEditorSummary {
  uri: string;
  fileName: string;
  languageId: string;
  selection?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  preview: string;
}

export interface WorkspaceContextSnapshot {
  timestamp: string;
  activeEditor?: ActiveEditorSummary;
  diagnostics: DiagnosticsEntry[];
}

const MAX_PREVIEW_LENGTH = 4000;

export class WorkspaceContextManager implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly onSnapshotChanged = new vscode.EventEmitter<WorkspaceContextSnapshot>();
  private snapshot: WorkspaceContextSnapshot = { timestamp: new Date().toISOString(), diagnostics: [] };
  private refreshTimer: NodeJS.Timeout | undefined;

  public constructor() {
    this.refreshSnapshot('initial');

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.refreshSnapshot('active-editor')),
      vscode.window.onDidChangeTextEditorSelection(() => this.scheduleRefresh()),
      vscode.workspace.onDidChangeTextDocument(() => this.scheduleRefresh()),
      vscode.languages.onDidChangeDiagnostics(() => this.refreshDiagnostics()),
      this.onSnapshotChanged
    );
  }

  public dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.disposables.forEach((d) => d.dispose());
  }

  public getSnapshot(): WorkspaceContextSnapshot {
    return this.snapshot;
  }

  public onDidChangeSnapshot(listener: (snapshot: WorkspaceContextSnapshot) => void): vscode.Disposable {
    return this.onSnapshotChanged.event(listener);
  }

  public refreshSnapshot(reason: string): WorkspaceContextSnapshot {
    const editor = vscode.window.activeTextEditor;
    this.snapshot = {
      timestamp: new Date().toISOString(),
      activeEditor: editor ? this.buildEditorSummary(editor) : undefined,
      diagnostics: this.collectDiagnostics()
    };
    this.fireSnapshotChanged();

    return this.snapshot;
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = setTimeout(() => this.refreshSnapshot('debounced'), 500);
  }

  private refreshDiagnostics(): void {
    this.snapshot = {
      ...this.snapshot,
      timestamp: new Date().toISOString(),
      diagnostics: this.collectDiagnostics()
    };
    this.fireSnapshotChanged();
  }

  private buildEditorSummary(editor: vscode.TextEditor): ActiveEditorSummary {
    const document = editor.document;
    const text = document.getText();
    const preview = text.length > MAX_PREVIEW_LENGTH ? `${text.slice(0, MAX_PREVIEW_LENGTH)}…` : text;

    const selection = editor.selection.isEmpty
      ? undefined
      : {
          start: { line: editor.selection.start.line, character: editor.selection.start.character },
          end: { line: editor.selection.end.line, character: editor.selection.end.character }
        };

    return {
      uri: document.uri.toString(),
      fileName: vscode.workspace.asRelativePath(document.uri, false) ?? document.fileName,
      languageId: document.languageId,
      selection,
      preview
    };
  }

  private collectDiagnostics(): DiagnosticsEntry[] {
    const entries: DiagnosticsEntry[] = [];
    const diagnostics = vscode.languages.getDiagnostics();

    diagnostics.forEach(([uri, diagList]) => {
      diagList.forEach((diag) => {
        entries.push({
          uri: uri.toString(),
          fileName: vscode.workspace.asRelativePath(uri, false) ?? uri.fsPath,
          message: diag.message,
          severity: this.toSeverity(diag.severity),
          source: diag.source,
          range: {
            start: { line: diag.range.start.line, character: diag.range.start.character },
            end: { line: diag.range.end.line, character: diag.range.end.character }
          }
        });
      });
    });

    return entries;
  }

  private toSeverity(severity: vscode.DiagnosticSeverity): DiagnosticsEntry['severity'] {
    switch (severity) {
      case vscode.DiagnosticSeverity.Error:
        return 'error';
      case vscode.DiagnosticSeverity.Warning:
        return 'warning';
      case vscode.DiagnosticSeverity.Information:
        return 'info';
      case vscode.DiagnosticSeverity.Hint:
        return 'hint';
      default:
        return 'info';
    }
  }

  private fireSnapshotChanged(): void {
    this.onSnapshotChanged.fire(this.snapshot);
  }
}
