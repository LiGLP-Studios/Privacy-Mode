// SHA-256 of every file in src/. The same files ship inside ClipHub (resources/app/src/main/ or app.asar),
// so anyone can compare: node scripts/checksums.mjs [path to the installed app's src/main folder]
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const other = process.argv[2];
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

let same = true;
for (const file of readdirSync(here).filter((f) => f.endsWith('.js')).sort()) {
  const mine = hash(join(here, file));
  if (!other) { console.log(`${mine}  ${file}`); continue; }
  const path = join(other, file);
  const theirs = existsSync(path) ? hash(path) : 'missing';
  const ok = theirs === mine;
  same &&= ok;
  console.log(`${ok ? 'same     ' : 'DIFFERENT'}  ${file}`);
}
if (other) process.exit(same ? 0 : 1);
