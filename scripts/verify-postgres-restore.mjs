import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Pool} from 'pg';

// Intentionally refuses any persistent or remote database. Railway has to
// prove its own independent backup separately; this is a CI restore drill.
const url=new URL(process.env.DATABASE_URL||'postgresql://invalid');
if(process.env.NODE_ENV!=='test'||process.env.GITHUB_ACTIONS!=='true'||
  process.env.CI!=='true'||url.protocol!=='postgresql:'||
  !['localhost','127.0.0.1'].includes(url.hostname)||
  url.port!=='5432'||url.pathname!=='/cisne_test'||
  url.username!=='cisne_test'||url.password!=='cisne_test'){
  throw Error('DISPOSABLE_DB_REQUIRED: restore drill is restricted to the GitHub CI fixture');
}

const major=process.env.CISNE_TEST_POSTGRES_MAJOR;
if(!['16','18'].includes(major))
  throw Error('DISPOSABLE_DB_REQUIRED: fixture requires PostgreSQL major 16 or 18');
const restoreDb='cisne_restore_'+randomUUID().replace(/-/g,'').slice(0,16);
const actor=randomUUID(),clientId=randomUUID(),leadId=randomUUID();
const opportunityId=randomUUID(),proposalId=randomUUID();
const poId=randomUUID(),contractId=randomUUID(),orderId=randomUUID();
const stamp=new Date().toISOString();
const src=new Pool({connectionString:process.env.DATABASE_URL,max:1});
const folder=await mkdtemp(join(tmpdir(),'cisne-restore-ci-'));
let copy;
let created=false;
const docker=(args)=>execFileSync('docker',[
  'run','--rm','--network','host','--env','PGPASSWORD=cisne_test',
  '--volume',folder+':/backups','postgres:'+major,...args,
],{stdio:['ignore','pipe','pipe'],encoding:'utf8',timeout:90000});

async function seed(){
  const client=await src.connect();
  try{
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO clients(id,owner_id,legal_name,created_at,updated_at)
       VALUES($1,$2,'Cliente da recuperação CI',$3,$3)`,[clientId,actor,stamp]);
    await client.query(
      `INSERT INTO crm_leads(id,owner_id,contact_name,company_name,status,client_id,created_at,updated_at)
       VALUES($1,$2,'Contato da recuperação','Empresa de teste','qualified',$3,$4,$4)`,
      [leadId,actor,clientId,stamp]);
    await client.query(
      `INSERT INTO crm_opportunities(id,owner_id,lead_id,client_id,title,amount_cents,stage,created_at,updated_at)
       VALUES($1,$2,$3,$4,'Manutenção de backup',25050,'proposal',$5,$5)`,
      [opportunityId,actor,leadId,clientId,stamp]);
    await client.query(
      `INSERT INTO proposals
       (id,owner_id,client_id,title,scope,valid_until,total,status,evidence_reference,created_at,updated_at)
       VALUES($1,$2,$3,'Proposta de recuperação','Escopo validado','2099-12-31',2505000,
       'accepted','ACEITE-RESTORE-CI',$4,$4)`,
      [proposalId,actor,clientId,stamp]);
    await client.query(
      `INSERT INTO proposal_lines
       (id,proposal_id,position,description,unit,quantity,unit_price,amount)
       VALUES($1,$2,1,'Manutenção','un',1000000,2505000,2505000)`,
      [randomUUID(),proposalId]);
    await client.query(
      `INSERT INTO crm_opportunity_proposals(owner_id,opportunity_id,proposal_id,command_key,created_at)
       VALUES($1,$2,$3,$4,$5)`,
      [actor,opportunityId,proposalId,randomUUID(),stamp]);
    await client.query(
      `INSERT INTO purchase_orders
       (id,owner_id,client_id,proposal_id,reference,received_date,status,created_at,updated_at)
       VALUES($1,$2,$3,$4,'PO-RESTORE-CI','2026-11-15','registered',$5,$5)`,
      [poId,actor,clientId,proposalId,stamp]);
    await client.query(
      `INSERT INTO contracts
       (id,owner_id,client_id,proposal_id,purchase_order_id,reference,scope,
       starts_on,ends_on,status,signed_reference,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,'CONTRATO-RESTORE-CI','Manutenção contratada',
       '2026-11-01','2027-11-01','active','ASSINATURA-RESTORE-CI',$6,$6)`,
      [contractId,actor,clientId,proposalId,poId,stamp]);
    await client.query(
      `INSERT INTO service_orders
       (id,owner_id,client_id,contract_id,title,client,category,description,created_at,status)
       VALUES($1,$2,$3,$4,'Ordem da recuperação','Cliente da recuperação CI',
       'Serviços','Somente CI',$5,'draft')`,
      [orderId,actor,clientId,contractId,stamp]);
    await client.query('COMMIT');
  }catch(err){await client.query('ROLLBACK');throw err;}
  finally{client.release();}
}

async function verify(){
  const restoredUrl=new URL(process.env.DATABASE_URL);
  // Editing pathname avoids corrupting the username (the URL begins
  // with //cisne_test) and preserves all connection settings.
  restoredUrl.pathname='/'+restoreDb;
  const pool=new Pool({connectionString:restoredUrl.toString(),max:1});
  copy=pool;
  const result=await pool.query(
    `SELECT c.id AS client_id,l.id AS lead_id,o.id AS opportunity_id,
     p.id AS proposal_id,po.id AS po_id,ct.id AS contract_id,so.id AS order_id,
     p.total AS total, ct.status AS contract_status,so.status AS order_status
     FROM clients c
     JOIN crm_leads l ON l.owner_id=c.owner_id AND l.client_id=c.id
     JOIN crm_opportunities o ON o.owner_id=c.owner_id AND o.lead_id=l.id
     JOIN crm_opportunity_proposals link
       ON link.owner_id=c.owner_id AND link.opportunity_id=o.id
     JOIN proposals p ON p.owner_id=c.owner_id AND p.id=link.proposal_id
     JOIN purchase_orders po ON po.owner_id=c.owner_id AND po.proposal_id=p.id
     JOIN contracts ct ON ct.owner_id=c.owner_id AND ct.purchase_order_id=po.id
     JOIN service_orders so ON so.owner_id=c.owner_id AND so.contract_id=ct.id
     WHERE c.owner_id=$1 AND c.id=$2`,[actor,clientId]);
  assert.equal(result.rows.length,1,'the complete commercial chain must survive restore');
  assert.deepEqual(result.rows[0],{
    client_id:clientId,lead_id:leadId,opportunity_id:opportunityId,
    proposal_id:proposalId,po_id:poId,contract_id:contractId,order_id:orderId,
    total:2505000,contract_status:'active',order_status:'draft',
  });
  const migrations=await pool.query(
    "SELECT id FROM _cisne_schema_migrations WHERE id IN ('0000_salty_lilith','0001_native_crm','0002_crm_proposal_origin','0003_nextcrm_document_bridge') ORDER BY id");
  assert.deepEqual(migrations.rows.map(r=>r.id),[
    '0000_salty_lilith','0001_native_crm','0002_crm_proposal_origin','0003_nextcrm_document_bridge',
  ]);
  const fk=await pool.query(
    `SELECT conname FROM pg_constraint
     WHERE conname IN ('crm_opportunity_proposals_owner_opportunity_fk',
       'crm_opportunity_proposals_owner_proposal_fk')`);
  assert.equal(fk.rows.length,2,'tenant-qualified origin foreign keys must restore');
  const tables=await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public'
    AND tablename IN ('nextcrm_erp_identity_mappings',
    'nextcrm_erp_client_account_mappings','nextcrm_order_document_links',
    'nextcrm_order_document_events')`);
  assert.equal(tables.rows.length,4,'NextCRM approved mappings and immutable audit tables must restore');
  const guards=await pool.query(`SELECT tgname FROM pg_trigger WHERE tgname IN
    ('nextcrm_doc_links_immutable','nextcrm_doc_events_immutable') AND NOT tgisinternal`);
  assert.equal(guards.rows.length,2,'document link immutability triggers must restore');
}

try{
  await seed();
  await src.query('CREATE DATABASE "'+restoreDb+'"');
  created=true;
  docker(['pg_dump','-h','127.0.0.1','-p','5432','-U','cisne_test',
    '-d','cisne_test','--format=custom','--file=/backups/cisne.dump']);
  docker(['pg_restore','-h','127.0.0.1','-p','5432','-U','cisne_test',
    '-d',restoreDb,'--no-owner','--no-privileges','--exit-on-error',
    '/backups/cisne.dump']);
  await verify();
  process.stdout.write('RESTORE_DRILL_SUCCESS: PostgreSQL '+major+' custom-format backup, isolated restore, full CRM-to-OS data, ledger and owner FKs checked\n');
}finally{
  // The restore pool must release every client before dropping its database.
  // FORCE kills idle clients asynchronously and can emit uncaught PG 57P01.
  // Plain DROP fails visibly if cleanup is incomplete (fail closed in CI).
  if(copy)await copy.end();
  if(created)await src.query('DROP DATABASE IF EXISTS "'+restoreDb+'"');
  const client=await src.connect();
  try{
    await client.query('BEGIN');
    await client.query('DELETE FROM service_orders WHERE id=$1',[orderId]);
    await client.query('DELETE FROM contracts WHERE id=$1',[contractId]);
    await client.query('DELETE FROM purchase_orders WHERE id=$1',[poId]);
    await client.query('DELETE FROM crm_opportunity_proposals WHERE owner_id=$1',[actor]);
    await client.query('DELETE FROM proposal_lines WHERE proposal_id=$1',[proposalId]);
    await client.query('DELETE FROM proposals WHERE id=$1',[proposalId]);
    await client.query('DELETE FROM crm_opportunities WHERE id=$1',[opportunityId]);
    await client.query('DELETE FROM crm_leads WHERE id=$1',[leadId]);
    await client.query('DELETE FROM clients WHERE id=$1',[clientId]);
    await client.query('COMMIT');
  }catch(err){await client.query('ROLLBACK');throw err;}
  finally{client.release();await src.end();await rm(folder,{recursive:true,force:true});}
}
