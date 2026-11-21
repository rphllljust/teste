import assert from 'node:assert/strict';
import test from 'node:test';
import { changedProfileFields } from '../lib/integrations/nextcrm/changed-profile-fields.ts';

test('sends only CRM values changed from the persisted profile', () => {
  assert.deepEqual(
    changedProfileFields(
      ['officePhone', 'website', 'billingCity'],
      { officePhone: '555-1000', website: 'https://example.test', billingCity: 'Manaus' },
      { officePhone: '555-1000', website: 'https://old.example.test', billingCity: 'Manaus' },
    ),
    { website: 'https://example.test' },
  );
});

test('preserves explicit null to clear a previously stored value', () => {
  assert.deepEqual(
    changedProfileFields(['fax'], { fax: null }, { fax: '555-3000' }),
    { fax: null },
  );
});

test('omits untouched empty values when no mapped profile exists', () => {
  assert.deepEqual(changedProfileFields(['fax', 'website'], { fax: null, website: null }), {});
});
