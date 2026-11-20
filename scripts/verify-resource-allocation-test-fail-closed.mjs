import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

const result=spawnSync(process.execPath,['--import','tsx','--test','test/integration/resource-allocations.test.ts'],{
  cwd:process.cwd(),
  env:{...process.env,NODE_ENV:'test',DATABASE_URL:undefined,CISNE_ALLOW_NON_LOOPBACK_INTEGRATION:undefined},
  encoding:'utf8',
});
const output=`${result.stdout}\n${result.stderr}`;
assert.notEqual(result.status,0,'resource allocation integration must fail when DATABASE_URL is absent');
assert.match(output,/RESOURCE_ALLOCATION_INTEGRATION_NO_GO: NODE_ENV=test and DATABASE_URL are required/);
console.log('Resource allocation integration fail-closed gate: missing DATABASE_URL rejected; NOT RUN, not PASS.');
