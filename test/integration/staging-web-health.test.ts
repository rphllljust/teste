import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyStagingWebSchema} from '../../lib/runtime/staging-web-health.mjs';

const ready={clients_ready:true,orders_ready:true,migrations_ready:true};

test('RC101 web staging SQL health is positive only when all canonical tables exist',async()=>{
 assert.equal(await verifyStagingWebSchema(async(sql:string)=>{
  assert.match(sql,/to_regclass\('public\.clients'\)/);
  assert.match(sql,/to_regclass\('public\.service_orders'\)/);
  assert.match(sql,/to_regclass\('public\._cisne_schema_migrations'\)/);
  assert.doesNotMatch(sql,/SELECT\s+\*|INSERT|UPDATE|DELETE/i);
  return {rows:[ready]};
 }),true);
 for(const field of Object.keys(ready)){
  for(const value of [false,null,undefined,'true']){
   const result=await verifyStagingWebSchema(async()=>({rows:[{...ready,[field]:value}]}));
   assert.equal(result,false,field+'='+String(value));
  }
 }
});

test('RC101 web staging health is fail-closed if PostgreSQL is absent or malfunctioning',async()=>{
 for(const sample of [null,undefined,{rows:[]},{rows:[ready,ready]},{rows:null}]){
  assert.equal(await verifyStagingWebSchema(async()=>sample),false);
 }
 assert.equal(await verifyStagingWebSchema(async()=>{throw new Error('sensitive DSN never returned');}),false);
});
