import { readdir, copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const srcDir = join(import.meta.dirname, '..', '..', 'FH6 Races - All Tracks, Types & Locations_files');
const outDir = join(import.meta.dirname, '..', 'public', 'images');
await mkdir(outDir, { recursive: true });

const files = (await readdir(srcDir)).filter((f) => /^Race.+\.webp$/.test(f));
for (const f of files) await copyFile(join(srcDir, f), join(outDir, f));
console.log(`copied ${files.length} images -> public/images/`);
