import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOfxBankStatement, OfxImportError } from './bank-ofx.ts';

const sgml = (overrides = {}) => {
  const movements = overrides.movements ?? [
    '<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261122090000[-4:BRT]<TRNAMT>125.2500<FITID>bank-001<NAME>Pagamento cliente',
    '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261123100000[-4:BRT]<TRNAMT>-25.2500<FITID>bank-002<NAME>Fornecedor<MEMO>Nota 123',
  ];
  return [
    'OFXHEADER:100','DATA:OFXSGML','VERSION:102','CHARSET:1252','',
    '<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>' + (overrides.currency ?? 'BRL'),
    '<BANKACCTFROM><BANKID>001<ACCTID>123456-7</BANKACCTFROM>',
    '<BANKTRANLIST><DTSTART>' + (overrides.start ?? '20261122000000') +
      '<DTEND>' + (overrides.end ?? '20261123235959'),
    ...movements,
    '</BANKTRANLIST><LEDGERBAL><BALAMT>' + (overrides.balance ?? '300.0000') + '<DTASOF>20261123</LEDGERBAL>',
    '</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>'
  ].join('\n');
};
test('SGML OFX: decimals, debit sign, account origin, period and derived opening balance', () => {
  const parsed = parseOfxBankStatement(sgml());
  assert.equal(parsed.accountReference, '001:123456-7');
  assert.equal(parsed.currency, 'BRL');
  assert.equal(parsed.periodStart, '2026-11-22');
  assert.equal(parsed.periodEnd, '2026-11-23');
  assert.equal(parsed.openingBalance, '200.0000');
  assert.equal(parsed.closingBalance, '300.0000');
  assert.equal(parsed.openingBalanceDerived, true);
  assert.deepEqual(parsed.lines.map(l => [l.externalKey,l.bookedDate,l.amount,l.description]), [
    ['bank-001','2026-11-22','125.2500','Pagamento cliente'],
    ['bank-002','2026-11-23','-25.2500','Fornecedor · Nota 123'],
  ]);
});
test('XML OFX: closed leaf tags and escaped XML text are recognized', () => {
  const data = '<OFX><STMTRS><CURDEF>BRL</CURDEF><BANKACCTFROM><BANKID>341</BANKID><ACCTID>00987</ACCTID></BANKACCTFROM>' +
    '<BANKTRANLIST><DTSTART>20260101</DTSTART><DTEND>20260131</DTEND>' +
    '<STMTTRN><DTPOSTED>20260120</DTPOSTED><FITID>uniq</FITID><TRNAMT>-0.0001</TRNAMT><NAME>Taxa &amp; tarifa</NAME></STMTTRN></BANKTRANLIST>' +
    '<LEDGERBAL><BALAMT>-1.0000</BALAMT></LEDGERBAL></STMTRS></OFX>';
  const parsed = parseOfxBankStatement(data);
  assert.equal(parsed.openingBalance, '-0.9999');
  assert.equal(parsed.lines[0].description, 'Taxa & tarifa');
  assert.equal(parsed.lines[0].amount, '-0.0001');
});
test('rejects unsupported currency, duplicate FITID and entries outside the statement', () => {
  assert.throws(() => parseOfxBankStatement(sgml({ currency:'USD' })), /BRL/);
  assert.throws(() => parseOfxBankStatement(sgml({ movements: [
    '<STMTTRN><FITID>same<DTPOSTED>20261122<TRNAMT>1.00<NAME>A',
    '<STMTTRN><FITID>same<DTPOSTED>20261123<TRNAMT>2.00<NAME>B'
  ]})), /FITID/);
  assert.throws(() => parseOfxBankStatement(sgml({ start:'20261201000000' })), /invertido|fora do período/);
});
test('refuses invalid calendar dates, missing ledger balance, missing FITID and zero amount', () => {
  assert.throws(() => parseOfxBankStatement(sgml({ start:'20261131000000' })), /Data OFX/);
  assert.throws(() => parseOfxBankStatement(sgml().replace('<LEDGERBAL>','<AVAILBAL>')), /LEDGERBAL/);
  assert.throws(() => parseOfxBankStatement(sgml().replace('<FITID>bank-001','<MEMO>sem chave')), /FITID/);
  assert.throws(() => parseOfxBankStatement(sgml().replace('<TRNAMT>125.2500','<TRNAMT>0.0000')), /capacidade/);
});
test('refuses malformed, oversized, floating-point precision and unsafe monetary scale', () => {
  assert.throws(() => parseOfxBankStatement('garbage'), OfxImportError);
  assert.throws(() => parseOfxBankStatement('<OFX>' + ' '.repeat(1_000_001)), /1 MB/);
  assert.throws(() => parseOfxBankStatement(sgml().replace('125.2500','125.25001')), /Valor monetário/);
  assert.throws(() => parseOfxBankStatement(sgml({ balance:'500000.0000' })), /capacidade/);
});
test('limits each OFX import to 100 transactions', () => {
  const movements = Array.from({length:101},(_,i) =>
    '<STMTTRN><FITID>f' + i + '<DTPOSTED>20261122<TRNAMT>1.0000<NAME>Crédito');
  assert.throws(() => parseOfxBankStatement(sgml({movements})), /100 movimentos/);
});
