import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {closeDatabase} from '../../db/raw';
import {GET as readiness} from '../../app/api/health/ready/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
 throw new Error('Readiness integration requires isolated PostgreSQL test environment');
after(async()=>{await closeDatabase();});

test('readiness is public to Railway probes but requires actual migrated enterprise PostgreSQL',async()=>{
 const response=await readiness();
 assert.equal(response.status,200);
 assert.equal(response.headers.get('cache-control'),'no-store, private');
 assert.deepEqual(await response.json(),{ready:true});
});
