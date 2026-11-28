import test from 'node:test';
import assert from 'node:assert/strict';
import {formatServiceCentsBRL as money} from './service-money.mjs';
test('correctly renders cents without 100x inflation',()=>{
 assert.equal(money(450000),'R$\u00a04.500,00');
 assert.equal(money('100000'),'R$\u00a01.000,00');
 assert.equal(money('499900'),'R$\u00a04.999,00');
 assert.equal(money(0),'R$\u00a00,00');
});
test('retains two decimals, negative reversals, BigInt and exact boundary scale',()=>{
 assert.equal(money(1),'R$\u00a00,01');
 assert.equal(money(12345),'R$\u00a0123,45');
 assert.equal(money(-1),'−R$\u00a00,01');
 assert.equal(money('900719925474099300'),'R$\u00a09.007.199.254.740.993,00');
 assert.equal(money(9007199254740993n),'R$\u00a090.071.992.547.409,93');
});
test('never rounds floats or accepts currency/ledger-scaled values as cents by accident',()=>{
 for(const value of [NaN,Infinity,1.25,Number.MAX_SAFE_INTEGER+2,'10.20','10,20','R$ 10','']) 
  assert.throws(()=>money(value));
});
