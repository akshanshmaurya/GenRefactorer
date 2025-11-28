import * as vscode from 'vscode';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

export interface RefactorOptions {
  style: 'conservative' | 'balanced' | 'aggressive';
  includeDocumentation: boolean;
  apiEndpoint: string; // Kept for backward compat, but we primarily use apiKey now
  apiKey: string;
  languageId?: string;
  model?: string;
}

export interface RefactorResult {
  code: string;
  explanation?: string;
}

export class RefactorService {
  private static readonly DEFAULT_MODEL = 'gemini-2.5-flash';

  public constructor(private readonly output: vscode.OutputChannel) { }

  public async refactorCode(input: string, options: RefactorOptions): Promise<RefactorResult> {
    if (!input.trim()) {
      throw new Error('Cannot refactor empty selection.');
    }

    const apiKey = await this.resolveApiKey(options.apiKey);
    if (!apiKey) {
      this.output.appendLine('[GenRefactorer] No API Key found. Please configure genRefactorer.apiKey or add a .env file.');
      return this.localHeuristicRefactor(input, options, 'Gemini API key not found.');
    }

    this.output.appendLine(`[GenRefactorer] Refactoring with Gemini (${options.model || RefactorService.DEFAULT_MODEL})...`);

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: options.model || RefactorService.DEFAULT_MODEL });

      const prompt = `
You are an expert coding assistant specializing in refactoring.
Refactor the following code.
Style: ${options.style} (conservative: minimal changes, balanced: clean up, aggressive: modern idioms and performance).
Include Documentation: ${options.includeDocumentation}.
Language: ${options.languageId || 'auto-detect'}.

Output ONLY the refactored code. Do not include markdown backticks or conversational text unless requested.
If you want to provide an explanation, put it in a separate block at the end starting with "---EXPLANATION---".

CODE:
${input}
      `.trim();

      const result = await model.generateContent(prompt);
      const response = result.response;
      const text = response.text();

      const [codePart, explanationPart] = text.split('---EXPLANATION---');

      // Clean up markdown code blocks if present
      const cleanCode = this.stripMarkdown(codePart.trim());

      return {
        code: cleanCode,
        explanation: explanationPart ? explanationPart.trim() : undefined
      };

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[GenRefactorer] Gemini request failed: ${message}. Falling back to local heuristics.`);
      return this.localHeuristicRefactor(input, options, `Gemini request failed: ${message}`);
    }
  }

  public async explainRefactor(input: string, refactored: string, existingExplanation?: string): Promise<string> {
    if (existingExplanation && existingExplanation.trim().length > 0) {
      return existingExplanation;
    }
    // If we didn't get an explanation from the refactor step, we could ask for one here,
    // but for now let's just return a simple summary to save tokens/latency.
    return 'Refactoring completed successfully. Review the changes in the diff view.';
  }

  public async explainSelection(input: string, options: RefactorOptions): Promise<string> {
    if (!input.trim()) {
      throw new Error('Cannot explain an empty selection.');
    }

    const apiKey = await this.resolveApiKey(options.apiKey);
    if (!apiKey) {
      return this.localSelectionExplanation(input, options.languageId);
    }

    this.output.appendLine('[GenRefactorer] Explaining selection with Gemini...');

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: options.model || RefactorService.DEFAULT_MODEL });

      const prompt = `
Explain the following code snippet concisely.
Language: ${options.languageId || 'auto-detect'}.

CODE:
${input}
      `.trim();

      const result = await model.generateContent(prompt);
      return result.response.text().trim();

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[GenRefactorer] Gemini explanation failed: ${message}.`);
      return this.localSelectionExplanation(input, options.languageId);
    }
  }

  public async scanForVulnerabilities(input: string, options: RefactorOptions): Promise<string> {
    if (!input.trim()) {
      throw new Error('Cannot scan empty selection.');
    }

    const apiKey = await this.resolveApiKey(options.apiKey);
    if (!apiKey) {
      throw new Error('Gemini API Key is required for security scanning.');
    }

    this.output.appendLine('[GenRefactorer] Scanning for vulnerabilities with Gemini...');

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: options.model || RefactorService.DEFAULT_MODEL });

      const prompt = `
Analyze the following code for security vulnerabilities (e.g., SQL Injection, XSS, Command Injection, Insecure Deserialization, etc.).
Language: ${options.languageId || 'auto-detect'}.

Output Format:
- List each vulnerability found with Severity (High/Medium/Low).
- Explanation of why it is a vulnerability.
- A FIXED version of the code that resolves the issues.

If no vulnerabilities are found, state "No obvious security vulnerabilities found."

CODE:
${input}
      `.trim();

      const result = await model.generateContent(prompt);
      return result.response.text().trim();

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[GenRefactorer] Security scan failed: ${message}.`);
      throw error;
    }
  }

  private async resolveApiKey(configKey: string): Promise<string | undefined> {
    if (configKey && configKey.trim().length > 0) {
      return configKey;
    }

    // Try to find .env in workspace folders
    if (vscode.workspace.workspaceFolders) {
      for (const folder of vscode.workspace.workspaceFolders) {
        const envPath = path.join(folder.uri.fsPath, '.env');
        if (fs.existsSync(envPath)) {
          const envConfig = dotenv.parse(fs.readFileSync(envPath));
          if (envConfig.GEMINI_API_KEY) {
            this.output.appendLine('[GenRefactorer] Found GEMINI_API_KEY in workspace .env file.');
            return envConfig.GEMINI_API_KEY;
          }
        }
        // Also check server/.env as a fallback since the user mentioned it
        const serverEnvPath = path.join(folder.uri.fsPath, 'server', '.env');
        if (fs.existsSync(serverEnvPath)) {
          const envConfig = dotenv.parse(fs.readFileSync(serverEnvPath));
          if (envConfig.GEMINI_API_KEY) {
            this.output.appendLine('[GenRefactorer] Found GEMINI_API_KEY in server/.env file.');
            return envConfig.GEMINI_API_KEY;
          }
        }
      }
    }

    return undefined;
  }

  private stripMarkdown(text: string): string {
    // Remove wrapping ```language ... ```
    const codeBlockRegex = /^```(?:\w+)?\s*([\s\S]*?)\s*```$/;
    const match = text.match(codeBlockRegex);
    if (match) {
      return match[1];
    }
    return text;
  }

  private localHeuristicRefactor(text: string, options: RefactorOptions, reason: string): RefactorResult {
    const normalizedLines = text.split(/\r?\n/).map((line) => line.replace(/\s+$/g, ''));
    const transformed = normalizedLines.map((line) =>
      line
        .replace(/var\s+/g, 'let ')
        .replace(/function\s+(\w+)\s*\(/g, 'const $1 = (')
        .replace(/==([^=])/g, '===$1')
    );

    const joined = transformed.join('\n');
    const condensed = options.style === 'aggressive' ? joined.replace(/\n{3,}/g, '\n\n') : joined;
    const documented = options.includeDocumentation && !condensed.trimStart().startsWith('//')
      ? [`// Auto-refactored (${options.style})`, condensed].join('\n')
      : condensed;

    return {
      code: documented,
      explanation: `Local heuristic refactor applied. Reason: ${reason}`
    };
  }

  private localSelectionExplanation(text: string, languageId?: string): string {
    return `Gemini API not configured. Local summary: ${text.split('\n').length} lines of ${languageId || 'code'}.`;
  }
}
