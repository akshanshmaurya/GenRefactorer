import * as vscode from 'vscode';

export interface RefactorOptions {
  style: 'conservative' | 'balanced' | 'aggressive';
  includeDocumentation: boolean;
  apiEndpoint: string;
  apiKey: string;
  languageId?: string;
}

export interface RefactorResult {
  code: string;
  explanation?: string;
}

export class RefactorService {
  private static readonly REMOTE_TIMEOUT_MS = 45000;

  public constructor(private readonly output: vscode.OutputChannel) {}

  public async refactorCode(input: string, options: RefactorOptions): Promise<RefactorResult> {
    const sanitized = input.trim();
    if (!sanitized) {
      throw new Error('Cannot refactor empty selection.');
    }

    this.output.appendLine(`[GenRefactorer] Preparing refactor request (style: ${options.style})`);
    const prefersRemote = this.isRemoteConfigured(options);

    if (prefersRemote) {
      try {
        const start = Date.now();
        const remoteResult = await this.requestRemoteRefactor(sanitized, options);
        const duration = Date.now() - start;
        this.output.appendLine(`[GenRefactorer] Remote refactor completed in ${duration}ms.`);
        return remoteResult;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.output.appendLine(`[GenRefactorer] Remote refactor failed: ${message}. Falling back to local heuristics.`);
      }
    } else {
      this.output.appendLine('[GenRefactorer] Remote endpoint not configured. Using local heuristic refactor.');
    }

    const fallback = this.localHeuristicRefactor(sanitized, options);
    this.output.appendLine('[GenRefactorer] Local heuristic refactor complete.');
    return fallback;
  }

  public async explainRefactor(input: string, refactored: string, existingExplanation?: string): Promise<string> {
    if (existingExplanation && existingExplanation.trim().length > 0) {
      return existingExplanation;
    }

    const { addedLines, removedLines } = this.diffSummary(input, refactored);
    const explanation = [
      '• Reduced redundant constructs and tightened control flow.',
      '• Improved naming and normalized modern syntax usage.',
      '• Added inline documentation for critical logic paths where applicable.'
    ];

    return [
      'Refactor Summary:',
      `Lines removed: ${removedLines}`,
      `Lines added: ${addedLines}`,
      ...explanation
    ].join('\n');
  }

  private async requestRemoteRefactor(text: string, options: RefactorOptions): Promise<RefactorResult> {
    if (!options.apiEndpoint) {
      throw new Error('Missing API endpoint. Set "genRefactorer.apiEndpoint" in settings.');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (options.apiKey) {
      headers.Authorization = `Bearer ${options.apiKey}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RefactorService.REMOTE_TIMEOUT_MS);

    try {
      const response = await fetch(options.apiEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          code: text,
          languageId: options.languageId,
          style: options.style,
          includeDocumentation: options.includeDocumentation
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backend responded with ${response.status}: ${response.statusText} ${errorText}`.trim());
      }

      const payload = (await response.json()) as Partial<{
        refactoredCode: string;
        code: string;
        result: string;
        explanation: string;
      }>;

      const code = payload.refactoredCode ?? payload.code ?? payload.result;
      if (!code) {
        throw new Error('Backend response missing refactored code.');
      }

      return {
        code,
        explanation: payload.explanation
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request to refactoring service timed out.');
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private localHeuristicRefactor(text: string, options: RefactorOptions): RefactorResult {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const docBlock = options.includeDocumentation
      ? ['/**', ` * Auto-refactored (${options.style})`, ' */']
      : [];

    const transformed = lines.map((line, index) => {
      const normalized = line
        .replace(/var\s+/g, 'let ')
        .replace(/function\s+(\w+)\s*\(/g, 'const $1 = (')
        .replace(/==([^=])/g, '===$1');

      if (options.style === 'aggressive') {
        return normalized.replace(/\s{2,}/g, ' ');
      }

      if (options.style === 'conservative') {
        return normalized;
      }

      return index === 0 ? `${normalized} // balanced refactor` : normalized;
    });

    const code = [...docBlock, ...transformed].join('\n');

    return {
      code,
      explanation: 'Local heuristic refactor applied (remote service unavailable).'
    };
  }

  private diffSummary(original: string, updated: string): { addedLines: number; removedLines: number } {
    const originalLines = original.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const updatedLines = updated.split(/\r?\n/).filter((line) => line.trim().length > 0);
    return {
      addedLines: Math.max(updatedLines.length - originalLines.length, 0),
      removedLines: Math.max(originalLines.length - updatedLines.length, 0)
    };
  }

  private isRemoteConfigured(options: RefactorOptions): boolean {
    return Boolean(options.apiEndpoint && options.apiEndpoint.startsWith('http'));
  }
}
