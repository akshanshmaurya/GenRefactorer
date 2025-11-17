import { GoogleGenerativeAI } from '@google/generative-ai';
export class GeminiClient {
    constructor(options) {
        this.apiKey = options?.apiKey ?? process.env.GEMINI_API_KEY;
        this.modelName = options?.modelName ?? process.env.GEMINI_MODEL ?? 'gemini-1.5-pro';
        if (this.apiKey) {
            this.client = new GoogleGenerativeAI(this.apiKey);
        }
    }
    isConfigured() {
        return Boolean(this.client);
    }
    async summarizeFile(params) {
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
    async proposeFixComment(params) {
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
    async craftCommitMessage(context) {
        if (!this.client) {
            return this.fallbackCommit(context);
        }
        const prompt = `Write a short (<=60 char) git commit subject describing the assistant edits.${context.diagnosticsCount ? ` There were ${context.diagnosticsCount} diagnostics.` : ''}${context.summaryHint ? ` Latest summary: ${context.summaryHint}` : ''}`;
        const result = await this.runPrompt(prompt);
        if (!result) {
            return this.fallbackCommit(context);
        }
        return this.normalizeCommit(result);
    }
    async runPrompt(prompt) {
        if (!this.client) {
            return undefined;
        }
        try {
            const model = this.client.getGenerativeModel({ model: this.modelName });
            const response = await model.generateContent(prompt);
            const text = response.response.text?.();
            return text?.trim();
        }
        catch (error) {
            console.warn('[GeminiClient] Failed to run prompt:', error);
            return undefined;
        }
    }
    fallbackSummary(fileName, languageId) {
        return `Summary unavailable (Gemini not configured). File ${fileName}${languageId ? ` [${languageId}]` : ''}.`;
    }
    fallbackFixComment(params) {
        return `// Fix (${params.severity}): ${params.diagnosticMessage}`;
    }
    fallbackCommit(context) {
        if (context.summaryHint) {
            return context.summaryHint.slice(0, 50);
        }
        if (context.diagnosticsCount) {
            return `Address ${context.diagnosticsCount} diagnostics`;
        }
        return 'GenRefactorer updates';
    }
    normalizeFixComment(value) {
        const normalized = value.split(/\r?\n/)[0]?.trim() ?? '';
        if (!normalized.startsWith('//')) {
            return `// Fix: ${normalized}`;
        }
        return normalized;
    }
    normalizeCommit(value) {
        const line = value.split(/\r?\n/)[0]?.trim() ?? '';
        if (!line) {
            return 'GenRefactorer updates';
        }
        return line.slice(0, 60);
    }
}
