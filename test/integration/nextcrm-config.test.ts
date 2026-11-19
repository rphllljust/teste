import test from 'node:test';
import assert from 'node:assert/strict';
import { getNextcrmInstanceKey } from '../../lib/integrations/nextcrm/config';

test('uses the single Railway NextCRM installation variable', () => {
  const previous = process.env.CISNE_NEXTCRM_INSTANCE_KEY;
  const legacy = process.env.NEXTCRM_INSTANCE;
  process.env.CISNE_NEXTCRM_INSTANCE_KEY = 'cisne-hml-2026';
  process.env.NEXTCRM_INSTANCE = 'legacy-instance';
  assert.equal(getNextcrmInstanceKey(), 'cisne-hml-2026');
  if (previous === undefined) delete process.env.CISNE_NEXTCRM_INSTANCE_KEY;
  else process.env.CISNE_NEXTCRM_INSTANCE_KEY = previous;
  if (legacy === undefined) delete process.env.NEXTCRM_INSTANCE;
  else process.env.NEXTCRM_INSTANCE = legacy;
});
