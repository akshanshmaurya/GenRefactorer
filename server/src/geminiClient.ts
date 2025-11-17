import { GoogleGenerativeAI, GenerateContentResult } from '@google/generative-ai';

export type ConversationTurn = {
  role: 'user' | 'model';
  content: string;
};

export class GeminiClient {
  private readonly apiKey?: string;
  private readonly modelName: string;
  private readonly client?: GoogleGenerativeAI;

  public constructor(options?: { apiKey?: string; modelName?: string }) {
    this.apiKey = options?.apiKey ?? process.env.GEMINI_API_KEY;
    this.modelName = options?.modelName ?? process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
    if (this.apiKey) {
      this.client = new GoogleGenerativeAI(this.apiKey);
    }
  }

  public isConfigured(): boolean {
    return Boolean(this.client);
  }

  public async summarizeFile(params: {
    fileName: string;
    languageId?: string;
    content: string;
  }): Promise<string> {
    if (!this.client) {
      return this.fallbackSummary(params.fileName, params.languageId);
    }

    const prompt = [
      'You are GenRefactorer MCP assistant. Summarize the provided source file in 3 concise bullet points.',
      `File: ${params.fileName}`,
      params.languageId ? `Language: ${params.languageId}` : undefined,
      '---',
      'SOURCE:',
      params.content.slice(0, 4000)
    ]
      .filter(Boolean)
      .join('\n');

    const result = await this.runPrompt(prompt);
    return result ?? this.fallbackSummary(params.fileName, params.languageId);
  }

  public async proposeFixComment(params: {
    diagnosticMessage: string;
    severity: string;
    fileName: string;
  }): Promise<string> {
    if (!this.client) {
      return this.fallbackFixComment(params);
    }

    const prompt = `Provide a single-line comment beginning with // Fix: that helps resolve the diagnostic "${params.diagnosticMessage}" (severity ${params.severity}) in ${params.fileName}.`;
    const result = await this.runPrompt(prompt);
    if (!result) {
      return this.fallbackFixComment(params);
    }

    return this.normalizeFixComment(result);
  }

  public async craftCommitMessage(context: {
    summaryHint?: string;
    diagnosticsCount?: number;
  }): Promise<string> {
    if (!this.client) {
      return this.fallbackCommit(context);
    }

    const prompt = `Write a short (<=60 char) git commit subject describing the assistant edits.${
      context.diagnosticsCount ? ` There were ${context.diagnosticsCount} diagnostics.` : ''
    }${context.summaryHint ? ` Latest summary: ${context.summaryHint}` : ''}`;
    const result = await this.runPrompt(prompt);
    if (!result) {
      return this.fallbackCommit(context);
    }
    return this.normalizeCommit(result);
  }

  public async chat(conversation: ConversationTurn[], userMessage: string): Promise<string> {
    if (!this.client) {
      return this.fallbackChat(userMessage);
    }

    try {
      const model = this.client.getGenerativeModel({ model: this.modelName });
      const chat = model.startChat({
        history: conversation.map((turn) => ({
          role: turn.role,
          parts: [{ text: turn.content }]
        }))
      });
      const response = await chat.sendMessage(userMessage);
      const text = response.response.text?.();
      return text?.trim() ?? this.fallbackChat(userMessage);
    } catch (error) {
      console.warn('[GeminiClient] Chat prompt failed:', error);
      return this.fallbackChat(userMessage);
    }
  }

  private async runPrompt(prompt: string): Promise<string | undefined> {
    if (!this.client) {
      return undefined;
    }
    try {
      const model = this.client.getGenerativeModel({ model: this.modelName });
      const response: GenerateContentResult = await model.generateContent(prompt);
      const text = response.response.text?.();
      return text?.trim();
    } catch (error) {
      console.warn('[GeminiClient] Failed to run prompt:', error);
      return undefined;
    }
  }

  private fallbackSummary(fileName: string, languageId?: string): string {
    return `Summary unavailable (Gemini not configured). File ${fileName}${languageId ? ` [${languageId}]` : ''}.`;
  }

  private fallbackFixComment(params: { diagnosticMessage: string; severity: string; fileName: string }): string {
    return `// Fix (${params.severity}): ${params.diagnosticMessage}`;
  }

  private fallbackCommit(context: { summaryHint?: string; diagnosticsCount?: number }): string {
    if (context.summaryHint) {
      return context.summaryHint.slice(0, 50);
    }
    if (context.diagnosticsCount) {
      return `Address ${context.diagnosticsCount} diagnostics`;
    }
    return 'GenRefactorer updates';
  }

  private normalizeFixComment(value: string): string {
    const normalized = value.split(/\r?\n/)[0]?.trim() ?? '';
    if (!normalized.startsWith('//')) {
      return `// Fix: ${normalized}`;
    }
    return normalized;
  }

  private normalizeCommit(value: string): string {
    const line = value.split(/\r?\n/)[0]?.trim() ?? '';
    if (!line) {
      return 'GenRefactorer updates';
    }
    return line.slice(0, 60);
  }

  private fallbackChat(input: string): string {
    return `Gemini unavailable. Received prompt: ${input.slice(0, 200)}`;
  }
}
