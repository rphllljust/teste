import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveActiveSectionId } from '../lib/ui/enterprise-sections.ts';

test('retains a selected section when the current object still has it', () => {
  assert.equal(resolveActiveSectionId([{ id: 'overview' }, { id: 'orders' }], 'orders'), 'orders');
});

test('falls back to the first available section when the object changes', () => {
  assert.equal(resolveActiveSectionId([{ id: 'profile' }, { id: 'contracts' }], 'orders'), 'profile');
});

test('clears the derived section when the object has no sections', () => {
  assert.equal(resolveActiveSectionId([], 'orders'), '');
});
