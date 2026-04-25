#!/usr/bin/env node
/**
 * Auto-configures the consumer project on install:
 *   1. Adds "vite-plugin-react-app-router/types" to compilerOptions.types in
 *      tsconfig.app.json (preferred) or tsconfig.json.
 *   2. Prepends /// <reference types="vite-plugin-react-app-router/types" />
 *      to src/vite-env.d.ts (preferred) or vite-env.d.ts.
 *
 * The script is idempotent and best-effort: any failure is logged as a warning
 * but never breaks the install.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_NAME = 'vite-plugin-react-app-router';
const TYPES_ENTRY = `${PACKAGE_NAME}/types`;
const REFERENCE_LINE = `/// <reference types="${PACKAGE_NAME}/types" />`;
const LOG_PREFIX = `[${PACKAGE_NAME}]`;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(__dirname, '..');

function warn(msg) {
    console.warn(`${LOG_PREFIX} ${msg}`);
}

function info(msg) {
    console.log(`${LOG_PREFIX} ${msg}`);
}

// Filesystem paths on Windows are case-insensitive — fold to lowercase before
// comparing so things like "E:\foo" and "e:\foo" match.
const isWindows = process.platform === 'win32';
function normalizePath(p) {
    return isWindows ? p.toLowerCase() : p;
}

function resolveProjectRoot() {
    const initCwd = process.env.INIT_CWD || process.cwd();
    if (!initCwd) return null;

    const resolved = path.resolve(initCwd);
    const resolvedKey = normalizePath(resolved);
    const packageDirKey = normalizePath(packageDir);

    // Skip when this package itself is the install target (developing the plugin).
    if (resolvedKey === packageDirKey) return null;
    // Skip when running inside this package's own node_modules (nested install).
    if (resolvedKey.startsWith(packageDirKey + path.sep)) return null;
    if (!fs.existsSync(resolved)) return null;

    return resolved;
}

/**
 * Returns the index of the closing character that matches the opening character
 * at `openIdx`. Skips over JSON strings, line comments, and block comments
 * (JSONC). Returns -1 if no match is found.
 */
function findMatching(text, openIdx, openChar, closeChar) {
    let depth = 1;
    let i = openIdx + 1;
    while (i < text.length) {
        const c = text[i];
        const next = text[i + 1];

        if (c === '/' && next === '/') {
            const nl = text.indexOf('\n', i);
            i = nl === -1 ? text.length : nl + 1;
            continue;
        }
        if (c === '/' && next === '*') {
            const end = text.indexOf('*/', i + 2);
            i = end === -1 ? text.length : end + 2;
            continue;
        }
        if (c === '"') {
            i++;
            while (i < text.length && text[i] !== '"') {
                if (text[i] === '\\') i++;
                i++;
            }
            i++;
            continue;
        }
        if (c === openChar) {
            depth++;
        } else if (c === closeChar) {
            depth--;
            if (depth === 0) return i;
        }
        i++;
    }
    return -1;
}

function detectIndent(content, fallback = '  ') {
    const match = content.match(/\n([ \t]+)\S/);
    return match ? match[1] : fallback;
}

function detectEol(content) {
    return content.includes('\r\n') ? '\r\n' : '\n';
}

function ensureTypesInTsConfig(filePath) {
    const original = fs.readFileSync(filePath, 'utf8');

    // Already configured — nothing to do.
    if (original.includes(TYPES_ENTRY)) return false;

    const eol = detectEol(original);
    const indent = detectIndent(original);

    const compilerOptionsRe = /"compilerOptions"\s*:\s*\{/g;
    const compilerOptionsMatch = compilerOptionsRe.exec(original);
    if (!compilerOptionsMatch) {
        warn(`could not find "compilerOptions" block in ${filePath}; skipping.`);
        return false;
    }

    const compilerOpenIdx = compilerOptionsMatch.index + compilerOptionsMatch[0].length - 1;
    const compilerCloseIdx = findMatching(original, compilerOpenIdx, '{', '}');
    if (compilerCloseIdx === -1) {
        warn(`malformed "compilerOptions" block in ${filePath}; skipping.`);
        return false;
    }

    const compilerBody = original.slice(compilerOpenIdx + 1, compilerCloseIdx);
    const typesPropRe = /"types"\s*:\s*\[/g;
    const typesMatch = typesPropRe.exec(compilerBody);

    let updated;

    if (typesMatch) {
        // Existing types array — append our entry.
        const arrOpenLocal = typesMatch.index + typesMatch[0].length - 1;
        const arrOpenAbs = compilerOpenIdx + 1 + arrOpenLocal;
        const arrCloseAbs = findMatching(original, arrOpenAbs, '[', ']');
        if (arrCloseAbs === -1) {
            warn(`malformed "types" array in ${filePath}; skipping.`);
            return false;
        }

        const inside = original.slice(arrOpenAbs + 1, arrCloseAbs);
        const trimmed = inside.trim();

        if (trimmed === '') {
            updated =
                original.slice(0, arrOpenAbs + 1) +
                `"${TYPES_ENTRY}"` +
                original.slice(arrCloseAbs);
        } else {
            // Walk back from the closing bracket to find the last non-whitespace
            // character — this lets us insert after the final entry while
            // preserving the existing formatting around it.
            let tailIdx = arrCloseAbs - 1;
            while (tailIdx > arrOpenAbs && /\s/.test(original[tailIdx])) tailIdx--;
            const hasTrailingComma = original[tailIdx] === ',';
            const insertAfter = hasTrailingComma ? tailIdx + 1 : tailIdx + 1;

            // If the array is multi-line, mirror the indentation of the last
            // entry line for the new entry; otherwise, inline it.
            const lastLineStart = original.lastIndexOf('\n', tailIdx);
            const isMultiline = lastLineStart > arrOpenAbs;
            let insertion;
            if (isMultiline) {
                const lineIndentMatch = original
                    .slice(lastLineStart + 1, tailIdx + 1)
                    .match(/^[ \t]*/);
                const lineIndent = lineIndentMatch ? lineIndentMatch[0] : indent;
                const prefix = hasTrailingComma ? '' : ',';
                insertion = `${prefix}${eol}${lineIndent}"${TYPES_ENTRY}"`;
            } else {
                const prefix = hasTrailingComma ? ' ' : ', ';
                insertion = `${prefix}"${TYPES_ENTRY}"`;
            }

            updated =
                original.slice(0, insertAfter) +
                insertion +
                original.slice(insertAfter);
        }
    } else {
        // No "types" property — insert it as the first key inside compilerOptions.
        const insertAt = compilerOpenIdx + 1;
        const newProp = `${eol}${indent}${indent}"types": ["${TYPES_ENTRY}"],`;
        updated =
            original.slice(0, insertAt) +
            newProp +
            original.slice(insertAt);
    }

    if (!updated || updated === original) return false;

    fs.writeFileSync(filePath, updated, 'utf8');
    return true;
}

function ensureViteEnvReference(filePath) {
    const original = fs.readFileSync(filePath, 'utf8');
    if (original.includes(REFERENCE_LINE)) return false;

    const eol = detectEol(original);
    const updated = REFERENCE_LINE + eol + original;
    fs.writeFileSync(filePath, updated, 'utf8');
    return true;
}

function firstExisting(projectRoot, candidates) {
    for (const rel of candidates) {
        const full = path.join(projectRoot, rel);
        if (fs.existsSync(full)) return full;
    }
    return null;
}

function main() {
    const projectRoot = resolveProjectRoot();
    if (!projectRoot) return;

    const tsconfigPath = firstExisting(projectRoot, [
        'tsconfig.app.json',
        'tsconfig.json',
    ]);
    const viteEnvPath = firstExisting(projectRoot, [
        'src/vite-env.d.ts',
        'vite-env.d.ts',
    ]);

    if (tsconfigPath) {
        try {
            if (ensureTypesInTsConfig(tsconfigPath)) {
                info(`added "${TYPES_ENTRY}" to ${path.relative(projectRoot, tsconfigPath)}`);
            }
        } catch (err) {
            warn(`failed to update ${path.relative(projectRoot, tsconfigPath)}: ${err.message}`);
        }
    }

    if (viteEnvPath) {
        try {
            if (ensureViteEnvReference(viteEnvPath)) {
                info(`added reference directive to ${path.relative(projectRoot, viteEnvPath)}`);
            }
        } catch (err) {
            warn(`failed to update ${path.relative(projectRoot, viteEnvPath)}: ${err.message}`);
        }
    }
}

try {
    main();
} catch (err) {
    warn(`unexpected error during postinstall: ${err.message}`);
}
