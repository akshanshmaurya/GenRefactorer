import * as vscode from 'vscode';

export const GENREFACTORER_PREVIEW_SCHEME = 'genrefactorer-preview';

type PreviewKey = string;

export class GenRefactorerPreviewProvider implements vscode.TextDocumentContentProvider {
  private readonly cache = new Map<PreviewKey, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();

  public readonly onDidChange = this.emitter.event;

  public provideTextDocumentContent(uri: vscode.Uri): string {
    return this.cache.get(uri.toString()) ?? '';
  }

  public updatePreview(target: vscode.Uri, code: string): vscode.Uri {
    const previewUri = this.toPreviewUri(target);
    this.cache.set(previewUri.toString(), code);
    this.emitter.fire(previewUri);
    return previewUri;
  }

  public clear(target: vscode.Uri): void {
    const previewUri = this.toPreviewUri(target);
    this.cache.delete(previewUri.toString());
    this.emitter.fire(previewUri);
  }

  private toPreviewUri(target: vscode.Uri): vscode.Uri {
    const encoded = encodeURIComponent(target.toString());
    return vscode.Uri.parse(`${GENREFACTORER_PREVIEW_SCHEME}://${encoded}.preview`);
  }
}
