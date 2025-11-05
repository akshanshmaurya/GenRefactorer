import cors from 'cors';
import express, { Request, Response } from 'express';
import { performRefactor, RefactorStyle } from './refactorEngine.js';

const app = express();
const PORT = Number(process.env.PORT ?? 5050);

app.use(cors());
app.use(express.json({ limit: '512kb' }));

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'GenRefactorer-backend', timestamp: new Date().toISOString() });
});

app.post('/refactor', (req: Request, res: Response) => {
  try {
    const { code, languageId, style = 'balanced', includeDocumentation = true } = req.body ?? {};

    if (typeof code !== 'string' || code.trim().length === 0) {
      res.status(400).json({ error: 'Request body must include non-empty "code" string.' });
      return;
    }

    if (!isStyle(style)) {
      res.status(400).json({ error: 'Invalid refactor style supplied.' });
      return;
    }

    const output = performRefactor({
      code,
      languageId: typeof languageId === 'string' ? languageId : undefined,
      style,
      includeDocumentation: Boolean(includeDocumentation)
    });

    res.json({
      refactoredCode: output.refactoredCode,
      explanation: output.explanation
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

app.use((err: Error, _req: Request, res: Response, _next: () => void) => {
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[GenRefactorer-backend] Listening on http://localhost:${PORT}`);
});

function isStyle(value: unknown): value is RefactorStyle {
  return value === 'conservative' || value === 'balanced' || value === 'aggressive';
}
