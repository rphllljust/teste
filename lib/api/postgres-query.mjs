const identifier = /^(?:[a-z_][a-z0-9_]*\.)?[a-z_][a-z0-9_]*$/i;

function checkedIdentifier(value) {
  if (!identifier.test(value)) throw new Error('Invalid SQL identifier');
  return value;
}

/** Build a PostgreSQL substring search with the D1/SQLite case-folding behavior. */
export function caseInsensitiveContains(columns) {
  if (!Array.isArray(columns) || columns.length === 0) throw new Error('At least one SQL column is required');
  return `(${columns.map((column) => `${checkedIdentifier(column)} ILIKE ? ESCAPE '\\'`).join(' OR ')})`;
}

/** PostgreSQL replacement for SQLite's COLLATE NOCASE ascending text order. */
export function caseInsensitiveAscending(column) {
  return `LOWER(${checkedIdentifier(column)}) ASC`;
}
