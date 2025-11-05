export type RefactorStyle = 'conservative' | 'balanced' | 'aggressive';

export interface RefactorInput {
  code: string;
  languageId?: string;
  style: RefactorStyle;
  includeDocumentation: boolean;
}

export interface RefactorOutput {
  refactoredCode: string;
  explanation: string;
}

export function performRefactor({ code, languageId, style, includeDocumentation }: RefactorInput): RefactorOutput {
  let working = normalizeLineEndings(code);
  const notes: string[] = [];

  if (includeDocumentation) {
    const docAdded = maybePrependDocblock(working, style);
    if (docAdded.changed) {
      working = docAdded.code;
      notes.push('Added documentation banner to reflect automated refactor.');
    }
  }

  const whitespace = normalizeWhitespace(working);
  if (whitespace.code !== working) {
    working = whitespace.code;
    notes.push('Trimmed trailing whitespace and normalized indentation.');
  }

  if (languageId && ['javascript', 'typescript', 'javascriptreact', 'typescriptreact'].includes(languageId)) {
    const js = modernizeJavaScript(working, style);
    if (js.changedEquality) {
      notes.push('Promoted loose equality checks to strict comparisons.');
    }
    if (js.changedVarOrFunction) {
      notes.push('Replaced legacy function/var declarations with block-scoped alternatives.');
    }
    working = js.code;
  }

  if (languageId === 'java') {
    const java = polishJava(working, style);
    if (java.importSorted) {
      notes.push('Sorted and deduplicated import statements.');
    }
    if (java.inlineCommentsUpdated) {
      notes.push('Clarified inline comments for readability.');
    }
    working = java.code;
  }

  if (style === 'aggressive') {
    const aggressive = tightenSpacing(working);
    if (aggressive) {
      working = aggressive;
      notes.push('Condensed redundant blank lines for compact layout.');
    }
  }

  if (notes.length === 0) {
    notes.push('No structural changes were necessary; formatting touch-up applied.');
  }

  return {
    refactoredCode: working,
    explanation: notes.map((note, index) => `${index + 1}. ${note}`).join('\n')
  };
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

function normalizeWhitespace(text: string): { code: string } {
  const lines = text.split('\n');
  const processed = lines.map((line) => line.replace(/\s+$/g, '')).join('\n');
  const untabbed = processed.replace(/\t/g, '  ');
  return { code: untabbed.trimEnd() + '\n' };
}

function maybePrependDocblock(code: string, style: RefactorStyle): { changed: boolean; code: string } {
  if (code.trimStart().startsWith('/**')) {
    return { changed: false, code };
  }

  const banner = ['/**', ` * Auto-refactored (${style})`, ' */'];
  return { changed: true, code: `${banner.join('\n')}\n${code}` };
}

function modernizeJavaScript(code: string, style: RefactorStyle): {
  code: string;
  changedEquality: boolean;
  changedVarOrFunction: boolean;
} {
  let updated = code;
  let changedEquality = false;
  let changedVarOrFunction = false;

  const equality = updated.replace(/==(?!=)/g, '===');
  if (equality !== updated) {
    changedEquality = true;
    updated = equality;
  }

  const varRegex = /\bvar\b/g;
  if (varRegex.test(updated)) {
    updated = updated.replace(varRegex, style === 'conservative' ? 'let' : 'const');
    changedVarOrFunction = true;
  }

  const functionRegex = /function\s+(\w+)\s*\(/g;
  if (functionRegex.test(updated) && style !== 'conservative') {
    updated = updated.replace(functionRegex, 'const $1 = (');
    changedVarOrFunction = true;
  }

  return { code: updated, changedEquality, changedVarOrFunction };
}

function polishJava(code: string, style: RefactorStyle): {
  code: string;
  importSorted: boolean;
  inlineCommentsUpdated: boolean;
} {
  let updated = code;
  let importSorted = false;
  let inlineCommentsUpdated = false;

  const lines = updated.split('\n');
  const importLines = lines.filter((line) => line.trim().startsWith('import '));
  if (importLines.length > 1) {
    const unique = Array.from(new Set(importLines.map((line) => line.trim())));
    const sorted = unique.sort((a, b) => a.localeCompare(b, 'en'));
    const remaining = lines.filter((line) => !line.trim().startsWith('import '));
    updated = `${sorted.join('\n')}\n${remaining.join('\n').trimStart()}`;
    importSorted = true;
  }

  if (style !== 'conservative') {
    const replaced = updated.replace(/\/\/\s*Create a new Scanner object/gi, '// Read input from the user');
    if (replaced !== updated) {
      updated = replaced;
      inlineCommentsUpdated = true;
    }
  }

  updated = updated.replace(/class\s+(\w+)\{/g, 'class $1 {');
  updated = updated.replace(/\)\{/g, ') {');

  return { code: updated, importSorted, inlineCommentsUpdated };
}

function tightenSpacing(code: string): string | undefined {
  const condensed = code.replace(/\n{3,}/g, '\n\n');
  return condensed === code ? undefined : condensed;
}
