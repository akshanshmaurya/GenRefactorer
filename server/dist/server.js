import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { performRefactor, performExplain } from './refactorEngine.js';
const app = express();
const PORT = Number(process.env.PORT ?? 5050);
app.use(cors());
app.use(express.json({ limit: '512kb' }));
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'GenRefactorer-backend', timestamp: new Date().toISOString() });
});
app.post('/refactor', async (req, res) => {
    try {
        const { code, languageId, style = 'balanced', includeDocumentation = true, mode = 'refactor' } = req.body ?? {};
        if (typeof code !== 'string' || code.trim().length === 0) {
            res.status(400).json({ error: 'Request body must include non-empty "code" string.' });
            return;
        }
        if (!isStyle(style)) {
            res.status(400).json({ error: 'Invalid refactor style supplied.' });
            return;
        }
        const normalizedLanguage = typeof languageId === 'string' ? languageId : undefined;
        if (mode === 'explain') {
            const explanation = await performExplain({
                code,
                languageId: normalizedLanguage,
                style,
                includeDocumentation: Boolean(includeDocumentation)
            });
            res.json({
                explanation: explanation.explanation
            });
            return;
        }
        const output = await performRefactor({
            code,
            languageId: normalizedLanguage,
            style,
            includeDocumentation: Boolean(includeDocumentation)
        });
        res.json({
            refactoredCode: output.refactoredCode,
            explanation: output.explanation
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: message });
    }
});
app.use((err, _req, res, _next) => {
    res.status(500).json({ error: err.message });
});
app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[GenRefactorer-backend] Listening on http://localhost:${PORT}`);
});
function isStyle(value) {
    return value === 'conservative' || value === 'balanced' || value === 'aggressive';
}
