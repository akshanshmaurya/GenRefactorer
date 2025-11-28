import * as vscode from 'vscode';
import { AutoRefactorController } from './autoRefactorController';
import { RefactorService, RefactorOptions } from './refactorService';
import { GenRefactorerPreviewProvider, GENREFACTORER_PREVIEW_SCHEME } from './previewProvider';
import { SelectionActionController } from './selectionActionController';
import { AssistantPanelProvider } from './assistantPanel';
import { WorkspaceContextManager, DiagnosticsEntry } from './workspaceContextManager';
import { GitService } from './gitService';
import * as path from 'path';
import { AssistantEventBus } from './assistantEventBus';
import { ActionOrchestrator } from './actionOrchestrator';
import { AssistantAction } from './types/assistant';
import { McpBridge } from './mcpBridge';
import { McpCoordinator } from './mcpCoordinator';

interface RefactorSnapshot {
  original: string;
  updated: string;
  languageId: string;
  explanation?: string;
}

let snapshot: RefactorSnapshot | undefined;
let outputChannel: vscode.OutputChannel | undefined;
let autoController: AutoRefactorController | undefined;
let selectionController: SelectionActionController | undefined;
let assistantPanel: AssistantPanelProvider | undefined;
let contextManager: WorkspaceContextManager | undefined;
let assistantBus: AssistantEventBus | undefined;
let orchestrator: ActionOrchestrator | undefined;
let mcpBridge: McpBridge | undefined;
let mcpCoordinator: McpCoordinator | undefined;
let gitService: GitService | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('GenRefactorer');
  outputChannel = output;
  const service = new RefactorService(output);
  gitService = new GitService(output);

  context.subscriptions.push(output);

  const previewProvider = new GenRefactorerPreviewProvider();
  const previewRegistration = vscode.workspace.registerTextDocumentContentProvider(
    GENREFACTORER_PREVIEW_SCHEME,
    previewProvider
  );
  context.subscriptions.push(previewRegistration);

  const configureAutoRefactorController = (): void => {
    const config = vscode.workspace.getConfiguration('genRefactorer');
    const enabled = config.get<boolean>('autoRefactorOnSelection', false);
    if (!enabled) {
      if (autoController) {
        autoController.dispose();
        autoController = undefined;
      }
      return;
    }

    if (autoController) {
      autoController.dispose();
      autoController = undefined;
    }

    const debounce = config.get<number>('autoRefactorDebounceMs', 1500);
    autoController = new AutoRefactorController(
      service,
      previewProvider,
      output,
      resolveOptions,
      undefined,
      debounce
    );
    context.subscriptions.push(autoController);
  };

  configureAutoRefactorController();

  selectionController = new SelectionActionController();
  context.subscriptions.push(selectionController);

  assistantBus = new AssistantEventBus();
  context.subscriptions.push(assistantBus);

  orchestrator = new ActionOrchestrator(assistantBus);
  context.subscriptions.push(orchestrator);
  orchestrator.setActions(getDefaultAssistantActions());

  assistantPanel = new AssistantPanelProvider(context, assistantBus);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(AssistantPanelProvider.viewType, assistantPanel)
  );
  assistantBus.publishStatus('idle', 'Assistant ready');

  mcpBridge = new McpBridge(assistantBus);
  context.subscriptions.push(mcpBridge);
  applyMcpConfiguration();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('genRefactorer.assistant')) {
        applyMcpConfiguration();
      }
      if (
        event.affectsConfiguration('genRefactorer.autoRefactorOnSelection') ||
        event.affectsConfiguration('genRefactorer.autoRefactorDebounceMs')
      ) {
        configureAutoRefactorController();
      }
    })
  );

  contextManager = new WorkspaceContextManager();
  context.subscriptions.push(contextManager);
  assistantBus.publishContext(contextManager.getSnapshot());
  context.subscriptions.push(
    contextManager.onDidChangeSnapshot((snapshotUpdate) => assistantBus?.publishContext(snapshotUpdate))
  );

  if (assistantBus && mcpBridge && contextManager && orchestrator) {
    mcpCoordinator = new McpCoordinator(assistantBus, mcpBridge, contextManager, orchestrator);
    context.subscriptions.push(mcpCoordinator);
  }

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
      assistantBus?.log('Refactor request queued for current selection.');

      try {
        assistantBus?.publishStatus('processing', 'Refactoring selection...');
        const refactorResult = await service.refactorCode(original, options);
        const refactored = refactorResult.code;

        if (refactorResult.explanation) {
          outputChannel?.appendLine(refactorResult.explanation);
          assistantBus?.log(refactorResult.explanation);
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
          assistantBus?.log('Applied refactor suggestion to selection.');
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
        assistantBus?.publishStatus('idle', 'Refactor complete.');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`GenRefactorer failed: ${message}`);
        assistantBus?.publishStatus('error', message);
        assistantBus?.log(`Refactor failed: ${message}`, 'error');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('genRefactorer.explainSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showInformationMessage('Open a file to let GenRefactorer explain it.');
        return;
      }

      const selection = editor.selection;
      if (selection.isEmpty) {
        void vscode.window.showWarningMessage('Select the code you want GenRefactorer to explain.');
        return;
      }

      const text = editor.document.getText(selection);
      const options = resolveOptions(editor.document.languageId);
      assistantBus?.log('Explain request queued for current selection.');

      try {
        assistantBus?.publishStatus('processing', 'Explaining selection...');
        const explanation = await service.explainSelection(text, options);
        outputChannel?.show(true);
        outputChannel?.appendLine(explanation);
        assistantBus?.log('Selection explanation ready.');
        assistantBus?.publishStatus('idle', 'Selection explanation complete.');
        void vscode.window.showInformationMessage('GenRefactorer explanation added to output.');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`GenRefactorer failed to explain selection: ${message}`);
        assistantBus?.publishStatus('error', message);
        assistantBus?.log(`Explain failed: ${message}`, 'error');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('genRefactorer.showSelectionActions', async () => {
      await selectionController?.showQuickActions();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('genRefactorer.assistant.refreshContext', async () => {
      if (!contextManager) {
        void vscode.window.showWarningMessage('Assistant context manager is not initialized yet.');
        return;
      }

      const snapshot = contextManager.refreshSnapshot('command');
      const label = snapshot.activeEditor?.fileName ?? 'No active file';
      assistantBus?.publishStatus('idle', `Context captured: ${label}`);
      assistantBus?.log(`Context refreshed (${snapshot.diagnostics.length} diagnostics).`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('genRefactorer.assistant.sendContextToMcp', async () => {
      if (!contextManager) {
        void vscode.window.showWarningMessage('Assistant context manager is not initialized yet.');
        return;
      }
      if (!mcpBridge) {
        void vscode.window.showWarningMessage('MCP bridge is not available.');
        return;
      }

      const snapshot = contextManager.getSnapshot();
      const sent = mcpBridge.send({ type: 'context.snapshot', payload: snapshot });
      if (sent) {
        assistantBus?.log('Sent workspace context snapshot to MCP bridge.');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('genRefactorer.assistant.runMcpAction', async (remoteActionId?: string) => {
      if (!remoteActionId || typeof remoteActionId !== 'string') {
        void vscode.window.showWarningMessage('MCP action identifier was not provided.');
        return;
      }
      if (!mcpCoordinator) {
        void vscode.window.showWarningMessage('MCP coordinator is not ready.');
        return;
      }
      mcpCoordinator.invokeRemoteAction(remoteActionId);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('genRefactorer.assistant.chatWithMcp', async () => {
      if (!mcpCoordinator) {
        void vscode.window.showWarningMessage('MCP coordinator is not ready.');
        return;
      }
      const message = await vscode.window.showInputBox({
        prompt: 'Ask the Gemini MCP assistant something',
        placeHolder: 'e.g., Suggest improvements for the open file',
        validateInput: (value) => (value.trim().length === 0 ? 'Enter a prompt to send.' : undefined)
      });
      if (!message) {
        return;
      }
      mcpCoordinator.sendChatMessage(message);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'genRefactorer.assistant.chatPrompt',
      async (rawMessage?: unknown, includeContext?: unknown) => {
        const provided = typeof rawMessage === 'string' ? rawMessage.trim() : '';
        const resolvedMessage =
          provided.length > 0
            ? provided
            : await vscode.window.showInputBox({
              prompt: 'Ask the GenRefactorer assistant for help',
              placeHolder: 'Describe the task you want the assistant to run'
            });

        if (!resolvedMessage || resolvedMessage.trim().length === 0) {
          return;
        }

        const shouldIncludeContext = typeof includeContext === 'boolean' ? includeContext : true;
        if (mcpCoordinator) {
          mcpCoordinator.sendChatMessage(resolvedMessage, shouldIncludeContext);
          return;
        }

        const timestamp = new Date().toISOString();
        assistantBus?.publishChatMessage({
          id: `chat-${timestamp}-user`,
          role: 'user',
          message: resolvedMessage,
          timestamp
        });
        assistantBus?.publishChatMessage({
          id: `chat-${timestamp}-system`,
          role: 'system',
          message: 'Connect the MCP bridge in settings to chat with the assistant.',
          timestamp: new Date().toISOString()
        });
        assistantBus?.publishStatus('error', 'Assistant bridge is disabled.');
        assistantBus?.log('Chat prompt ignored because MCP bridge is disabled.', 'warn');
        void vscode.window.showWarningMessage(
          'GenRefactorer is not connected to the MCP bridge. Enable it in settings to chat with the assistant.'
        );
      }
    )
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

  context.subscriptions.push(
    vscode.commands.registerCommand('genRefactorer.assistant.fixDiagnostics', async () => {
      if (!contextManager) {
        void vscode.window.showWarningMessage('Workspace context manager is not ready yet.');
        return;
      }

      const snapshot = contextManager.getSnapshot();
      if (!snapshot.diagnostics.length) {
        void vscode.window.showInformationMessage('No diagnostics found in the current workspace.');
        return;
      }

      type DiagnosticPick = vscode.QuickPickItem & { diagnostic: DiagnosticsEntry };

      const picks: DiagnosticPick[] = snapshot.diagnostics.slice(0, 50).map((diagnostic) => ({
        label: diagnostic.fileName,
        description: diagnostic.message,
        detail: `${diagnostic.severity.toUpperCase()} [${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1
          }]`,
        diagnostic
      }));

      const selection = await vscode.window.showQuickPick(picks, {
        placeHolder: 'Select a diagnostic to navigate to and attempt a fix'
      });

      if (!selection) {
        return;
      }

      const diagnostic = selection.diagnostic;
      const uri = vscode.Uri.parse(diagnostic.uri);
      try {
        const document = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(document, { preview: false });
        const range = new vscode.Range(
          new vscode.Position(diagnostic.range.start.line, diagnostic.range.start.character),
          new vscode.Position(diagnostic.range.end.line, diagnostic.range.end.character)
        );
        editor.selection = new vscode.Selection(range.start, range.end);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        assistantBus?.publishStatus('processing', 'Opened diagnostic for review.');
        assistantBus?.log(`Navigated to diagnostic in ${diagnostic.fileName}.`);
        await vscode.commands.executeCommand('editor.action.quickFix');
        assistantBus?.publishStatus('idle', 'Diagnostic highlighted. Apply a quick fix to resolve.');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        assistantBus?.publishStatus('error', message);
        assistantBus?.log(`Failed to open diagnostic target: ${message}`, 'error');
        void vscode.window.showErrorMessage(`Unable to open diagnostic target: ${message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('genRefactorer.scanSecurity', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showInformationMessage('Open a file to scan for vulnerabilities.');
        return;
      }

      const selection = editor.selection;
      if (selection.isEmpty) {
        void vscode.window.showWarningMessage('Select the code you want to scan.');
        return;
      }

      const text = editor.document.getText(selection);
      const options = resolveOptions(editor.document.languageId);
      assistantBus?.log('Security scan requested.');

      try {
        assistantBus?.publishStatus('processing', 'Scanning for vulnerabilities...');
        const result = await service.scanForVulnerabilities(text, options);
        outputChannel?.show(true);
        outputChannel?.appendLine('--- Security Scan Results ---');
        outputChannel?.appendLine(result);
        assistantBus?.log('Security scan complete.');
        assistantBus?.publishStatus('idle', 'Security scan complete.');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Security scan failed: ${message}`);
        assistantBus?.publishStatus('error', message);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('genRefactorer.commitChanges', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showInformationMessage('Open a file to commit changes.');
        return;
      }

      if (editor.document.isDirty) {
        await editor.document.save();
      }

      const cwd = path.dirname(editor.document.uri.fsPath);
      if (!gitService || !(await gitService.isGitRepo(cwd))) {
        void vscode.window.showErrorMessage('Current file is not in a git repository.');
        return;
      }

      const fileName = path.basename(editor.document.uri.fsPath);

      try {
        assistantBus?.publishStatus('processing', 'Generating commit message...');

        const options = resolveOptions(editor.document.languageId);

        const commitMessage = await vscode.window.showInputBox({
          prompt: 'Enter commit message',
          placeHolder: `Refactor ${fileName}`,
          value: `Refactor ${fileName}: Improved code quality`
        });

        if (!commitMessage) return;

        await gitService.stageFile(editor.document.uri.fsPath);
        await gitService.commit(commitMessage, cwd);

        void vscode.window.showInformationMessage(`Committed changes to ${fileName}`);
        assistantBus?.log(`Committed ${fileName}: ${commitMessage}`);
        assistantBus?.publishStatus('idle', 'Commit complete.');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Commit failed: ${message}`);
        assistantBus?.publishStatus('error', message);
      }
    })
  );
}

export function deactivate(): void {
  autoController?.dispose();
  autoController = undefined;
  selectionController?.dispose();
  selectionController = undefined;
  contextManager?.dispose();
  contextManager = undefined;
  assistantPanel?.dispose();
  assistantPanel = undefined;
  orchestrator?.dispose();
  orchestrator = undefined;
  mcpBridge?.dispose();
  mcpBridge = undefined;
  mcpCoordinator?.dispose();
  mcpCoordinator = undefined;
  assistantBus?.dispose();
  assistantBus = undefined;
  outputChannel?.dispose();
  outputChannel = undefined;
}

function resolveOptions(languageId: string): RefactorOptions {
  const config = vscode.workspace.getConfiguration('genRefactorer');
  return {
    apiEndpoint: config.get<string>('apiEndpoint', ''),
    apiKey: config.get<string>('apiKey', ''),
    includeDocumentation: config.get<boolean>('includeDocumentation', true),
    style: config.get<'conservative' | 'balanced' | 'aggressive'>('refactorStyle', 'balanced'),
    languageId,
    model: config.get<string>('model', 'gemini-2.5-flash')
  };
}

function getDefaultAssistantActions(): AssistantAction[] {
  return [
    {
      id: 'refactor-selection',
      label: 'Refactor Selection',
      description: 'Send the highlighted code to GenRefactorer for a suggested rewrite.',
      command: 'genRefactorer.refactorSelection',
      emphasis: 'primary'
    },
    {
      id: 'explain-selection',
      label: 'Explain Selection',
      description: 'Generate a plain-language explanation for the highlighted code.',
      command: 'genRefactorer.explainSelection'
    },
    {
      id: 'selection-actions',
      label: 'Selection Actions',
      description: 'Open the quick actions palette for the current selection.',
      command: 'genRefactorer.showSelectionActions'
    },
    {
      id: 'refresh-context',
      label: 'Refresh Context',
      description: 'Capture the latest workspace context snapshot.',
      command: 'genRefactorer.assistant.refreshContext'
    },
    {
      id: 'send-context-mcp',
      label: 'Send Context to MCP',
      description: 'Push the latest workspace snapshot over the MCP bridge (experimental).',
      command: 'genRefactorer.assistant.sendContextToMcp'
    },
    {
      id: 'chat-with-mcp',
      label: 'Chat with MCP',
      description: 'Send a conversational prompt to the Gemini MCP server and iterate on suggestions.',
      command: 'genRefactorer.assistant.chatWithMcp'
    }
  ];
}

function applyMcpConfiguration(): void {
  const assistantConfig = vscode.workspace.getConfiguration('genRefactorer.assistant');
  const enabled = assistantConfig.get<boolean>('enableMcpBridge', false);
  const endpoint = assistantConfig.get<string>('mcpEndpoint', '').trim() || undefined;
  const authToken = assistantConfig.get<string>('mcpAuthToken', '').trim() || undefined;
  mcpBridge?.applyConfiguration({ enabled, endpoint, authToken });
}
