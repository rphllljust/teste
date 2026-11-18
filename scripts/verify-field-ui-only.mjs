// Chromium enterprise journey. Business state advances only through visible UI controls.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {issueStagingSession,CISNE_STAGING_COOKIE} from '../lib/api/staging-session.mjs';

const origin='https://cisne-web-staging-staging.up.railway.app';
const host=new URL(origin).hostname;
const actor='ci-enterprise-ui-only-20261118';
const db=new URL(process.env.DATABASE_URL??'about:blank');
if(process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true'||db.hostname!=='127.0.0.1'||db.port!=='5432'||db.pathname!=='/cisne_ci')
  throw new Error('FIELD_UI_ONLY_NO_GO: disposable PostgreSQL is required');
if(process.env.CISNE_STAGING_ACTOR_ID!==actor||process.env.CISNE_STAGING_PUBLIC_ORIGIN!==origin)
  throw new Error('FIELD_UI_ONLY_NO_GO: canonical staging context is required');
const secret=process.env.CISNE_STAGING_SESSION_SECRET;
if(!secret||secret.length<32)throw new Error('FIELD_UI_ONLY_NO_GO: test session key is required');
const modulePath=process.env.PLAYWRIGHT_MODULE_PATH;
if(!modulePath?.startsWith('/tmp/field-browser/'))throw new Error('FIELD_UI_ONLY_NO_GO: Playwright is unavailable');
const {chromium}=await import(modulePath);

await mkdir('artifacts/field-ui-only',{recursive:true});
const suffix=randomUUID().slice(0,8), company='Empresa UI '+suffix, staff='Técnico UI '+suffix;
const title='OS UI-only '+suffix, location='Oficina UI '+suffix;
const date=new Date().toISOString().slice(0,10);
const start=new Date(Date.now()+7*86400000); const end=new Date(start.getTime()+3600000);
const later=new Date(start.getTime()+1800000);
const events=[]; const consoleErrors=[]; let phase='init',passed=false;
function step(name,extra={}){events.push({name,...extra});}
async function visible(page,text){await page.getByText(text,{exact:true}).first().waitFor({timeout:30000});}
async function nav(page,name,heading=name){await page.getByRole('button',{name,exact:true}).first().click();await page.getByRole('heading',{name:heading,exact:true}).first().waitFor({timeout:30000});step('navigation',{name,heading});}

let browser,context,page;
try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox'],proxy:{server:'http://127.0.0.1:8888'}});
  context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width:1440,height:900},locale:'pt-BR',recordVideo:{dir:'artifacts/field-ui-only'}});
  await context.route('**/*',async route=>{
    const u=new URL(route.request().url());
    if(u.protocol!=='https:'||u.hostname!==host||u.port){await route.abort('blockedbyclient');return;}
    await route.continue();
  });
  await context.addCookies([{name:CISNE_STAGING_COOKIE,value:issueStagingSession(actor,secret),domain:host,path:'/',secure:true,httpOnly:true,sameSite:'Lax'}]);
  await context.tracing.start({screenshots:true,snapshots:true,sources:true});
  page=await context.newPage();
  page.on('pageerror',e=>consoleErrors.push({kind:'pageerror',message:e.message.slice(0,300)}));
  page.on('console',m=>{if(m.type()==='error')consoleErrors.push({kind:'console',message:m.text().slice(0,300)});});
  await page.goto(origin,{waitUntil:'domcontentloaded',timeout:45000});
  await page.getByRole('heading',{name:'Visão operacional',exact:true}).waitFor({timeout:30000});

  phase='create staff'; await nav(page,'Pessoas e equipes');
  await page.locator('input[name="fullName"]').fill(staff);
  await page.locator('input[name="specialty"]').fill('Operações de campo');
  await page.getByRole('button',{name:'Salvar profissional',exact:true}).click(); await visible(page,staff); step('staff created');

  phase='create client'; await nav(page,'Clientes e propostas','Clientes');
  await page.getByRole('button',{name:'Cadastrar cliente',exact:true}).click();
  const clientDialog=page.getByRole('dialog',{name:'Cadastrar cliente'});
  await clientDialog.locator('input[name="legalName"]').fill(company);
  await clientDialog.getByRole('button',{name:'Salvar cadastro',exact:true}).click();
  await visible(page,company); step('client created');

  phase='create order';
  await page.getByRole('dialog',{name:'Contexto do cliente'}).getByRole('button',{name:'Criar ordem de serviço',exact:true}).click();
  await page.getByRole('button',{name:'Preparar operação',exact:true}).click();
  await page.getByLabel('Título da operação').fill(title);
  await page.getByLabel('Atividade da operação').selectOption({index:1});
  await page.getByLabel('Serviço do catálogo empresarial').selectOption({index:1});
  await page.getByLabel('Escopo operacional').fill('Fluxo UI-only com persistência operacional e financeira.');
  await page.getByRole('button',{name:'Revisar preparação',exact:true}).click();
  await page.getByRole('button',{name:/Registrar|Criar|Salvar/}).last().click();
  await visible(page,title); step('order created');

  phase='planning';
  const planning=page.getByRole('region',{name:'Planejamento e equipe da ordem'});
  await planning.locator('input[name="startsAt"]').fill(start.toISOString().slice(0,16));
  await planning.locator('input[name="endsAt"]').fill(end.toISOString().slice(0,16));
  await planning.locator('input[name="location"]').fill(location);
  await planning.getByRole('button',{name:'Registrar agendamento',exact:true}).click();
  await planning.getByText(new RegExp(location)).waitFor();
  await planning.locator('input[placeholder="Localizar profissional"]').fill(staff);
  await planning.getByRole('button',{name:'Buscar',exact:true}).click();
  await planning.locator('select').selectOption({label:`${staff} · Operações de campo`});
  await planning.getByRole('button',{name:'Designar profissional',exact:true}).click();
  await planning.getByText(new RegExp(staff),{exact:false}).first().waitFor();
  await planning.locator('input[name="startsAt"]').fill(later.toISOString().slice(0,16));
  await planning.getByRole('button',{name:'Atualizar agendamento',exact:true}).click();
  await planning.getByText(new RegExp(location)).waitFor(); step('schedule assigned and updated');

  phase='authorize and start';
  const orderContext=page.getByRole('dialog',{name:'Contexto da ordem'});
  await orderContext.getByRole('button',{name:'Autorizar ordem',exact:true}).click();
  await page.getByRole('dialog',{name:'Autorizar ordem'}).getByRole('button',{name:'Confirmar comando',exact:true}).click();
  await page.getByRole('status').getByText('Comando executado. Registros atualizados.',{exact:true}).waitFor();
  await page.getByRole('button',{name:/Ordens registradas/}).click();
  await page.getByRole('button',{name:title,exact:true}).first().click();
  await page.getByRole('dialog',{name:'Contexto da ordem'}).getByRole('button',{name:'Iniciar execução',exact:true}).click();
  await page.getByRole('dialog',{name:'Iniciar execução'}).getByRole('button',{name:'Confirmar comando',exact:true}).click();
  await page.getByRole('status').getByText('Comando executado. Registros atualizados.',{exact:true}).waitFor();
  await page.screenshot({path:'artifacts/field-ui-only/execution-started.png',fullPage:true});
  step('execution started');

  phase='execution'; await nav(page,'Execução');
  await page.getByLabel('Selecionar OS').selectOption({label:`${title} · ${company}`});
  await page.getByRole('button',{name:'Registrar execução',exact:true}).click();
  const execution=page.getByRole('dialog',{name:'Comando de execução'});
  await execution.locator('textarea[name="description"]').fill('Apontamento criado pelo operador UI');
  await execution.locator('input[name="quantity"]').fill('2');
  await execution.locator('input[name="unit"]').fill('h');
  await execution.locator('input[name="effectiveDate"]').fill(date);
  await execution.locator('input[name="reference"]').fill('UI-'+suffix);
  await execution.getByRole('button',{name:'Confirmar comando',exact:true}).click();
  await execution.waitFor({state:'detached'});
  await page.getByRole('row').filter({hasText:'Apontamento criado pelo operador UI'}).waitFor();
  step('execution report created');

  phase='complete'; await page.getByRole('button',{name:'Consultar OS e continuidade',exact:true}).click();
  await page.getByRole('dialog',{name:'Contexto da ordem'}).getByRole('button',{name:'Concluir execução',exact:true}).click();
  await page.getByRole('dialog',{name:'Concluir execução'}).getByRole('button',{name:'Confirmar comando',exact:true}).click();

  phase='measurement'; await page.getByRole('button',{name:'Registrar medição',exact:true}).click();
  const measurement=page.getByRole('region',{name:'Preparar medição'});
  await measurement.getByRole('button',{name:'Informar medição',exact:true}).click();
  await measurement.locator('textarea').fill('Produção medida pelo operador UI');
  await measurement.locator('input').fill('125');
  await measurement.getByRole('button',{name:'Revisar medição',exact:true}).click();
  await measurement.getByRole('button',{name:'Registrar medição',exact:true}).last().click();
  const measurementApproval=page.getByRole('dialog',{name:'Aprovar medição'});
  await measurementApproval.getByRole('button',{name:'Confirmar comando',exact:true}).click();
  await measurementApproval.waitFor({state:'detached'});

  phase='invoice'; await page.getByRole('button',{name:'Gerar cobrança',exact:true}).click();
  const billing=page.getByRole('region',{name:'Preparar cobrança interna'});
  await billing.getByRole('button',{name:'Definir vencimento',exact:true}).click();
  await billing.getByLabel('Vencimento da cobrança').fill('2026-12-31');
  await billing.getByRole('button',{name:'Revisar cobrança',exact:true}).click();
  await billing.getByRole('button',{name:'Gerar cobrança',exact:true}).last().click();
  await nav(page,'Financeiro','Contas a receber');
  await page.getByRole('button',{name:'Consultar título',exact:true}).first().click();
  await page.getByRole('button',{name:'Registrar recebimento',exact:true}).click();
  const settlement=page.getByRole('dialog',{name:'Lançamento financeiro'});
  await settlement.locator('input[name="amount"]').fill('125');
  await settlement.locator('input[name="effectiveDate"]').fill(date);
  await settlement.locator('input[name="reference"]').fill('UI settlement '+suffix);
  await settlement.getByRole('button',{name:'Confirmar comando',exact:true}).click();
  await visible(page,'Liquidado'); step('invoice and settlement created');

  phase='reload'; await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Visão operacional',exact:true}).waitFor({timeout:30000});
  await page.screenshot({path:'artifacts/field-ui-only/persisted.png',fullPage:true});
  assert.deepEqual(consoleErrors.filter(e=>e.kind==='pageerror'),[],'UI-only journey raised page errors');
  passed=true; step('completed',{scope:'all business mutations via visible controls',company,title,staff});
  console.log('FIELD_UI_ONLY_SUCCESS');
}catch(error){
  step('failure',{phase,message:String(error).slice(0,800)});
  if(page)await page.screenshot({path:'artifacts/field-ui-only/failure.png',fullPage:true}).catch(()=>{});
  throw error;
}finally{
  if(context)await context.tracing.stop({path:'artifacts/field-ui-only/trace.zip'}).catch(()=>{});
  if(browser)await browser.close();
  await writeFile('artifacts/field-ui-only/evidence.json',JSON.stringify({passed,phase,sourceSha:process.env.GITHUB_SHA??null,environment:'GitHub Actions isolated CI',isolation:'disposable PostgreSQL + real Chromium',noBusinessApiShortcuts:true,events,consoleErrors},null,2));
}
// The journey advances business state only through visible controls.
// CI evidence is generated from the restored full repository tree.
