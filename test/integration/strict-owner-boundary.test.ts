import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { closeDatabase } from '../../db/raw';
import { setTestIdentity } from '../../lib/api/test-identity.mjs';
import { GET as getOrders } from '../../app/api/orders/route';
import { GET as getOperation } from '../../app/api/operation/route';
import { GET as getFinance } from '../../app/api/finance/workspace/route';
import { GET as getFinancialDetail } from '../../app/api/operation/[kind]/[id]/route';
import { GET as getExecution, POST as postExecution } from '../../app/api/orders/[id]/execution/route';
import { POST as postCommand } from '../../app/api/commands/route';

if(process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL)
  throw Error('NO-GO: owner isolation tests require disposable PostgreSQL');
const url=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(url.hostname) ||
   !['/cisne_test','/cisne_ci'].includes(url.pathname) || url.port!=='5432')
  throw Error('NO-GO: owner isolation refuses non-ephemeral PostgreSQL');

test('OS, linked finance, cockpit, execution and commands exclude legacy ownerless and foreign data',async()=>{
  const db=new Pool({connectionString:process.env.DATABASE_URL,max:4});
  const actor=randomUUID(),other=randomUUID(),now=new Date().toISOString();
  const orders=[randomUUID(),randomUUID(),randomUUID()];
  const measurements=[randomUUID(),randomUUID(),randomUUID()];
  const invoices=[randomUUID(),randomUUID(),randomUUID()];
  const receivables=[randomUUID(),randomUUID(),randomUUID()];
  const owners=[actor,other,null];
  const amounts=[10000,900000,700000];
  const req=(path:string,who:string,body?:unknown)=>
    setTestIdentity(new Request('http://localhost'+path,{
      method:body===undefined?'GET':'POST',
      headers:body===undefined?{}:{'content-type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body),
    }),who);
  const ids=(items:Array<{id:string}>)=>items.map(item=>item.id);
  try{
    for(let i=0;i<3;i++){
      await db.query(`INSERT INTO service_orders
        (id,owner_id,title,client,category,description,status,version,created_at)
        VALUES($1,$2,$3,$4,'Serviços','CI only','executing',1,$5)`,
      [orders[i],owners[i],'Boundary CI '+orders[i].slice(0,8),'Synthetic',now]);
      await db.query(`INSERT INTO measurements(id,order_id,description,amount,status,created_at)
        VALUES($1,$2,'CI measurement',$3,'approved',$4)`,[measurements[i],orders[i],amounts[i],now]);
      await db.query('INSERT INTO invoices(id,measurement_id,order_id,amount,due_date,created_at) VALUES($1,$2,$3,$4,$5,$6)',
        [invoices[i],measurements[i],orders[i],amounts[i],'2026-11-15',now]);
      await db.query('INSERT INTO receivables(id,invoice_id,amount,due_date,created_at) VALUES($1,$2,$3,$4,$5)',
        [receivables[i],invoices[i],amounts[i],'2026-11-15',now]);
    }
    for(const [who,index] of [[actor,0],[other,1]] as const){
      const list=await getOrders(req('/api/orders?q=Boundary%20CI',who));
      assert.equal(list.status,200);
      const body=await list.json() as {items:Array<{id:string}>;summary:{total:number}};
      assert.ok(ids(body.items).includes(orders[index]));
      for(const bad of [orders[1-index],orders[2]])
        assert.equal(ids(body.items).includes(bad),false,'No foreign/ownerless order in worklist');

      for(const [kind,all] of [
        ['measurements',measurements],['invoices',invoices],['receivables',receivables],
      ] as const){
        const response=await getOperation(req('/api/operation?kind='+kind+'&q=Boundary%20CI',who));
        assert.equal(response.status,200);
        const p=await response.json() as Record<string,unknown>;
        const rows=p[kind] as Array<{id:string}>;
        assert.ok(ids(rows).includes(all[index]));
        assert.equal(ids(rows).includes(all[1-index]),false);
        assert.equal(ids(rows).includes(all[2]),false);
        for(const blocked of [all[1-index],all[2]]){
          const result=await getFinancialDetail(req('/api/operation/'+kind+'/'+blocked,who),
            {params:Promise.resolve({kind,id:blocked})});
          assert.equal(result.status,404,'Foreign and ownerless linked detail must fail closed');
        }
        const own=await getFinancialDetail(req('/api/operation/'+kind+'/'+all[index],who),
          {params:Promise.resolve({kind,id:all[index]})});
        assert.equal(own.status,200);
      }
      const finance=await getFinance(req('/api/finance/workspace?asOf=2026-11-16',who));
      assert.equal(finance.status,200);
      const snapshot=await finance.json() as {metrics:Array<{metricId:string;value:string;count:number}>};
      const outstanding=snapshot.metrics.find(m=>m.metricId==='receivables.outstanding');
      const overdue=snapshot.metrics.find(m=>m.metricId==='receivables.overdue');
      assert.equal(outstanding?.value,String(amounts[index]));
      assert.equal(overdue?.value,String(amounts[index]));
      assert.equal(outstanding?.count,1);

      for(const forbiddenOrder of [orders[1-index],orders[2]]){
        const exec=await getExecution(req('/api/orders/'+forbiddenOrder+'/execution',who),
          {params:Promise.resolve({id:forbiddenOrder})});
        assert.equal(exec.status,404);
        const post=await postExecution(req('/api/orders/'+forbiddenOrder+'/execution',who,{
          key:randomUUID(),command:'report',resourceKind:'equipment',description:'Synthetic report',
          quantity:'1',unit:'un',effectiveDate:'2026-11-16',reference:'CI-BLOCK',
        }),{params:Promise.resolve({id:forbiddenOrder})});
        // Validation may reject malformed synthetic report before ownership,
        // but must never accept or write it.
        assert.notEqual(post.status,201,'Cannot mutate a foreign order');
        const command=await postCommand(req('/api/commands',who,{
          id:forbiddenOrder,version:1,key:randomUUID(),command:'start',
        }));
        assert.equal(command.status,404,'Foreign and ownerless order commands denied');
      }
    }
    const persisted=await db.query('SELECT id,owner_id FROM service_orders WHERE id=ANY($1::text[])',[orders]);
    assert.equal(persisted.rowCount,3,'Legacy ownerless record must be preserved, not reassigned');
    assert.equal(persisted.rows.find(r=>r.id===orders[2])?.owner_id,null);
    const dirty=await db.query('SELECT count(*)::int AS n FROM order_events WHERE order_id=ANY($1::text[])',[orders]);
    assert.equal(dirty.rows[0].n,0,'Denied mutations must leave zero events');
  }finally{
    for(const table of ['receivables','invoices','measurements'])
      await db.query('DELETE FROM '+table+' WHERE id=ANY($1::text[])',
        [table==='receivables'?receivables:table==='invoices'?invoices:measurements]);
    await db.query('DELETE FROM service_orders WHERE id=ANY($1::text[])',[orders]);
    await db.end();
    await closeDatabase();
  }
});
