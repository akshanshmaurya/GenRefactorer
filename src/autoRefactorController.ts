import * as vscode from 'vscode';
import { RefactorOptions, RefactorResult, RefactorService } from './refactorService';
import { GenRefactorerPreviewProvider } from './previewProvider';

interface AutoRefactorSuggestion {
  refactored: RefactorResult;
  documentVersion: number;
  timestamp: number;
}

type SuggestionListener = (suggestion: AutoRefactorSuggestion | undefined) => void;

type OptionResolver = (languageId: string) => RefactorOptions;

const STATUS_IDLE = 'GenRefactorer: idle';

export class AutoRefactorController implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly suggestions = new Map<string, AutoRefactorSuggestion>();
  private readonly statusItem: vscode.StatusBarItem;
  private activeRequest = 0;

  public constructor(
    private readonly service: RefactorService,
    private readonly previewProvider: GenRefactorerPreviewProvider,
    private readonly output: vscode.OutputChannel,
    private readonly resolveOptions: OptionResolver,
    private readonly notifySuggestion: SuggestionListener = () => undefined,
    private readonly debounceMs = 1500
  ) {
    this.statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusItem.text = STATUS_IDLE;
    this.statusItem.tooltip = 'GenRefactorer auto-refactor status';
    this.statusItem.show();

    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => this.onDocumentChanged(event)),
      vscode.workspace.onDidCloseTextDocument((doc) => this.clear(doc.uri)),
      vscode.window.onDidChangeActiveTextEditor(() => this.triggerActiveEditorScan())
    );

    this.triggerActiveEditorScan();
  }

  public dispose(): void {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.disposables.forEach((d) => d.dispose());
    this.statusItem.dispose();
    this.suggestions.clear();
  }

  private onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== event.document.uri.toString()) {
      return;
    }

    if (!this.shouldProcess(editor.document)) {
      return;
    }

    this.queue(editor.document);
  }

  private shouldProcess(doc: vscode.TextDocument): boolean {
    if (doc.isUntitled || doc.uri.scheme !== 'file') {
      return false;
    }

    const config = vscode.workspace.getConfiguration('genRefactorer');
    if (!config.get<boolean>('autoRefactorOnSelection', true)) {
      return false;
    }

    const content = doc.getText();
    if (content.trim().length === 0) {
      return false;
    }

    const limit = config.get<number>('maxAutoRefactorCharacters', 8000);
    return content.length <= limit;
  }

  private queue(doc: vscode.TextDocument): void {
    const key = doc.uri.toString();
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
    }

    const handle = setTimeout(() => void this.runRefactor(doc), this.debounceMs);
    this.timers.set(key, handle);
  }

  private async runRefactor(doc: vscode.TextDocument): Promise<void> {
    const key = doc.uri.toString();
    this.timers.delete(key);

    const options = this.resolveOptions(doc.languageId);
    const requestId = ++this.activeRequest;
    const version = doc.version;
    this.statusItem.text = 'GenRefactorer: thinking…';

    try {
      const result = await this.service.refactorCode(doc.getText(), options);
      if (requestId !== this.activeRequest || doc.version !== version) {
        return;
      }

      const suggestion: AutoRefactorSuggestion = {
        refactored: result,
        documentVersion: version,
        timestamp: Date.now()
      };
      this.suggestions.set(key, suggestion);
      this.notifySuggestion(suggestion);
      this.statusItem.text = 'GenRefactorer: suggestion ready';

      const previewUri = this.previewProvider.updatePreview(doc.uri, result.code);
      await vscode.commands.executeCommand(
        'vscode.diff',
        doc.uri,
        previewUri,
        'GenRefactorer Suggestion',
        {
          preview: true,
          viewColumn: vscode.ViewColumn.Beside
        }
      );

      this.output.appendLine('GenRefactorer prepared a background suggestion.');
      if (result.explanation) {
        this.output.appendLine(result.explanation);
      }

      await this.promptToApply(doc, suggestion);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (requestId === this.activeRequest) {
        this.statusItem.text = STATUS_IDLE;
      }
      this.output.appendLine(`[GenRefactorer] Auto-refactor failed: ${message}`);
    }
  }

  private async promptToApply(
    doc: vscode.TextDocument,
    suggestion: AutoRefactorSuggestion
  ): Promise<void> {
    const action = await vscode.window.showInformationMessage(
      'GenRefactorer has a suggestion ready.',
      'Apply',
      'Explain',
      'Dismiss'
    );

    if (doc.version !== suggestion.documentVersion) {
      return;
    }

    if (action === 'Apply') {
      await this.applySuggestion(doc, suggestion);
    } else if (action === 'Explain' && suggestion.refactored.explanation) {
      this.output.show(true);
    } else if (action === 'Dismiss') {
      this.clear(doc.uri);
    }
  }

  private async applySuggestion(
    doc: vscode.TextDocument,
    suggestion: AutoRefactorSuggestion
  ): Promise<void> {
    const range = this.getDocumentRange(doc);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, range, suggestion.refactored.code);
    const applied = await vscode.workspace.applyEdit(edit);
    if (applied) {
      this.output.appendLine('GenRefactorer auto suggestion applied.');
      this.clear(doc.uri);
      this.statusItem.text = STATUS_IDLE;
    }
  }

  private getDocumentRange(doc: vscode.TextDocument): vscode.Range {
    if (doc.lineCount === 0) {
      return new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));
    }

    const lastLine = doc.lineAt(doc.lineCount - 1);
    return new vscode.Range(new vscode.Position(0, 0), lastLine.rangeIncludingLineBreak.end);
  }

  private triggerActiveEditorScan(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    if (this.shouldProcess(editor.document)) {
      this.queue(editor.document);
    } else {
      this.clear(editor.document.uri);
    }
  }

  private clear(uri: vscode.Uri): void {
    const key = uri.toString();
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }

    if (this.suggestions.delete(key)) {
      this.notifySuggestion(undefined);
    }

    this.previewProvider.clear(uri);
    this.statusItem.text = STATUS_IDLE;
  }
}
