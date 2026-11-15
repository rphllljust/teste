/** Translate the D1 subset used by CISNE while ignoring quoted SQL and comments. */
export function normalizeSql(sql, previousChanges, parameterCount) {
  let output = '';
  let placeholders = 0;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i], next = sql[i + 1];
    if (ch === "'") {
      const start = i++;
      while (i < sql.length) {
        if (sql[i] === "\\") { i += 2; continue; }
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i++] === "'") break;
      }
      output += sql.slice(start, i); continue;
    }
    if (ch === '"') {
      const start = i++;
      while (i < sql.length) {
        if (sql[i] === '"' && sql[i + 1] === '"') { i += 2; continue; }
        if (sql[i++] === '"') break;
      }
      output += sql.slice(start, i); continue;
    }
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i + 2); const stop = end < 0 ? sql.length : end;
      output += sql.slice(i, stop); i = stop; continue;
    }
    if (ch === '/' && next === '*') {
      const start = i; i += 2; let depth = 1;
      while (i < sql.length && depth) {
        if (sql[i] === '/' && sql[i + 1] === '*') { depth++; i += 2; }
        else if (sql[i] === '*' && sql[i + 1] === '/') { depth--; i += 2; }
        else i++;
      }
      output += sql.slice(start, i); continue;
    }
    if (ch === '$') {
      const tag = sql.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (tag) { const end = sql.indexOf(tag, i + tag.length); const stop = end < 0 ? sql.length : end + tag.length; output += sql.slice(i, stop); i = stop; continue; }
    }
    if (sql.slice(i, i + 9).toLowerCase() === 'changes()') {
      if (previousChanges === undefined) throw new Error('D1 changes() is only supported inside a transactional batch');
      output += previousChanges === 1 ? '1' : '0'; i += 9; continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const identifier = sql.slice(i).match(/^[A-Za-z_][A-Za-z0-9_$]*/)[0];
      if (identifier.toLowerCase() === 'instr' && /^\s*\(/.test(sql.slice(i + identifier.length))) throw new Error('SQLite instr() is unsupported; rewrite this query with PostgreSQL POSITION()');
      output += identifier; i += identifier.length; continue;
    }
    if (ch === '?') { output += `$${++placeholders}`; i++; continue; }
    output += ch; i++;
  }
  if (parameterCount !== undefined && placeholders !== parameterCount) {
    throw new Error(`SQL parameter count mismatch: expected ${parameterCount}, found ${placeholders}`);
  }
  return output;
}
