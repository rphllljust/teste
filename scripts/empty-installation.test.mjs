import test from 'node:test';
import assert from 'node:assert/strict';
import {isVerifiedEmptyInstallation} from './migration-safety.mjs';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('./migrate-postgres.mjs',import.meta.url),'utf8');
test('first installation requires zero user relations and zero migration ledger entries',()=>{
 assert.equal(isVerifiedEmptyInstallation({userRelations:0,ledgerRows:0}),true);
 for(const input of [
  {userRelations:1,ledgerRows:0},{userRelations:0,ledgerRows:1},
  {userRelations:1,ledgerRows:1},{userRelations:null,ledgerRows:0},
  {userRelations:-1,ledgerRows:0},{userRelations:'0',ledgerRows:0},
  {userRelations:0,ledgerRows:undefined},
 ])assert.equal(isVerifiedEmptyInstallation(input),false);
});
test('catalog proof excludes system schemas but includes all user schemas, views and sequences',()=>{
 assert.match(src,/pg_catalog\.pg_class/);
 assert.match(src,/pg_catalog\.pg_namespace/);
 assert.match(src,/n\.nspname !~ '\^pg_'/);
 assert.match(src,/c\.relkind IN \('r','p','v','m','f','S'\)/);
 assert.match(src,/NOT\(n\.nspname='public' AND c\.relname='_cisne_schema_migrations'\)/);
 assert.match(src,/current_schema\(\)/);
 assert.match(src,/client\.query\('BEGIN'\)/);
 assert.match(src,/pg_advisory_xact_lock/);
 assert.match(src,/if\(!firstInstall\)validateRestoreAttestation/);
 assert.match(src,/await client\.query\('ROLLBACK'\)/);
});
