// CI-only real Chromium journey. No Railway data, auth-code changes or login shortcuts.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {issueStagingSession,CISNE_STAGING_COOKIE} from '../lib/api/staging-session.mjs';

const origin='https://cisne-web-staging-staging.up.railway.app',host=new URL(origin).hostname;
const actor='ci-enterprise-browser-20261118';
const db=new URL(process.env.DATABASE_URL??'about:blank');
if(process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true'||
  db.hostname!=='127.0.0.1'||db.port!=='5432'||db.pathname!=='/cisne_ci'||
  process.env.CISNE_STAGING_ACTOR_ID!==actor||
  process.env.CISNE_STAGING_PUBLIC_ORIGIN!==origin)
  throw Error('FIELD_BROWSER_NO_GO: disposable CI database and canonical origin required');
const key=process.env.CISNE_STAGING_SESSION_SECRET;
if(!key||key.length<32)throw Error('FIELD_BROWSER_NO_GO: disposable session key required');
const path=process.env.PLAYWRIGHT_MODULE_PATH;
if(!path?.startsWith('/tmp/field-browser/'))
  throw Error('FIELD_BROWSER_NO_GO: CI Playwright module unavailable');
const {chromium}=await import(path);
await mkdir('artifacts/field-browser',{recursive:true});
let browser,context,page,phase='init',passed=false;
const events=[],consoleErrors=[];
function log(step,data={}){events.push({step,...data});}
function verified(result,status,step){
  assert.equal(result.status,status,step+' HTTP '+result.status+' '+JSON.stringify(result.data));
  assert.ok(result.correlationId,step+' missing request correlation');
  log(step,{httpStatus:result.status,correlationId:result.correlationId});
  return result.data;
}
try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',
    viewport:{width:1440,height:900},locale:'pt-BR'});
  // Browser sees canonical HTTPS Origin; every byte comes from CI localhost.
  // Aborts noncanonical requests instead of risking a public staging mutation.
  await context.route('**/*',async route=>{
    const u=new URL(route.request().url());
    if(u.protocol!=='https:'||u.hostname!==host||u.port){
      await route.abort('blockedbyclient');return;
    }
    await route.continue({url:'https://127.0.0.1:9443'+u.pathname+u.search});
  });
  await context.addCookies([{name:CISNE_STAGING_COOKIE,
    value:issueStagingSession(actor,key),domain:host,path:'/',
    secure:true,httpOnly:true,sameSite:'Lax'}]);
  await context.tracing.start({screenshots:true,snapshots:true,sources:true});
  page=await context.newPage();
  page.on('pageerror',error=>consoleErrors.push({kind:'pageerror',message:error.message.slice(0,250)}));
  page.on('console',message=>{if(message.type()==='error')
    consoleErrors.push({kind:'console',message:message.text().slice(0,250)});});
  async function module(name){
    phase='module:'+name;
    const response=await page.goto(origin+'/#'+encodeURIComponent(name),
      {waitUntil:'domcontentloaded',timeout:45000});
    assert.equal(response?.status(),200);
    await page.getByRole('heading',{name,exact:true}).first().waitFor({timeout:30000});
    assert.equal(new URL(page.url()).origin,origin);
    log('navigation',{module:name,httpStatus:200});
  }
  async function api(url,method='GET',body){
    return page.evaluate(async input=>{
      const response=await fetch(input.url,{
        method:input.method,
        headers:input.body===undefined?undefined:{'Content-Type':'application/json'},
        body:input.body===undefined?undefined:JSON.stringify(input.body),
        cache:'no-store',
      });
      const data=await response.json().catch(()=>({}));
      return {status:response.status,data,
        correlationId:response.headers.get('X-Correlation-Id')??data.correlationId??null};
    },{url,method,body});
  }
  const suffix=randomUUID().slice(0,8),company='Empresa CI '+suffix;
  const staff='Técnico CI '+suffix,orderTitle='OS CI Navegador '+suffix;
  const date=new Date().toISOString().slice(0,10);
  const start=new Date(Date.now()+7*86400000);
  const end=new Date(start.getTime()+7200000);

  await module('Clientes e propostas');
  phase='UI create client';
  await page.getByRole('button',{name:'Cadastrar cliente'}).click();
  const dialog=page.getByRole('dialog',{name:'Cadastrar cliente'});
  await dialog.locator('input[name="legalName"]').fill(company);
  await dialog.getByRole('button',{name:'Salvar cadastro'}).click();
  await page.getByRole('button',{name:company,exact:true}).first().waitFor({timeout:20000});
  const clientList=verified(await api('/api/clients?q='+encodeURIComponent(company)),200,'client persisted');
  const client=clientList.items.find(item=>item.legalName===company);
  assert.ok(client?.id,'UI client not persisted');

  await module('Pessoas e equipes');
  phase='UI create staff';
  const form=page.locator('form.module-workspace');
  await form.locator('input[name="fullName"]').fill(staff);
  await form.locator('input[name="specialty"]').fill('Operações de campo');
  await form.getByRole('button',{name:'Salvar profissional'}).click();
  await page.getByText(staff,{exact:true}).first().waitFor({timeout:20000});
  const people=verified(await api('/api/field/people?q='+encodeURIComponent(staff)),200,'staff persisted');
  const person=people.items.find(item=>item.fullName===staff);
  assert.ok(person?.id,'UI staff not persisted');

  await module('Ordens de serviço');
  phase='UI create order';
  await page.getByRole('button',{name:'Nova ordem de serviço'}).click();
  await page.getByLabel('Pesquisar Cliente persistido').fill(company);
  await page.getByRole('group',{name:'Clientes encontrados'}).getByRole('button')
    .filter({hasText:company}).first().click();
  await page.getByRole('button',{name:'Preparar operação'}).click();
  await page.getByLabel('Título da operação').fill(orderTitle);
  await page.getByLabel('Atividade da operação').selectOption({index:1});
  await page.getByLabel('Serviço do catálogo empresarial').selectOption({index:1});
  await page.getByLabel('Escopo operacional').fill('Execução CI com rastreabilidade da OS até liquidação.');
  await page.getByRole('button',{name:'Revisar preparação'}).click();
  const responsePromise=page.waitForResponse(res=>
    res.request().method()==='POST'&&new URL(res.url()).pathname==='/api/orders',
    {timeout:30000});
  await page.locator('.order-preparation button[type="submit"]').last().click();
  const response=await responsePromise;
  const created=await response.json();
  assert.equal(response.status(),201,JSON.stringify(created));
  const orderId=created.resource?.id??created.id;
  assert.match(orderId??'',/^[a-f0-9-]{36}$/);
  log('order created through UI',{orderId,correlationId:created.correlationId});

  phase='Planning and persisted UI';
  const planning='/api/orders/'+orderId+'/planning';
  verified(await api(planning,'POST',{key:randomUUID(),command:'set_schedule',
    expectedVersion:0,startsAt:start.toISOString(),endsAt:end.toISOString(),
    location:'Oficina CI'}),201,'schedule created');
  verified(await api(planning,'POST',{key:randomUUID(),command:'assign_person',
    personId:person.id}),201,'staff assigned');
  const changed=new Date(start.getTime()+900000);
  verified(await api(planning,'POST',{key:randomUUID(),command:'set_schedule',
    expectedVersion:1,startsAt:changed.toISOString(),endsAt:end.toISOString(),
    location:'Oficina CI'}),201,'schedule updated');
  const schedule=verified(await api('/api/schedules'),200,'agenda checked');
  assert.ok(schedule.items.some(row=>row.orderId===orderId&&row.assignedCount===1&&
    new Date(row.startsAt).getTime()===changed.getTime()));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Ordens de serviço'}).waitFor();
  await page.getByText(orderTitle,{exact:true}).first().waitFor({timeout:20000});
  await page.screenshot({path:'artifacts/field-browser/operational.png',fullPage:true});

  phase='Execution and finance';
  const command=async(id,version,name,extra={})=>verified(await api('/api/commands','POST',{
    id,version,key:randomUUID(),command:name,...extra,
  }),201,'command '+name);
  await command(orderId,1,'authorize');
  await command(orderId,2,'start');
  const execution='/api/orders/'+orderId+'/execution';
  const reported=verified(await api(execution,'POST',{
    command:'report',key:randomUUID(),version:3,resourceKind:'labor',
    description:'Serviço de campo realizado',quantity:'2,5',unit:'h',
    resourceReference:null,effectiveDate:date,reference:'CI-EXEC-'+suffix,
  }),201,'execution fact');
  const filtered=verified(await api(execution+'?q=&page=1&pageSize=25&state=all'),
    200,'UI execution filter');
  assert.ok(filtered.items.some(row=>row.id===reported.resource.id));
  await command(orderId,3,'complete');
  const measured=await command(orderId,4,'measure',{
    description:'Produção operacional homologada',amount:'12,5000'});
  await command(measured.resource.id,1,'approve_measurement');
  const invoice=await command(measured.resource.id,2,'invoice',{dueDate:'2026-12-31'});
  const receivableId=invoice.resource.receivableId;
  assert.ok(receivableId);
  const settlement='/api/finance/receivables/settlements';
  const part={receivableId,amount:'50000',effectiveDate:date,reference:'CI partial',commandKey:randomUUID()};
  verified(await api(settlement,'POST',part),201,'partial settlement');
  assert.equal(verified(await api(settlement,'POST',part),200,'settlement replay').replayed,true);
  verified(await api(settlement,'POST',{receivableId,amount:'75000',
    effectiveDate:date,reference:'CI balance',commandKey:randomUUID()}),201,'final settlement');
  const auditPath='/api/orders/'+orderId+'/reconciliation';
  const check=verified(await api(auditPath),200,'owned financial reconciliation');
  assert.equal(check.status,'CONSISTENT');
  assert.equal(check.amountsScaled.outstanding,'0');
  assert.equal(check.accounting.status,'NOT_TESTED');
  const repeated=await api('/api/commands','POST',{id:measured.resource.id,version:3,
    key:randomUUID(),command:'invoice',dueDate:'2026-12-31'});
  assert.equal(repeated.status,409,'Invoice repetition must fail');
  log('invoice conflict rejected',{httpStatus:409,correlationId:repeated.correlationId});
  await module('Financeiro');
  await page.reload({waitUntil:'domcontentloaded'});
  assert.equal(verified(await api(auditPath),200,'after reload persisted').status,'CONSISTENT');
  await page.screenshot({path:'artifacts/field-browser/finance.png',fullPage:true});
  assert.deepEqual(consoleErrors.filter(x=>x.kind==='pageerror'),[],
    'Unexpected JS exception');
  log('completed',{orderId,measurementId:measured.resource.id,
    invoiceId:invoice.resource.id,receivableId,sourceSha:process.env.GITHUB_SHA??null,
    scope:'Client + staff + OS via UI; later business mutations via real browser HTTP',
    nextcrmDocuments:'NOT_TESTED',accounting:'NOT_TESTED'});
  passed=true;
  console.log('FIELD_CHROMIUM_CI_BUSINESS_JOURNEY_SUCCESS');
}catch(error){
  log('failure',{phase,message:String(error).slice(0,700)});
  if(page)await page.screenshot({path:'artifacts/field-browser/failure.png',
    fullPage:true}).catch(()=>{});
  throw error;
}finally{
  if(context)await context.tracing.stop({path:'artifacts/field-browser/trace.zip'}).catch(()=>{});
  if(browser)await browser.close();
  await writeFile('artifacts/field-browser/evidence.json',JSON.stringify({
    passed,phase,sourceSha:process.env.GITHUB_SHA??null,
    isolation:'GitHub Actions disposable PostgreSQL, loopback HTTPS only',
    events,consoleErrors,
  },null,2));
}
