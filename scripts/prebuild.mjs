#!/usr/bin/env node
/**
 * copy virtual-module.d.ts to dist:
 */

import fs from 'node:fs';
import path from 'node:path';

function main() {
    try{
        fs.mkdirSync('dist')
    } catch(err){
        console.warn(`unable to make "dist" dir: ${err.message}`)
    }
    fs.copyFileSync(
        path.join("src", 'virtual-module.d.ts'),
        path.join("dist", 'virtual-module.d.ts')
    )
}

try {
    main();
} catch (err) {
    console.warn(`unexpected error during postbuild: ${err.message}`);
}
