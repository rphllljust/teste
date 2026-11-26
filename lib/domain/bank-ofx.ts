/**
 * OFX 1.x (SGML) and OFX 2.x (XML) bank-statement adapter.
 * Fail closed on ambiguous balances, dates, duplicate FITIDs or non-BRL currency.
 * No network activity and no third-party dependencies.
 */
export type OfxMovement = {
  externalKey: string;
  bookedDate: string;
  amount: string;
  description: string;
};
export type OfxStatement = {
  accountReference: string;
  periodStart: string;
  periodEnd: string;
  openingBalance: string;
  closingBalance: string;
  openingBalanceDerived: true;
  currency: 'BRL';
  lines: OfxMovement[];
};
export class OfxImportError extends Error {
  constructor(message: string) { super(message); this.name = 'OfxImportError'; }
}
const readTag = (source: string, name: string): string | null => {
  const match = new RegExp('<' + name + '(?:\\s[^>]*)?>([^<]*)', 'i').exec(source);
  return match ? match[1].trim().replace(/&(?:amp|lt|gt|quot|apos);/gi, entity => {
    const values: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
    return values[entity.toLowerCase()] ?? entity;
  }) : null;
};
const dateTag = (raw: string | null, name: string): string => {
  if (!raw || !/^\d{8}/.test(raw)) throw new OfxImportError('Data OFX ausente ou inválida: ' + name + '.');
  const date = raw.slice(0, 4) + '-' + raw.slice(4, 6) + '-' + raw.slice(6, 8);
  const d = new Date(date + 'T12:00:00Z');
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== date)
    throw new OfxImportError('Data OFX inexistente: ' + name + '.');
  return date;
};
const moneyScaled = (raw: string | null, name: string, zero = false): bigint => {
  if (!raw || !/^-?\d{1,12}(?:\.\d{1,4})?$/.test(raw))
    throw new OfxImportError('Valor monetário OFX inválido: ' + name + '.');
  const minus = raw.startsWith('-');
  const [whole, fraction = ''] = (minus ? raw.slice(1) : raw).split('.');
  const value = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'));
  const signed = minus ? -value : value;
  // Existing bank_statement schema stores scaled amounts in PostgreSQL INTEGER.
  if (signed > 2147483647n || signed < -2147483648n || (!zero && signed === 0n))
    throw new OfxImportError('Valor fora da capacidade do livro bancário: ' + name + '.');
  return signed;
};
const moneyInput = (scaled: bigint): string => {
  const abs = scaled < 0n ? -scaled : scaled;
  return (scaled < 0n ? '-' : '') + (abs / 10000n).toString() + '.' + (abs % 10000n).toString().padStart(4, '0');
};
export function parseOfxBankStatement(source: string): OfxStatement {
  if (typeof source !== 'string' || source.length > 1_000_000 || !/<OFX(?:\s|>)/i.test(source))
    throw new OfxImportError('Arquivo OFX ausente, inválido ou superior a 1 MB.');
  const currency = readTag(source, 'CURDEF');
  if (currency !== 'BRL') throw new OfxImportError('Somente extratos OFX em BRL são aceitos.');
  const account = readTag(source, 'ACCTID');
  const bank = readTag(source, 'BANKID');
  if (!account || !bank || bank.length > 40 || account.length > 115 ||
      !/^[\w.\-/ ]+$/.test(account) || !/^[\w.\-]+$/.test(bank))
    throw new OfxImportError('Banco ou conta OFX sem identificação válida.');
  const accountReference = bank + ':' + account;
  const periodStart = dateTag(readTag(source, 'DTSTART'), 'DTSTART');
  const periodEnd = dateTag(readTag(source, 'DTEND'), 'DTEND');
  if (periodStart > periodEnd) throw new OfxImportError('Período OFX invertido.');
  const ledgerAt = source.search(/<LEDGERBAL(?:\s[^>]*)?>/i);
  if (ledgerAt < 0) throw new OfxImportError('OFX sem saldo contábil final (LEDGERBAL).');
  const ledger = source.slice(ledgerAt).split(/<\/LEDGERBAL>|<AVAILBAL(?:\s|>)/i)[0];
  const closingScaled = moneyScaled(readTag(ledger, 'BALAMT'), 'LEDGERBAL/BALAMT', true);
  const blocks = [...source.matchAll(/<STMTTRN(?:\s[^>]*)?>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN(?:\s[^>]*)?>|<\/BANKTRANLIST>)/gi)];
  if (!blocks.length || blocks.length > 100)
    throw new OfxImportError('O extrato deve conter entre 1 e 100 movimentos.');
  const seen = new Set<string>();
  let movementTotal = 0n;
  const lines = blocks.map((item, index): OfxMovement => {
    const part = item[1];
    const externalKey = readTag(part, 'FITID');
    if (!externalKey || externalKey.length > 160 || seen.has(externalKey))
      throw new OfxImportError('FITID ausente, duplicado ou inválido na linha ' + (index + 1) + '.');
    seen.add(externalKey);
    const bookedDate = dateTag(readTag(part, 'DTPOSTED'), 'DTPOSTED');
    if (bookedDate < periodStart || bookedDate > periodEnd)
      throw new OfxImportError('Movimento fora do período do extrato: ' + externalKey + '.');
    const amount = moneyScaled(readTag(part, 'TRNAMT'), 'TRNAMT');
    movementTotal += amount;
    const name = readTag(part, 'NAME') ?? '';
    const memo = readTag(part, 'MEMO') ?? '';
    const description = [name, memo && memo !== name ? memo : ''].filter(Boolean).join(' · ').slice(0, 500);
    if (!description.trim()) throw new OfxImportError('Movimento sem descrição: ' + externalKey + '.');
    return { externalKey, bookedDate, amount: moneyInput(amount), description };
  });
  const openingScaled = closingScaled - movementTotal;
  if (openingScaled > 2147483647n || openingScaled < -2147483648n)
    throw new OfxImportError('Saldo inicial derivado excede a capacidade do livro bancário.');
  return {
    accountReference, periodStart, periodEnd,
    openingBalance: moneyInput(openingScaled), closingBalance: moneyInput(closingScaled),
    openingBalanceDerived: true, currency: 'BRL', lines,
  };
}
