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
    if (!input.trim()) {
      throw new Error('Cannot refactor empty selection.');
    }

    this.output.appendLine(`[GenRefactorer] Preparing refactor request (style: ${options.style})`);
    const prefersRemote = this.isRemoteConfigured(options);

    if (prefersRemote) {
      try {
        const start = Date.now();
        const remoteResult = await this.requestRemoteRefactor(input, options);
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

    const fallback = this.localHeuristicRefactor(input, options);
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

  public async explainSelection(input: string, options: RefactorOptions): Promise<string> {
    if (!input.trim()) {
      throw new Error('Cannot explain an empty selection.');
    }

    this.output.appendLine('[GenRefactorer] Preparing selection explanation.');
    const prefersRemote = this.isRemoteConfigured(options);

    if (prefersRemote) {
      try {
        const explanation = await this.requestRemoteExplanation(input, options);
        return explanation;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.output.appendLine(`[GenRefactorer] Remote explanation failed: ${message}. Using heuristic summary.`);
      }
    }

    return this.localSelectionExplanation(input, options.languageId);
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

  private async requestRemoteExplanation(text: string, options: RefactorOptions): Promise<string> {
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
          mode: 'explain'
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backend responded with ${response.status}: ${response.statusText} ${errorText}`.trim());
      }

      const payload = (await response.json()) as Partial<{ explanation: string }>;
      if (!payload.explanation) {
        throw new Error('Backend response missing explanation text.');
      }

      return payload.explanation;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request to explanation service timed out.');
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private localHeuristicRefactor(text: string, options: RefactorOptions): RefactorResult {
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
      explanation: 'Local heuristic refactor applied (remote service unavailable).'
    };
  }

  private localSelectionExplanation(text: string, languageId?: string): string {
    const lines = text.split(/\r?\n/);
    const nonEmpty = lines.filter((line) => line.trim().length > 0);
    const metrics = {
      totalLines: lines.length,
      meaningfulLines: nonEmpty.length,
      functionCount: this.matchCount(text, /(function\s+\w+\s*\()|=>|def\s+\w+/g),
      classCount: this.matchCount(text, /class\s+\w+/g),
      branchCount: this.matchCount(text, /\b(if|else if|switch|case)\b/g),
      loopCount: this.matchCount(text, /\b(for|while|do\s+while|foreach)\b/g),
      commentLines: this.matchCount(text, /(^|\s)(\/\/|#)/g)
    };

    const highlights: string[] = [];
    if (metrics.functionCount > 0) {
      highlights.push(`Defines ${metrics.functionCount} function${metrics.functionCount > 1 ? 's' : ''}.`);
    }
    if (metrics.classCount > 0) {
      highlights.push(`Contains ${metrics.classCount} class${metrics.classCount > 1 ? 'es' : ''}.`);
    }
    if (metrics.branchCount > 0 || metrics.loopCount > 0) {
      highlights.push(
        `Control flow: ${metrics.branchCount} branch${metrics.branchCount === 1 ? '' : 'es'} and ${metrics.loopCount} loop${metrics.loopCount === 1 ? '' : 's'}.`
      );
    }
    if (metrics.commentLines > 0) {
      highlights.push(`Includes ${metrics.commentLines} inline comment${metrics.commentLines === 1 ? '' : 's'}.`);
    }
    if (languageId) {
      highlights.push(`Language hint: ${languageId}.`);
    }

    if (highlights.length === 0) {
      highlights.push('Primarily consists of literal or configuration values.');
    }

    return [
      'Selection Insight:',
      `• Lines (total/meaningful): ${metrics.totalLines}/${metrics.meaningfulLines}`,
      `• Functions: ${metrics.functionCount} | Classes: ${metrics.classCount}`,
      `• Branches: ${metrics.branchCount} | Loops: ${metrics.loopCount}`,
      ...highlights.map((note) => `• ${note}`)
    ].join('\n');
  }

  private matchCount(text: string, pattern: RegExp): number {
    const matches = text.match(pattern);
    return matches ? matches.length : 0;
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
