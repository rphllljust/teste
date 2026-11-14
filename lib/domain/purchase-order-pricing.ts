export type PurchaseLine = {
 id: string;
 itemId: string;
 quantity: number;
 unitPrice: number;
 discount: number;
 tax: number;
 position?: number;
};

export type PurchaseOrderInput = {
 id: string;
 supplierId: string;
 reference: string;
 expectedOn: string;
 freight: number;
 additionalCosts: number;
 lines: PurchaseLine[];
};

export class PurchasePricingError extends Error {
 constructor(message: string) {
  super(message);
  this.name = 'PurchasePricingError';
 }
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
function integer(name: string, value: unknown, positive = false): number {
 if (typeof value !== 'number' || !Number.isSafeInteger(value) || (positive ? value <= 0 : value < 0)) {
  throw new PurchasePricingError(`${name} must be ${positive ? 'a positive' : 'a non-negative'} safe integer`);
 }
 return value;
}
function moneyRoundHalfUp(product: bigint): bigint {
 const quotient = product / 1000n;
 const remainder = product % 1000n;
 return quotient + (remainder >= 500n ? 1n : 0n);
}
function safeNumber(name: string, value: bigint): number {
 if (value < 0n || value > MAX_SAFE) throw new PurchasePricingError(`${name} exceeds safe monetary range`);
 return Number(value);
}

export function pricePurchaseOrder(input: PurchaseOrderInput) {
 if (!input || typeof input !== 'object') throw new PurchasePricingError('purchase order is required');
 if (!input.id || !input.supplierId || !input.reference || !input.expectedOn) {
  throw new PurchasePricingError('purchase order identity and dates are required');
 }
 integer('freight', input.freight);
 integer('additionalCosts', input.additionalCosts);
 if (!Array.isArray(input.lines) || input.lines.length === 0) throw new PurchasePricingError('at least one line is required');
 const lines = input.lines.map((line, index) => {
  if (!line.id || !line.itemId) throw new PurchasePricingError('line identity is required');
  const quantity = integer(`lines[${index}].quantity`, line.quantity, true);
  const unitPrice = integer(`lines[${index}].unitPrice`, line.unitPrice, true);
  const discount = integer(`lines[${index}].discount`, line.discount ?? 0);
  const tax = integer(`lines[${index}].tax`, line.tax ?? 0);
  const gross = BigInt(quantity) * BigInt(unitPrice);
  const subtotal = moneyRoundHalfUp(gross) - BigInt(discount) + BigInt(tax);
  if (subtotal <= 0n) throw new PurchasePricingError(`lines[${index}] subtotal must be positive`);
  return {
   ...line,
   position: line.position ?? index + 1,
   quantity,
   unitPrice,
   discount,
   tax,
   subtotal: safeNumber('line subtotal', subtotal),
  };
 });
 const subtotal = lines.reduce((sum, line) => sum + BigInt(line.subtotal), 0n);
 const total = subtotal + BigInt(input.freight) + BigInt(input.additionalCosts);
 return { lines, subtotal: safeNumber('order subtotal', subtotal), total: safeNumber('order total', total) };
}
