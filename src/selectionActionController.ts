import * as vscode from 'vscode';

interface SelectionActionItem extends vscode.QuickPickItem {
  id: 'refactor' | 'explain' | 'dismiss' | 'disable';
}

const ACTION_ITEMS: SelectionActionItem[] = [
  { id: 'refactor', label: '$(sparkle) Refactor selection' },
  { id: 'explain', label: '$(comment-discussion) Explain selection' },
  { id: 'dismiss', label: 'Dismiss' },
  {
    id: 'disable',
    label: 'Disable automatic prompts',
    description: 'Stop showing this menu when selecting text'
  }
];

export class SelectionActionController implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private pendingTimer: NodeJS.Timeout | undefined;
  private lastSelectionKey: string | undefined;
  private enabled = true;
  private quickPickOpen = false;

  public constructor(private readonly debounceMs = 600) {
    this.enabled = SelectionActionController.isFeatureEnabled();

    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((event) => this.onSelectionChanged(event)),
      vscode.window.onDidChangeActiveTextEditor(() => this.resetState()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('genRefactorer.showSelectionActions')) {
          this.enabled = SelectionActionController.isFeatureEnabled();
        }
      })
    );
  }

  public dispose(): void {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
    }

    this.disposables.forEach((d) => d.dispose());
  }

  public async showQuickActions(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showInformationMessage('Open a file and select code to use GenRefactorer actions.');
      return;
    }

    if (editor.selection.isEmpty) {
      void vscode.window.showWarningMessage('Select the code you want GenRefactorer to act on.');
      return;
    }

    await this.promptForSelection(editor, false);
  }

  private onSelectionChanged(event: vscode.TextEditorSelectionChangeEvent): void {
    if (!this.enabled) {
      return;
    }

    const editor = event.textEditor;
    if (!editor || editor.selection.isEmpty) {
      this.resetState();
      return;
    }

    const key = this.computeSelectionKey(editor.document, editor.selection);
    if (this.lastSelectionKey === key || this.quickPickOpen) {
      return;
    }

    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
    }

    this.pendingTimer = setTimeout(() => {
      void this.promptForSelection(editor, true);
    }, this.debounceMs);
  }

  private async promptForSelection(editor: vscode.TextEditor, autoTriggered: boolean): Promise<void> {
    if (editor.selection.isEmpty) {
      return;
    }

    const key = this.computeSelectionKey(editor.document, editor.selection);
    this.lastSelectionKey = key;

    this.quickPickOpen = true;
    try {
      const choice = await vscode.window.showQuickPick(ACTION_ITEMS, {
        placeHolder: 'GenRefactorer actions for current selection',
        ignoreFocusOut: true
      });

      if (!choice || choice.id === 'dismiss') {
        return;
      }

      if (choice.id === 'disable') {
        await vscode.workspace
          .getConfiguration('genRefactorer')
          .update('showSelectionActions', false, vscode.ConfigurationTarget.Global);
        void vscode.window.showInformationMessage('GenRefactorer selection prompts disabled. You can re-enable them in settings.');
        this.enabled = false;
        return;
      }

      if (choice.id === 'refactor') {
        await vscode.commands.executeCommand('genRefactorer.refactorSelection');
      } else if (choice.id === 'explain') {
        await vscode.commands.executeCommand('genRefactorer.explainSelection');
      }
    } finally {
      this.quickPickOpen = false;
      if (!autoTriggered) {
        this.lastSelectionKey = undefined;
      }
    }
  }

  private resetState(): void {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = undefined;
    }
    this.lastSelectionKey = undefined;
  }

  private computeSelectionKey(doc: vscode.TextDocument, selection: vscode.Selection): string {
    return `${doc.uri.toString()}#${selection.start.line}:${selection.start.character}-${selection.end.line}:${selection.end.character}@${doc.version}`;
  }

  private static isFeatureEnabled(): boolean {
    const config = vscode.workspace.getConfiguration('genRefactorer');
    return config.get<boolean>('showSelectionActions', true);
  }
}
