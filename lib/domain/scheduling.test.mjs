import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeScheduleWindow,overlaps} from './scheduling.ts';

test('normalizes offsets to comparable UTC instants',()=>{
  const w=normalizeScheduleWindow({startAt:'2026-11-15T23:00:00-03:00',endAt:'2026-11-16T01:00:00-03:00',timezone:'America/Porto_Velho'});
  assert.equal(w.startUtc,'2026-11-16T02:00:00.000Z');
  assert.equal(w.endUtc,'2026-11-16T04:00:00.000Z');
});
test('rejects invalid windows and IANA timezones',()=>{
  assert.throws(()=>normalizeScheduleWindow({startAt:'2026-11-16T02:00:00Z',endAt:'2026-11-16T01:00:00Z',timezone:'UTC'}),/INVALID_WINDOW/);
  assert.throws(()=>normalizeScheduleWindow({startAt:'2026-11-16T01:00:00Z',endAt:'2026-11-16T02:00:00Z',timezone:'Not/AZone'}),/INVALID_TIMEZONE/);
});
test('detects overlap only for the same resource selected by caller',()=>{
  assert.equal(overlaps({startUtc:'2026-11-16T01:00:00.000Z',endUtc:'2026-11-16T02:00:00.000Z'},{startUtc:'2026-11-16T01:59:00.000Z',endUtc:'2026-11-16T03:00:00.000Z'}),true);
  assert.equal(overlaps({startUtc:'2026-11-16T01:00:00.000Z',endUtc:'2026-11-16T02:00:00.000Z'},{startUtc:'2026-11-16T02:00:00.000Z',endUtc:'2026-11-16T03:00:00.000Z'}),false);
});