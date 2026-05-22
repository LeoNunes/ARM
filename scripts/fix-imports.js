#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(__dirname, '..', 'dist', 'be');

function walk(d) {
  fs.readdirSync(d).forEach(f => {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) {
      walk(p);
    } else if (f.endsWith('.js')) {
      let c = fs.readFileSync(p, 'utf8');
      // Fix all relative imports that don't end with .js
      c = c.replace(/from ['"](\.[^'"]*?)(['"])/g, (match, importPath, quote) => {
        if (!importPath.endsWith('.js')) {
          return `from '${importPath}.js'`;
        }
        return match;
      });
      fs.writeFileSync(p, c);
    }
  });
}

if (fs.existsSync(dir)) {
  walk(dir);
}
