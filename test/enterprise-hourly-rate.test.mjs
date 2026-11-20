import assert from 'node:assert/strict';
import test from 'node:test';
import {parseHourlyRateCents} from '../lib/domain/hourly-rate.ts';

test('asset and professional rates preserve cents without floating-point rounding',()=>{
 const cases=[['',null],['  ',null],['0',0],['0,01',1],['0.01',1],['3,4',340],
 ['001,50',150],['1.25',125],['125,50',12550],['21474836,47',2147483647]];
 for(const [input,expected] of cases)assert.equal(parseHourlyRateCents(input),expected,input);
 for(const invalid of ['0,001','0.001','1,999','1.234,00','1e3','-1','+4','1 000','abc','NaN','Infinity','21474836,48']){
  assert.throws(()=>parseHourlyRateCents(invalid),RangeError,invalid);
 }
});
