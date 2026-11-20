import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = new URL('../', import.meta.url);
const app = new URL('../app/', import.meta.url);
const workspacePattern = /(?:Workspace|Cockpit|Board|Agenda|Preparation|Documents)\.tsx$/;

export async function auditEnterpriseWorkspaces() {
  const page = await readFile(new URL('app/page.tsx', root), 'utf8');
  const files = (await readdir(app, { withFileTypes: true }))
    .filter(entry => entry.isFile() && workspacePattern.test(entry.name))
    .map(entry => entry.name)
    .sort();

  const navStart = page.indexOf('const modules:');
  const navEnd = page.indexOf('const chain =', navStart);
  if (navStart < 0 || navEnd < navStart) throw new Error('Navigation registry not found');
  const lines = page.slice(navStart, navEnd).split('\n').map(line => line.replace(/\/\/.*$/, ''));
  const navigation = [...new Set(lines.flatMap(line => {
    const match = line.match(/\[\s*["']([^"']+)["']\s*,\s*[A-Z][\w]*\s*\]/);
    return match ? [match[1]] : [];
  }))];

  const imports = new Map([...page.matchAll(/^import\s+([A-Za-z][\w]*)(?:,\s*\{[^}]+\})?\s+from\s+["']\.\/([A-Za-z][\w]*)["'];/gm)]
    .map(match => [match[2] + '.tsx', match[1]]));

  const workspaces = await Promise.all(files.map(async file => {
    const alias = imports.get(file) ?? null;
    const workspace = await readFile(new URL(file, app), 'utf8');
    const usedInRoot = Boolean(alias && new RegExp('<' + alias + '(?:\\s|\\/|>)').test(page));
    return {
      file: 'app/' + file,
      rootImport: alias,
      mountedInRoot: usedInRoot,
      fluentRendered: /<Enterprise(?:Button|Input|Textarea|Checkbox|Dropdown|SearchField|SelectField|DataGrid|FilterBar|ObjectPage|PageHeader)\b/.test(workspace),
      objectPagePattern: /<EnterpriseObjectPage\b/.test(workspace),
      fluentGridPattern: /<EnterpriseDataGrid\b/.test(workspace),
      browserHomologated: false,
      stagingHomologated: false,
    };
  }));

  return {
    source: 'repository code, not production deployment',
    navigationEntries: navigation,
    totalNavigationEntries: navigation.length,
    totalWorkspaceFiles: workspaces.length,
    totalMountedInRoot: workspaces.filter(entry => entry.mountedInRoot).length,
    unmountedFiles: workspaces.filter(entry => !entry.mountedInRoot).map(entry => entry.file),
    workspaces,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await auditEnterpriseWorkspaces();
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (process.argv.includes('--strict') && report.unmountedFiles.length) process.exitCode = 1;
}
