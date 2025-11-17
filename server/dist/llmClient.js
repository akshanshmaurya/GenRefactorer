import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
const provider = resolveProvider(process.env.LLM_PROVIDER);
const openaiConfig = {
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL,
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini'
};
const geminiConfig = {
    apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY,
    model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'
};
let openaiClient;
let geminiClient;
const warnedMissingKey = {
    openai: false,
    gemini: false
};
if (provider === 'openai' && openaiConfig.apiKey) {
    openaiClient = new OpenAI({
        apiKey: openaiConfig.apiKey,
        baseURL: openaiConfig.baseUrl && openaiConfig.baseUrl.trim().length > 0 ? openaiConfig.baseUrl : undefined
    });
}
if (provider === 'gemini' && geminiConfig.apiKey) {
    geminiClient = new GoogleGenerativeAI(geminiConfig.apiKey);
}
const STYLE_TEMPERATURE = {
    conservative: 0.1,
    balanced: 0.3,
    aggressive: 0.5
};
const STYLE_GUIDANCE = {
    conservative: 'Make minimal, safe improvements that enhance clarity without changing public APIs.',
    balanced: 'Focus on clarity, modern idioms, and small performance wins while preserving behavior.',
    aggressive: 'Apply bold refactors that improve performance and maintainability, even if structure changes significantly.'
};
export async function tryLLMRefactor(input) {
    if (provider === 'openai') {
        return callOpenAI(input);
    }
    if (provider === 'gemini') {
        return callGemini(input);
    }
    return null;
}
export async function tryLLMExplain(input) {
    if (provider === 'openai') {
        return callOpenAIExplain(input);
    }
    if (provider === 'gemini') {
        return callGeminiExplain(input);
    }
    return null;
}
async function callOpenAI(input) {
    if (!openaiClient) {
        emitMissingKeyWarning('openai', 'OPENAI_API_KEY');
        return null;
    }
    try {
        const response = await openaiClient.chat.completions.create({
            model: openaiConfig.model,
            temperature: STYLE_TEMPERATURE[input.style],
            response_format: { type: 'json_object' },
            messages: buildMessages(input)
        });
        const messageContent = response.choices?.[0]?.message?.content;
        if (!messageContent) {
            return null;
        }
        const parsed = parseJsonResponse(messageContent);
        if (!parsed || !parsed.refactoredCode) {
            return null;
        }
        return {
            refactoredCode: parsed.refactoredCode,
            explanation: parsed.explanation ?? 'Refactor completed via OpenAI model.'
        };
    }
    catch (error) {
        reportProviderError('OpenAI', error);
        return null;
    }
}
async function callGemini(input) {
    if (!geminiClient) {
        emitMissingKeyWarning('gemini', 'GEMINI_API_KEY');
        return null;
    }
    try {
        const model = geminiClient.getGenerativeModel({ model: geminiConfig.model });
        const result = await model.generateContent({
            contents: [
                {
                    role: 'user',
                    parts: [{ text: buildGeminiPrompt(input) }]
                }
            ],
            generationConfig: {
                temperature: STYLE_TEMPERATURE[input.style]
            }
        });
        const responseText = result.response?.text?.() ?? result.response?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!responseText) {
            return null;
        }
        const parsed = parseJsonResponse(responseText);
        if (!parsed || !parsed.refactoredCode) {
            return null;
        }
        return {
            refactoredCode: parsed.refactoredCode,
            explanation: parsed.explanation ?? 'Refactor completed via Gemini model.'
        };
    }
    catch (error) {
        reportProviderError('Gemini', error);
        return null;
    }
}
async function callOpenAIExplain(input) {
    if (!openaiClient) {
        emitMissingKeyWarning('openai', 'OPENAI_API_KEY');
        return null;
    }
    try {
        const response = await openaiClient.chat.completions.create({
            model: openaiConfig.model,
            temperature: 0.2,
            response_format: { type: 'json_object' },
            messages: buildExplainMessages(input)
        });
        const messageContent = response.choices?.[0]?.message?.content;
        if (!messageContent) {
            return null;
        }
        const parsed = parseJsonResponse(messageContent);
        if (!parsed || !parsed.explanation) {
            return null;
        }
        return parsed.explanation;
    }
    catch (error) {
        reportProviderError('OpenAI', error);
        return null;
    }
}
async function callGeminiExplain(input) {
    if (!geminiClient) {
        emitMissingKeyWarning('gemini', 'GEMINI_API_KEY');
        return null;
    }
    try {
        const model = geminiClient.getGenerativeModel({ model: geminiConfig.model });
        const result = await model.generateContent({
            contents: [
                {
                    role: 'user',
                    parts: [{ text: buildGeminiExplainPrompt(input) }]
                }
            ],
            generationConfig: {
                temperature: 0.2
            }
        });
        const responseText = result.response?.text?.() ?? result.response?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!responseText) {
            return null;
        }
        const parsed = parseJsonResponse(responseText);
        if (!parsed || !parsed.explanation) {
            return null;
        }
        return parsed.explanation;
    }
    catch (error) {
        reportProviderError('Gemini', error);
        return null;
    }
}
function buildMessages(input) {
    return [
        {
            role: 'system',
            content: 'You are GenRefactorer, an expert software refactoring assistant. Return strictly valid JSON with keys "refactoredCode" (string) and "explanation" (string). Maintain functional behavior, improve maintainability, and follow the requested style. Explain notable changes succinctly.'
        },
        {
            role: 'user',
            content: JSON.stringify(buildPayload(input), null, 2)
        }
    ];
}
function buildPayload(input) {
    return {
        instructions: STYLE_GUIDANCE[input.style],
        includeDocumentation: input.includeDocumentation,
        languageId: input.languageId ?? 'plain',
        code: input.code
    };
}
function buildGeminiPrompt(input) {
    return [
        'You are GenRefactorer, an expert software refactoring assistant.',
        'Return strictly valid JSON with properties "refactoredCode" (string) and "explanation" (string).',
        'Maintain functional behavior, improve maintainability, and follow the requested style.',
        'Explain notable refactor steps succinctly.',
        '',
        JSON.stringify(buildPayload(input), null, 2)
    ].join('\n');
}
function buildExplainMessages(input) {
    return [
        {
            role: 'system',
            content: 'You are GenRefactorer, an expert software explainer. Return strictly valid JSON with key "explanation" (string). Summarize the selected code succinctly, touching on structure, flow, and intent.'
        },
        {
            role: 'user',
            content: JSON.stringify({
                languageId: input.languageId ?? 'plain',
                code: input.code,
                focus: 'Summarize what this code block is doing and highlight notable branches, loops, or side effects.'
            }, null, 2)
        }
    ];
}
function buildGeminiExplainPrompt(input) {
    return [
        'You are GenRefactorer, an expert software explainer.',
        'Return strictly valid JSON with property "explanation" (string).',
        'Explain the intent of the provided code, covering data flow, branching, and any noteworthy side effects.',
        '',
        JSON.stringify({
            languageId: input.languageId ?? 'plain',
            code: input.code
        }, null, 2)
    ].join('\n');
}
function parseJsonResponse(raw) {
    const trimmed = raw.trim();
    const fenceMatch = trimmed.match(/```[a-zA-Z]*\s*([\s\S]*?)```/);
    const jsonText = fenceMatch ? fenceMatch[1].trim() : trimmed;
    try {
        return JSON.parse(jsonText);
    }
    catch (error) {
        reportProviderError('Parser', error);
        return null;
    }
}
function emitMissingKeyWarning(providerName, envKey) {
    if (!warnedMissingKey[providerName]) {
        warnedMissingKey[providerName] = true;
        // eslint-disable-next-line no-console
        console.warn(`[GenRefactorer-backend] ${envKey} not set. Falling back to heuristic refactor.`);
    }
}
function reportProviderError(label, error) {
    const description = error instanceof Error ? error.message : String(error);
    // eslint-disable-next-line no-console
    console.error(`[GenRefactorer-backend] ${label} refactor failed: ${description}`);
}
function resolveProvider(raw) {
    const normalized = (raw ?? 'openai').trim().toLowerCase();
    if (normalized === 'gemini') {
        return 'gemini';
    }
    return 'openai';
}
