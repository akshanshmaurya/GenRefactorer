import * as assert from 'assert';
import * as vscode from 'vscode';

suite('GenRefactorer Extension Suite', () => {
  test('Commands are registered', async () => {
    const extension = vscode.extensions.getExtension('your-name-here.gen-refactorer');
    assert.ok(extension, 'Extension should be discoverable');
    await extension?.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('genRefactorer.refactorSelection'));
    assert.ok(commands.includes('genRefactorer.explainRefactor'));
    assert.ok(commands.includes('genRefactorer.openSettings'));
  });
});
