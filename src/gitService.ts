import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';

export class GitService {
    constructor(private readonly output: vscode.OutputChannel) { }

    public async isGitRepo(cwd: string): Promise<boolean> {
        try {
            await this.exec('git rev-parse --is-inside-work-tree', cwd);
            return true;
        } catch {
            return false;
        }
    }

    public async stageFile(filePath: string): Promise<void> {
        const cwd = path.dirname(filePath);
        await this.exec(`git add "${filePath}"`, cwd);
        this.output.appendLine(`[Git] Staged file: ${filePath}`);
    }

    public async commit(message: string, cwd: string): Promise<void> {
        // Escape double quotes in message
        const escapedMessage = message.replace(/"/g, '\\"');
        await this.exec(`git commit -m "${escapedMessage}"`, cwd);
        this.output.appendLine(`[Git] Committed with message: ${message}`);
    }

    private exec(command: string, cwd: string): Promise<string> {
        return new Promise((resolve, reject) => {
            cp.exec(command, { cwd }, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(stderr || error.message));
                } else {
                    resolve(stdout.trim());
                }
            });
        });
    }
}
