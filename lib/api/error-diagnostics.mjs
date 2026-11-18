/** Return only stable, non-sensitive fields from database/runtime errors. */
export function safeErrorDiagnostics(error) {
  const source = error && typeof error === 'object' ? error : {};
  const sqlState = typeof source.code === 'string' && /^\d{5}$/.test(source.code) ? source.code : undefined;
  const constraint = typeof source.constraint === 'string' && /^[A-Za-z0-9_.-]{1,120}$/.test(source.constraint) ? source.constraint : undefined;
  const type = error instanceof Error ? error.name : 'Unknown';
  return { type, ...(sqlState ? { sqlState } : {}), ...(constraint ? { constraint } : {}) };
}
