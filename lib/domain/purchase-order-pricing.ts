// Pure, deterministic enterprise purchasing valuation.
// Inventory quantities are thousandths; money uses ten-thousandths of BRL.
export type PurchaseLine = {
 id: string; itemId: string; quantity: number; unitPrice: number;
 discount: number; tax: number;
};
export type PurchaseOrderInput = {
 id: string; supplierId: string; reference: string; expectedOn: string;
 lines: PurchaseLine[]; freight: number; additionalCosts: number;
};
export class PurchasePricingError extends Error {}

export function pricePurchaseOrder(input: PurchaseOrderInput) {
 if (!input.lines.length || input.lines.length > 30)
  throw new PurchasePricingError('O pedido precisa conter de 1 a 30 itens.');
 for (const amount of [input.freight, input.additionalCosts]) {
  if (!Number.isSafeInteger(amount) || amount < 0)
   throw new PurchasePricingError('Encargos inválidos.');
 }
 const lines = input.lines.map((line, position) => {
  for (const n of [line.quantity, line.unitPrice, line.discount, line.tax]) {
   if (!Number.isSafeInteger(n) || n < 0)
    throw new PurchasePricingError('Valores de item inválidos.');
  }
  if (!line.quantity || !line.unitPrice)
   throw new PurchasePricingError('Quantidade e preço devem ser positivos.');
  // Preserve the existing half-up rounding rule without unsafe float products.
  const exact = (BigInt(line.quantity) * BigInt(line.unitPrice) + 500n) / 1000n
   - BigInt(line.discount) + BigInt(line.tax);
  if (exact <= 0n || exact > BigInt(Number.MAX_SAFE_INTEGER))
   throw new PurchasePricingError('Subtotal de compra inválido.');
  return { ...line, position: position + 1, subtotal: Number(exact) };
 });
 const totalExact = lines.reduce((sum, line) => sum + BigInt(line.subtotal), BigInt(input.freight) + BigInt(input.additionalCosts));
 if (totalExact <= 0n || totalExact > BigInt(Number.MAX_SAFE_INTEGER))
  throw new PurchasePricingError('Total do pedido inválido.');
 return { lines, total: Number(totalExact) };
}
