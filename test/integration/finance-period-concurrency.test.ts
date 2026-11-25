import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {closeDatabase} from '../../db/raw';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {POST as closePeriod} from '../../app/api/finance/periods/close/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)throw new Error('Isolated PostgreSQL required');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3});
const actor=randomUUID();
const ids=[randomUUID(),randomUUID()];
const command=(id:string)=>setTestIdentity(new Request('http://localhost/api/finance/periods/close',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({
    id,periodStart:'2027-01-01',periodEnd:'2027-01-31',reference:'CI concurrent close',
  }),
}),actor);
after(async()=>{
  await pool.query("DELETE FROM finance_audit_events WHERE entity_type='finance_period' AND actor_id=$1",[actor]);
  await pool.query('DELETE FROM finance_period_closes WHERE actor_id=$1',[actor]);
  await closeDatabase();await pool.end();
});
test('concurrent closing of overlapping financial periods permits only one committed close',async()=>{
  const [first,second]=await Promise.all(ids.map(id=>closePeriod(command(id))));
  assert.deepEqual([first.status,second.status].sort(),[201,409]);
  const persisted=await pool.query('SELECT id FROM finance_period_closes WHERE actor_id=$1',[actor]);
  assert.equal(persisted.rows.length,1);
  const again=await closePeriod(command(persisted.rows[0].id));
  assert.equal(again.status,200);
  const invalid=await closePeriod(setTestIdentity(new Request('http://localhost/api/finance/periods/close',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({id:randomUUID(),periodStart:'2027-02-30',periodEnd:'2027-03-01',reference:'Invalid date'}),
  }),actor));
  assert.equal(invalid.status,400);
});
