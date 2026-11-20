import test from 'node:test';
import assert from 'node:assert/strict';
import { formatFiscalScaled, parseFiscalScaled, validateFiscalDate, validateFiscalPeriod } from './fiscal.ts';

test('preserva precisão monetária acima do limite integer legado', () => {
  for (const [input, expected, display] of [
    ['0', '0', 'R$ 0,00'],
    ['0,01', '100', 'R$ 0,01'],
    ['214748,36', '2147483600', 'R$ 214748,36'],
    ['214748,37', '2147483700', 'R$ 214748,37'],
    ['300000,00', '3000000000', 'R$ 300000,00'],
    ['1000000,00', '10000000000', 'R$ 1000000,00'],
    ['10000000,00', '100000000000', 'R$ 10000000,00'],
  ]) {
    assert.equal(parseFiscalScaled(input), expected);
    assert.equal(formatFiscalScaled(expected), display);
  }
});

test('rejeita entradas monetárias ambíguas ou sem precisão definida', () => {
  for (const value of ['-0,01', '1,23456', '1.2.3', 'R$ 1,00', '', '1,']) {
    assert.throws(() => parseFiscalScaled(value));
  }
});

test('valida o calendário civil sem conversão de fuso', () => {
  assert.equal(validateFiscalDate('2028-02-29'), true);
  assert.equal(validateFiscalDate('2026-02-29'), false);
  assert.equal(validateFiscalDate('2026-04-31'), false);
  assert.equal(validateFiscalDate('2026-13-01'), false);
  assert.equal(validateFiscalDate('2026-01-01'), true);
  assert.equal(validateFiscalPeriod('2026-11'), true);
  assert.equal(validateFiscalPeriod('2026-13'), false);
});
