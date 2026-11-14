/** Append-only inventory ledger with deterministic ordering and reconciliation. */
export type LedgerMovement = {
 id: string;
 delta: number;
 reference: string;
 createdAt: string;
 procurementOrderId?: string | null;
 receiptLineId?: string | null;
};
export type LedgerEntry = LedgerMovement & { balanceAfter: number };

export function buildStockLedger(movements: LedgerMovement[], openingBalance = 0) {
 if (!Number.isSafeInteger(openingBalance)) throw new Error('openingBalance must be a safe integer');
 let balance = openingBalance;
 const entries = [...movements].sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).map((movement) => {
  if (!Number.isSafeInteger(movement.delta)) throw new Error('movement delta must be a safe integer');
  const next = balance + movement.delta;
  if (!Number.isSafeInteger(next)) throw new Error('ledger balance exceeds safe integer range');
  balance = next;
  return { ...movement, balanceAfter: balance };
 });
 return { entries, closingBalance: balance, hasNegativeBalance: entries.some((entry) => entry.balanceAfter < 0) };
}

export function reconcileStockLedger(ledger: ReturnType<typeof buildStockLedger>, persistedBalance: number) {
 if (!Number.isSafeInteger(persistedBalance)) throw new Error('persisted balance must be a safe integer');
 const delta = ledger.closingBalance - persistedBalance;
 return {
  status: delta === 0 && !ledger.hasNegativeBalance ? 'reconciled' as const : 'exception' as const,
  delta,
  message: delta === 0 && !ledger.hasNegativeBalance ? 'Ledger conciliado com o saldo persistido.' : 'Há divergência entre movimentos e saldo persistido.',
 };
}
