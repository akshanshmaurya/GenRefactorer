import { tryLLMRefactor, tryLLMExplain } from './llmClient.js';
export async function performRefactor(input) {
    const llmResult = await tryLLMRefactor(input);
    if (llmResult) {
        return llmResult;
    }
    return performHeuristicRefactor(input);
}
export async function performExplain(input) {
    const llmResult = await tryLLMExplain(input);
    if (llmResult) {
        return { explanation: llmResult };
    }
    return { explanation: generateHeuristicExplanation(input.code, input.languageId) };
}
export function performHeuristicRefactor({ code, languageId, style, includeDocumentation }) {
    let working = normalizeLineEndings(code);
    const notes = [];
    if (includeDocumentation) {
        const docAdded = maybePrependInlineBanner(working, style);
        if (docAdded.changed) {
            working = docAdded.code;
            notes.push('Added inline banner comment to reflect automated refactor.');
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
function normalizeLineEndings(text) {
    return text.replace(/\r\n?/g, '\n');
}
function normalizeWhitespace(text) {
    const lines = text.split('\n');
    const processed = lines.map((line) => line.replace(/\s+$/g, '')).join('\n');
    const untabbed = processed.replace(/\t/g, '  ');
    return { code: untabbed.trimEnd() + '\n' };
}
function maybePrependInlineBanner(code, style) {
    if (code.trimStart().startsWith('//')) {
        return { changed: false, code };
    }
    const banner = `// Auto-refactored (${style})`;
    return { changed: true, code: `${banner}\n${code}` };
}
function modernizeJavaScript(code, style) {
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
function polishJava(code, style) {
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
function tightenSpacing(code) {
    const condensed = code.replace(/\n{3,}/g, '\n\n');
    return condensed === code ? undefined : condensed;
}
function generateHeuristicExplanation(code, languageId) {
    const lines = code.split(/\r?\n/);
    const nonEmpty = lines.filter((line) => line.trim().length > 0);
    const metrics = {
        totalLines: lines.length,
        meaningfulLines: nonEmpty.length,
        functionCount: countMatches(code, /(function\s+\w+\s*\()|=>|def\s+\w+/g),
        classCount: countMatches(code, /class\s+\w+/g),
        branchCount: countMatches(code, /\b(if|else if|switch|case)\b/g),
        loopCount: countMatches(code, /\b(for|while|do\s+while|foreach)\b/g),
        commentLines: countMatches(code, /(^|\s)(\/\/|#)/g)
    };
    const highlights = [];
    if (metrics.functionCount > 0) {
        highlights.push(`Defines ${metrics.functionCount} function${metrics.functionCount > 1 ? 's' : ''}.`);
    }
    if (metrics.classCount > 0) {
        highlights.push(`Contains ${metrics.classCount} class${metrics.classCount > 1 ? 'es' : ''}.`);
    }
    if (metrics.branchCount > 0 || metrics.loopCount > 0) {
        highlights.push(`Control flow: ${metrics.branchCount} branch${metrics.branchCount === 1 ? '' : 'es'} and ${metrics.loopCount} loop${metrics.loopCount === 1 ? '' : 's'}.`);
    }
    if (metrics.commentLines > 0) {
        highlights.push(`Includes ${metrics.commentLines} inline comment${metrics.commentLines === 1 ? '' : 's'}.`);
    }
    if (languageId) {
        highlights.push(`Language hint: ${languageId}.`);
    }
    if (highlights.length === 0) {
        highlights.push('Primarily consists of literal or configuration data.');
    }
    return [
        'Selection Insight:',
        `• Lines (total/meaningful): ${metrics.totalLines}/${metrics.meaningfulLines}`,
        `• Functions: ${metrics.functionCount} | Classes: ${metrics.classCount}`,
        `• Branches: ${metrics.branchCount} | Loops: ${metrics.loopCount}`,
        ...highlights.map((note) => `• ${note}`)
    ].join('\n');
}
function countMatches(text, pattern) {
    const matches = text.match(pattern);
    return matches ? matches.length : 0;
}
