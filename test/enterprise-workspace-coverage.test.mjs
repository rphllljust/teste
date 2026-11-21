import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const app = new URL('../app/', import.meta.url);
const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const layout = await readFile(new URL('../app/layout.tsx', import.meta.url), 'utf8');
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('every workspace composed by the application shell consumes the shared Fluent controls', async () => {
  const imports = [...page.matchAll(/from ["']\.\/([A-Za-z][\w]*)["']/g)].map(match => match[1]);
  const workspaceFiles = [...new Set(imports)].filter(name => /Workspace|Cockpit|Board|Agenda|Preparation|Documents/.test(name));
  assert.ok(workspaceFiles.length >= 20, `expected the known workspace fleet, found ${workspaceFiles.length}`);
  for (const name of workspaceFiles) {
    const source = await readFile(new URL(`${name}.tsx`, app), 'utf8');
    assert.match(source, /Enterprise(?:Button|Input|Textarea|Checkbox|Dropdown|SearchField|SelectField|DataGrid|FilterBar|ObjectPage|PageHeader)/, name);
  }
});

test('shared visual runtime is globally provided and Fluent UI versions match React 19', async () => {
  const provider = await readFile(new URL('../app/components/enterprise/EnterpriseUiProvider.tsx', import.meta.url), 'utf8');
  assert.match(layout, /<EnterpriseUiProvider>\{children\}<\/EnterpriseUiProvider>/);
  assert.match(provider, /<FluentProvider theme=\{cisneFluentTheme\}>/);
  assert.match(provider, /useServerInsertedHTML/);
  assert.match(provider, /didRender\.current/);
  assert.equal(packageJson.dependencies['@fluentui/react-components'], '9.75.2');
  assert.equal(packageJson.dependencies['@fluentui/react-icons'], '2.0.347');
});

test('workspace source no longer owns native action buttons', async () => {
  const files = await readdir(app, { withFileTypes: true });
  for (const entry of files.filter(item => item.isFile() && item.name.endsWith('.tsx') && item.name !== 'EnterprisePrimitives.tsx')) {
    const source = await readFile(new URL(entry.name, app), 'utf8');
    assert.doesNotMatch(source, /<button\b/, entry.name);
  }
});

test('dropdown consumers do not fabricate HTML select change events', async () => {
  const files = await readdir(app, { withFileTypes: true });
  for (const file of files.filter(item => item.isFile() && item.name.endsWith('.tsx'))) {
    const source = await readFile(new URL(file.name, app), 'utf8');
    let offset = 0;
    while (true) {
      const start = source.indexOf('<EnterpriseDropdown', offset);
      if (start < 0) break;
      let depth = 0;
      let quote = '';
      let end = -1;
      for (let i = start; i < source.length; i++) {
        const char = source[i];
        if (quote) {
          if (char === '\\') { i++; continue; }
          if (char === quote) quote = '';
        } else if (char === '"' || char === "'" || char === '`') {
          quote = char;
        } else if (char === '{') {
          depth++;
        } else if (char === '}') {
          depth--;
        } else if (char === '>' && depth === 0) {
          end = i + 1;
          break;
        }
      }
      assert.ok(end > start, 'unclosed EnterpriseDropdown in ' + file.name);
      assert.doesNotMatch(source.slice(start, end), /\bonChange\s*=/, file.name);
      offset = end;
    }
  }
});
