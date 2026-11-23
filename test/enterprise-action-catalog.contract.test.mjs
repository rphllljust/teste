import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../app/components/enterprise/EnterpriseActionCatalog.ts', import.meta.url), 'utf8');

assert.match(source, /export type EnterpriseActionDefinition/);
assert.match(source, /requiredPermissions/);
assert.match(source, /preconditions/);
assert.match(source, /confirmation/);
assert.match(source, /endpoint/);
assert.match(source, /updatePolicy/);
assert.match(source, /evaluateEnterpriseAction/);
assert.match(source, /não substitui a validação do backend/);
assert.doesNotMatch(source, /EnterprisePrimitives/);
console.log('enterprise-action-catalog: 8/8 checks passed');
