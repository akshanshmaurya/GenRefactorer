import * as vscode from 'vscode';
import { RefactorService, RefactorOptions } from './refactorService';

interface RefactorSnapshot {
  original: string;
  updated: string;
  languageId: string;
  explanation?: string;
}

let snapshot: RefactorSnapshot | undefined;
let outputChannel: vscode.OutputChannel | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel('GenRefactorer');
  const service = new RefactorService(outputChannel);

  context.subscriptions.push(outputChannel);

  context.subscriptions.push(
    vscode.commands.registerCommand('genRefactorer.refactorSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showInformationMessage('Open a file to refactor with GenRefactorer.');
        return;
      }

      const selection = editor.selection;
      if (selection.isEmpty) {
        void vscode.window.showWarningMessage('Select the code block you want to refactor.');
        return;
      }

      const original = editor.document.getText(selection);
      const options = resolveOptions(editor.document.languageId);

      try {
        const refactorResult = await service.refactorCode(original, options);
        const refactored = refactorResult.code;

        if (refactorResult.explanation) {
          outputChannel?.appendLine(refactorResult.explanation);
        }
        const action = await vscode.window.showInformationMessage(
          'GenRefactorer generated a refactor suggestion.',
          'Apply',
          'Preview',
          'Cancel'
        );

        if (action === 'Apply') {
          await editor.edit((editBuilder: vscode.TextEditorEdit) => {
            editBuilder.replace(selection, refactored);
          });
          snapshot = {
            original,
            updated: refactored,
            languageId: editor.document.languageId,
            explanation: refactorResult.explanation
          };
          outputChannel?.show(true);
        } else if (action === 'Preview') {
          const doc = await vscode.workspace.openTextDocument({
            content: refactored,
            language: editor.document.languageId
          });
          await vscode.window.showTextDocument(doc, { preview: true });
          snapshot = {
            original,
            updated: refactored,
            languageId: editor.document.languageId,
            explanation: refactorResult.explanation
          };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`GenRefactorer failed: ${message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('genRefactorer.explainRefactor', async () => {
      if (!snapshot) {
        void vscode.window.showInformationMessage('Run a refactor before requesting an explanation.');
        return;
      }

      const explanation = await service.explainRefactor(
        snapshot.original,
        snapshot.updated,
        snapshot.explanation
      );
      outputChannel?.show(true);
      outputChannel?.appendLine(explanation);
      void vscode.window.showInformationMessage('Refactor summary added to the GenRefactorer output panel.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('genRefactorer.openSettings', async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'GenRefactorer');
    })
  );
}

export function deactivate(): void {
  outputChannel?.dispose();
}

function resolveOptions(languageId: string): RefactorOptions {
  const config = vscode.workspace.getConfiguration('genRefactorer');
  return {
    apiEndpoint: config.get<string>('apiEndpoint', ''),
    apiKey: config.get<string>('apiKey', ''),
    includeDocumentation: config.get<boolean>('includeDocumentation', true),
    style: config.get<'conservative' | 'balanced' | 'aggressive'>('refactorStyle', 'balanced'),
    languageId
  };
}
