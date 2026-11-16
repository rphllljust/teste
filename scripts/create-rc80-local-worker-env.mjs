// Write only CI-generated, disposable staging bindings to gitignored local files.
// Never use this script on Railway, and never copy a production or UAT secret.
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.CI!=='true')
  throw Error('NO-GO: only GitHub Actions may create local UAT bindings');
if(Object.keys(process.env).some(k=>k.startsWith('RAILWAY_')))
  throw Error('NO-GO: refusing Railway runtime');
const u=new URL(process.env.DATABASE_URL??'about:blank');
assert.equal(u.hostname,'postgres','Only disposable Postgres service');
assert.equal(u.pathname,'/cisne_ci','Only disposable Postgres db');
const secret=process.env.CISNE_STAGING_SESSION_SECRET??'';
assert.ok(secret.length>=32,'Ephemeral signed session key required');
const keys={
  DATABASE_URL:process.env.DATABASE_URL,
  RAILWAY_ENVIRONMENT_NAME:'staging',
  CISNE_STAGING_ACCESS_MODE:'private',
  CISNE_STAGING_ACTOR_ID:'ci-browser-actor-rc80',
  CISNE_STAGING_SESSION_SECRET:secret,
  CISNE_STAGING_READ_ONLY:'false',
  NODE_ENV:'production',
};
const escaped=Object.entries(keys).map(([k,v])=>
  k+'='+JSON.stringify(v)).join('\n')+'\n';
await mkdir('dist/server',{recursive:true});
for(const file of ['.dev.vars','dist/server/.dev.vars'])
  await writeFile(file,escaped,{mode:0o600});
console.log('CI local worker environment configured (only keys disclosed).');
