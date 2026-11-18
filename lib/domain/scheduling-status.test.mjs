import test from 'node:test';
import assert from 'node:assert/strict';

const transitions={
  scheduled:new Set(['confirmed','cancelled']),
  confirmed:new Set(['completed','cancelled']),
  cancelled:new Set(),
  completed:new Set(),
};
function canTransition(from,to){return from===to||Boolean(transitions[from]?.has(to));}

test('agenda aceita apenas transições operacionais válidas',()=>{
  assert.equal(canTransition('scheduled','confirmed'),true);
  assert.equal(canTransition('scheduled','cancelled'),true);
  assert.equal(canTransition('confirmed','completed'),true);
  assert.equal(canTransition('confirmed','cancelled'),true);
  assert.equal(canTransition('cancelled','scheduled'),false);
  assert.equal(canTransition('completed','cancelled'),false);
});
test('agenda mantém estado quando atualização é idempotente',()=>{
  assert.equal(canTransition('scheduled','scheduled'),true);
  assert.equal(canTransition('completed','completed'),true);
});
