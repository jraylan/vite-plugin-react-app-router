/**
 * Builds throwaway `app/` directories on disk so the parser + code generator
 * can be exercised end to end. The parser reads the real filesystem (it looks
 * for `page`/`layout`/`not-found` files with the supported extensions), so a
 * fixture has to be real files — there is no in-memory mode to mock.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Every temp dir created in this process, removed by `cleanupAppDirs()`. */
const created: string[] = [];

const DEFAULT_CONTENT = 'export default function Component() { return null; }\n';

/**
 * Creates a temp app directory containing `files`.
 *
 * Entries are POSIX-ish relative paths (`'dashboard/not-found.tsx'`). Pass an
 * array for stub contents, or an object when a specific file body matters.
 */
export function createAppDir(files: string[] | Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vparr-app-'));
    created.push(root);

    const entries: Array<[string, string]> = Array.isArray(files)
        ? files.map((f) => [f, DEFAULT_CONTENT])
        : Object.entries(files);

    for (const [relative, content] of entries) {
        const full = path.join(root, ...relative.split('/'));
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content, 'utf8');
    }

    return root;
}

/** Removes every directory created by `createAppDir` in this process. */
export function cleanupAppDirs(): void {
    while (created.length > 0) {
        const dir = created.pop()!;
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch {
            // Best effort — a leftover temp dir must never fail a test run.
        }
    }
}
