const SCALE = 4n;
const FACTOR = 10n ** SCALE;
const BIGINT_MAX = 9223372036854775807n;

export function parseFiscalScaled(value: string, field = 'valor', maximum = BIGINT_MAX): string {
  if (typeof value !== 'string') throw new Error(`${field} deve ser informado como texto decimal.`);
  const input = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,4})?$/.test(input)) {
    throw new Error(`${field} deve ser um valor decimal não negativo com até 4 casas.`);
  }
  const [whole, fraction = ''] = input.split('.');
  const scaled = BigInt(whole) * FACTOR + BigInt(fraction.padEnd(Number(SCALE), '0') || '0');
  if (scaled > maximum) throw new Error(`${field} excede o limite suportado.`);
  return scaled.toString();
}

export function formatFiscalScaled(value: string | bigint): string {
  const scaled = typeof value === 'bigint' ? value : BigInt(value);
  if (scaled < 0n) throw new Error('Valor fiscal negativo não permitido.');
  const whole = scaled / FACTOR;
  const fraction = (scaled % FACTOR).toString().padStart(Number(SCALE), '0').replace(/0+$/, '');
  return `R$ ${whole.toString()}${fraction ? `,${fraction}` : ',00'}`;
}

export function validateFiscalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function validateFiscalPeriod(value: string): boolean {
  return /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value);
}

export const FISCAL_MANUAL_NOTICE = 'DOCUMENTO REGISTRADO MANUALMENTE. NÃO TRANSMITIDO À SEFAZ OU À PREFEITURA.';
