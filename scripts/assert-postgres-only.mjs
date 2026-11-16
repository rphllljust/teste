import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const FILES = ['app', 'db', 'lib', 'build'];
const forbidden = [
  /\bD1Database\b/,
  /drizzle-orm\/d1/,
  /\bd1_databases\b/,
  /\benv\.DB\b/,
];
const failures = [];

async function inspect(file) {
  const content = await readFile(file, 'utf8');
  for (const check of forbidden) {
    if (check.test(content)) failures.push(`${relative(ROOT, file)}: ${check.source}`);
  }
  const sourcePath = relative(ROOT, file).replaceAll('\\', '/');
  if (/^(db|app\/api|lib\/api)\//.test(sourcePath) && /cloudflare:workers/.test(content)) {
    failures.push(`${sourcePath}: database/API runtime imports Cloudflare Workers`);
  }
}
async function visit(folder) {
  const entries = await readdir(folder, { withFileTypes: true });
  for (const entry of entries) {
    const child = join(folder, entry.name);
    if (entry.isDirectory()) { await visit(child); continue; }
    if (!entry.isFile() || !/\.(ts|tsx|js|mjs|mts)$/.test(entry.name)) continue;
    await inspect(child);
  }
}
for (const folder of FILES) await visit(join(ROOT, folder));

const hosting = JSON.parse(await readFile(join(ROOT, '.openai/hosting.json'), 'utf8'));
if (Object.hasOwn(hosting, 'd1')) failures.push('.openai/hosting.json retains a D1 binding');
const schema = await readFile(join(ROOT, 'db/schema.ts'), 'utf8');
const config = await readFile(join(ROOT, 'drizzle.config.ts'), 'utf8');
const raw = await readFile(join(ROOT, 'db/raw.ts'), 'utf8');
const entry = await readFile(join(ROOT, 'db/index.ts'), 'utf8');
if (!schema.includes("from 'drizzle-orm/pg-core'")) failures.push('PostgreSQL table definitions missing');
if (!config.includes('dialect: "postgresql"')) failures.push('PostgreSQL drizzle dialect missing');
if (!raw.includes("from 'pg'")) failures.push('PostgreSQL raw adapter missing');
if (!entry.includes('drizzle-orm/node-postgres')) failures.push('PostgreSQL Drizzle entrypoint missing');
if (failures.length) {
  console.error('PostgreSQL-only gate failed:\n' + failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log('PostgreSQL-only gate: no Cloudflare D1 persistence references found in runtime source.');
}
