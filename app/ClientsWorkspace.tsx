'use client';
import { EnterpriseListReportFilters } from './components/enterprise/EnterpriseListReportFilters';
import { EnterpriseDataGrid } from './components/enterprise/EnterprisePrimitives';
import { EnterpriseButton, EnterpriseInput, EnterpriseTextarea,} from './components/enterprise/EnterprisePrimitives';
import {useCallback,useEffect,useRef,useState} from 'react';
import {EnterprisePageHeader, EnterpriseErrorBoundary, EnterpriseDialog, EnterpriseObjectPage, EnterpriseSearchField, EnterpriseSelectField, BusinessObjectHeader, ObjectSection} from './components/enterprise/EnterprisePrimitives';
import {Plus,RefreshCw,X} from 'lucide-react';
import type {ClientFields} from '../lib/domain/clients';
import { changedProfileFields } from '../lib/integrations/nextcrm/changed-profile-fields';
export type Client={id:string;legalName:string;tradeName:string|null;document:string|null;email:string|null;phone:string|null;state:{code:'active'|'inactive';label:string;rowVersion:number};availableCommands:{id:string;label:string;expectedVersion:number}[]};
type Context=Client&{related:{orders:{total:number};proposals:{id:string;title:string;status:string;validUntil:string;total:number}[];contracts:{id:string;reference:string;status:string;startsOn:string;endsOn:string|null}[]};history:{command:string;createdAt:string}[];warnings:string[]};
type NextcrmProfile={
 name:string|null;officePhone:string|null;website:string|null;fax:string|null;companyId:string|null;vat:string|null;email:string|null;
 billingStreet:string|null;billingPostalCode:string|null;billingCity:string|null;billingState:string|null;billingCountry:string|null;
 shippingStreet:string|null;shippingPostalCode:string|null;shippingCity:string|null;shippingState:string|null;shippingCountry:string|null;
 description:string|null;annualRevenue:string|null;memberOf:string|null;industry:string|null;pricelistId:string|null;status:string|null;type:string|null;
};
type NextcrmContext={mapped:boolean;state:'synchronized'|'not_linked'|'not_configured'|'unavailable'|'invalid';message?:string;profile?:NextcrmProfile|null;mapping?:{accountId:string;instanceKey:string;verifiedAt:string}};
type List={items:Client[];pageInfo:{total:number;sourceTotal:number;hasMore:boolean}};
function ClientsWorkspace({onCreateOrder,onOrders,onProposal,onContract,initialId=''}:{onCreateOrder:(client:Client)=>void;onOrders:(id:string)=>void;onProposal:(id:string)=>void;onContract:(id:string)=>void;initialId?:string}){
 const [result,setResult]=useState<List|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[q,setQ]=useState(''),[status,setStatus]=useState(''),[page,setPage]=useState(1),[sort,setSort]=useState<'name.asc'|'name.desc'|'recent'>('name.asc'),[context,setContext]=useState<Context|null>(null),[contextLoading,setContextLoading]=useState(false),[contextError,setContextError]=useState(''),[nextcrm,setNextcrm]=useState<NextcrmContext|null>(null),[nextcrmLoading,setNextcrmLoading]=useState(false),[nextcrmError,setNextcrmError]=useState(''),[dialog,setDialog]=useState<{key:string;client:Client|null}|null>(null),[saving,setSaving]=useState(false),[commandError,setCommandError]=useState(''),[crmEditing,setCrmEditing]=useState(false);
 const generation=useRef(0),busy=useRef(false),panel=useRef<HTMLElement>(null),commandAttempt=useRef<{key:string;body:string}|null>(null),initialHandled=useRef('');
 const load=useCallback(async()=>{const g=++generation.current;setLoading(true);setError('');try{const r=await fetch('/api/clients?'+new URLSearchParams({q,...(status?{status}:{}),page:String(page),pageSize:'25',sort}));const d=await r.json() as List&{error?:string};if(!r.ok)throw new Error(d.error);if(g===generation.current)setResult(d);}catch(e){if(g===generation.current)setError(e instanceof Error?e.message:'Consulta indisponível.');}finally{if(g===generation.current)setLoading(false);}},[q,status,page,sort]);
 useEffect(()=>{const t=setTimeout(()=>void load(),150);return()=>{clearTimeout(t);};},[load]);
 useEffect(()=>{if(!dialog&&!crmEditing)return;const before=document.activeElement as HTMLElement|null;const node=panel.current;node?.querySelector<HTMLElement>('input,button')?.focus();function key(e:KeyboardEvent){if(e.key==='Escape'&&!busy.current){setDialog(null);setContext(null);}if(e.key!=='Tab')return;const nodes=node?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select');if(!nodes?.length)return;const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);before?.focus();};},[dialog,crmEditing]);
 const open=useCallback(async(id:string)=>{
  setContextLoading(true);setNextcrmLoading(true);setContextError('');setNextcrmError('');setNextcrm(null);setCommandError('');
  try{
   const contextResponse=await fetch('/api/clients/'+encodeURIComponent(id),{cache:'no-store'});
   const d=await contextResponse.json() as {projection:Context;error?:string};
   if(!contextResponse.ok)throw new Error(d.error);
   setContext(d.projection);
  }catch(e){
   setContextError(e instanceof Error?e.message:'Contexto indisponível.');
   setContextLoading(false);setNextcrmLoading(false);return;
  }
  setContextLoading(false);
  try{
   const nextcrmResponse=await fetch('/api/clients/'+encodeURIComponent(id)+'/nextcrm',{cache:'no-store'});
   const n=await nextcrmResponse.json() as NextcrmContext&{error?:string};
   if(!nextcrmResponse.ok)throw new Error(n.error||'Contexto NextCRM indisponível.');
   setNextcrm(n);
  }catch(e){
   const message=e instanceof Error?e.message:'Integração NextCRM indisponível.';
   setNextcrmError(message);
   setNextcrm({mapped:false,state:'unavailable',message:'O cadastro ERP continua operacional; ações dependentes do NextCRM ficam indisponíveis até a integração ser restaurada.'});
  }finally{setNextcrmLoading(false);}
 },[]);
 useEffect(()=>{if(!initialId){initialHandled.current='';return;}if(initialHandled.current===initialId)return;initialHandled.current=initialId;void open(initialId);},[initialId,open]);
 async function send(url:string,body:object){const encoded=JSON.stringify(body);const prior=commandAttempt.current;if(prior&&prior.body!==encoded)throw new Error('O conteúdo mudou após uma tentativa. Feche e reabra o comando para gerar uma nova chave.');commandAttempt.current={key:(body as {key?:string}).key??'',body:encoded};const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:encoded});const d=await r.json() as {error?:string;data?:unknown};if(!r.ok)throw new Error(d.error);commandAttempt.current=null;return d;}
 async function submit(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();if(busy.current||!dialog)return;busy.current=true;setSaving(true);setCommandError('');
  const f=new FormData(e.currentTarget),nullable=(name:string)=>String(f.get(name)||'').trim()||null;
  const data:ClientFields={legalName:String(f.get('legalName')).trim(),tradeName:nullable('tradeName'),document:nullable('document'),email:nullable('email'),phone:nullable('phone')};
  const crmNames=['officePhone','website','fax','companyId','vat','billingStreet','billingPostalCode','billingCity','billingState','billingCountry','shippingStreet','shippingPostalCode','shippingCity','shippingState','shippingCountry','description','annualRevenue','memberOf'];
  const currentCrmValues=Object.fromEntries(crmNames.map(name=>[name,nullable(name)])) as Record<string,string|null>;
  const priorCrmValues=dialog.client&&nextcrm?.mapped&&nextcrm.profile?nextcrm.profile:{};
  const crmChanges=changedProfileFields(crmNames,currentCrmValues,priorCrmValues);
  const hasCrmData=Object.keys(crmChanges).length>0;
  try{
   await send(dialog.client?'/api/clients/'+dialog.client.id+'/commands':'/api/clients',dialog.client?{key:dialog.key,command:'revise',version:dialog.client.state.rowVersion,data}:{id:dialog.key,data});
   const id=dialog.client?.id??dialog.key;
   if(hasCrmData){
    const crmUrl='/api/clients/'+encodeURIComponent(id)+'/nextcrm/profile';
    const crmMethod=dialog.client&&nextcrm?.mapped?'PATCH':'POST';
    const response=await fetch(crmUrl,{method:crmMethod,headers:{'Content-Type':'application/json'},body:JSON.stringify({key:crypto.randomUUID(),changes:crmChanges})});
    const crmResult=await response.json() as {error?:string};
    if(!response.ok)throw new Error(crmResult.error||'Cadastro ERP salvo, mas os dados CRM não foram confirmados.');
   }
   setDialog(null);await load();await open(id);
  }catch(e){setCommandError(e instanceof Error?e.message:'Falha ao registrar o cadastro.');}
  finally{busy.current=false;setSaving(false);}
 }
 async function changeState(){if(!context||busy.current)return;const c=context.availableCommands.find(c=>c.id==='activate'||c.id==='deactivate');if(!c)return;busy.current=true;setSaving(true);setCommandError('');const key=commandAttempt.current?.key||crypto.randomUUID(),body={key,command:c.id,version:c.expectedVersion};commandAttempt.current={key,body:JSON.stringify(body)};try{await send('/api/clients/'+context.id+'/commands',body);await open(context.id);await load();}catch(e){setCommandError(e instanceof Error?e.message:'Falha no comando.');}finally{busy.current=false;setSaving(false);}}
 async function linkNextcrm(){
  if(!context||busy.current||nextcrm?.mapped)return;
  busy.current=true;setSaving(true);setCommandError('');
  try{
   const response=await fetch('/api/clients/'+encodeURIComponent(context.id)+'/nextcrm',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({key:crypto.randomUUID()}),
   });
   const data=await response.json() as {error?:string};
   if(!response.ok)throw new Error(data.error||'Não foi possível vincular a conta NextCRM.');
   await open(context.id);await load();
  }catch(e){setCommandError(e instanceof Error?e.message:'Não foi possível vincular a conta NextCRM.');}
  finally{busy.current=false;setSaving(false);}
 }
 function edit(client:Client|null){commandAttempt.current=null;setCommandError('');setDialog({key:crypto.randomUUID(),client});}
 async function submitCrm(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();
  if(!context||busy.current||!nextcrm?.profile)return;
  busy.current=true;setSaving(true);setCommandError('');
  const f=new FormData(e.currentTarget);
  const changes:Record<string,string|null>={};
  const profile=nextcrm.profile;
  for(const name of ['officePhone','website','fax','email','billingStreet','billingPostalCode','billingCity','billingState','billingCountry','shippingStreet','shippingPostalCode','shippingCity','shippingState','shippingCountry','description','annualRevenue','memberOf','vat','companyId']){
   const raw=f.get(name);
   if(raw===null)continue;
   const value=String(raw).trim();
   const current=value||null;
   const previous=profile[name as keyof NextcrmProfile] ?? null;
   if(current!==previous)changes[name]=current;
  }
  if(!Object.keys(changes).length){setCrmEditing(false);busy.current=false;setSaving(false);return;}
  try{
   const response=await fetch('/api/clients/'+encodeURIComponent(context.id)+'/nextcrm/profile',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:crypto.randomUUID(),changes})});
   const data=await response.json() as {error?:string};
   if(!response.ok)throw new Error(data.error||'Não foi possível atualizar os dados CRM.');
   setCrmEditing(false);await open(context.id);
  }catch(e){setCommandError(e instanceof Error?e.message:'Falha ao atualizar os dados CRM.');}
  finally{busy.current=false;setSaving(false);}
 }
 return <section className="worklist"><header className="list-title"><div><span className="eyebrow">CLIENTES · CADASTRO OPERACIONAL</span><h2>Clientes</h2><p>Cadastro persistente e ordens vinculadas. Contatos ausentes permanecem não informados.</p></div><div className="command-buttons"><EnterpriseButton type="button" className="secondary" onClick={()=>void load()} disabled={loading}><RefreshCw size={16}/>Atualizar</EnterpriseButton><EnterpriseButton type="button" className="primary" onClick={()=>edit(null)}><Plus size={16}/>Cadastrar cliente</EnterpriseButton></div></header><EnterpriseListReportFilters
   label="Filtros de clientes"
   count={!loading && !error ? result?.pageInfo.total : undefined}
   onClear={() => { setQ(''); setStatus(''); setSort('name.asc'); setPage(1); }}
 ><EnterpriseSearchField label="Buscar clientes" placeholder="Razão social, nome ou documento" value={q} onValueChange={value=>{setQ(value);setPage(1);}}/><EnterpriseSelectField label="Situação do cliente" className="select-filter" value={status} onValueChange={value=>{setStatus(value);setPage(1);}} options={[{value:"",label:"Todas as situações"},{value:"active",label:"Ativos"},{value:"inactive",label:"Inativos"}]}/><EnterpriseSelectField label="Ordenar clientes" className="select-filter" value={sort} onValueChange={value=>{setSort(value as typeof sort);setPage(1);}} options={[{value:"name.asc",label:"Nome crescente"},{value:"name.desc",label:"Nome decrescente"},{value:"recent",label:"Mais recentes"}]}/></EnterpriseListReportFilters>{loading?<div className="empty" role="status">Consultando clientes…</div>:error?<div className="empty" role="alert"><p>{error}</p><EnterpriseButton type="button" className="secondary" onClick={()=>void load()}>Tentar novamente</EnterpriseButton></div>:result?.items.length?<EnterpriseDataGrid<Client>
   caption="Lista de clientes"
   rows={result.items}
   getRowKey={(item) => item.id}
   columns={[
      { key: 'client', header: 'Cliente', render: (item) => <div className="enterprise-list-primary"><EnterpriseButton type="button" className="row-link" onClick={() => void open(item.id)}>{item.legalName}</EnterpriseButton><small>{item.tradeName ?? 'Nome fantasia não informado'}</small></div> },
      { key: 'document', header: 'Documento informado', render: (item) => item.document ?? 'Não informado' },
      { key: 'contact', header: 'Contato', render: (item) => item.email ?? item.phone ?? 'Não informado' },
      { key: 'status', header: 'Situação', render: (item) => <span className="badge">{item.state.label}</span> },
    ]}
 />:<div className="empty"><h3>{result?.pageInfo.sourceTotal?'Nenhum cliente nesta consulta':'Nenhum cliente cadastrado'}</h3><p>{result?.pageInfo.sourceTotal?'Ajuste os filtros para retomar os clientes.':'Cadastre o cliente para criar ordens com vínculo rastreável.'}</p></div>}<footer className="table-footer"><span>{loading||error?'Resultado indisponível':`${result?.pageInfo.total??'—'} clientes · página ${page}`}</span><div className="pagination"><EnterpriseButton type="button" disabled={loading||!!error||page===1} onClick={()=>setPage(n=>n-1)}>Anterior</EnterpriseButton><EnterpriseButton type="button" disabled={loading||!!error||!result?.pageInfo.hasMore} onClick={()=>setPage(n=>n+1)}>Próxima</EnterpriseButton></div></footer>{contextLoading&&<p role="status" className="linked-info">Consultando contexto…</p>}{contextError&&<p className="form-error" role="alert">{contextError}</p>}
 {context&&!dialog&&<EnterpriseObjectPage title={'Cliente '+context.legalName} header={<BusinessObjectHeader type="CLIENTE" title={context.legalName} reference={context.document??undefined} description={context.tradeName??undefined} facts={<span>{context.state.label} · {nextcrmLoading?'Consultando NextCRM':nextcrm?.mapped?'NextCRM vinculado':'Vínculo CRM não confirmado'}</span>} actions={<EnterpriseButton type="button" className="secondary" onClick={()=>{setContext(null);commandAttempt.current=null;}}>Voltar à lista</EnterpriseButton>}/>} sections={[{id:'client-identification',label:'Identificação'},{id:'client-crm',label:'NextCRM'},{id:'client-commercial',label:'Comercial'},{id:'client-orders',label:'Ordens de serviço'},{id:'client-history',label:'Histórico'}]}><ObjectSection id="client-identification" title="Identificação e contato"><dl>{[['Nome fantasia',context.tradeName],['Documento informado',context.document],['E-mail',context.email],['Telefone',context.phone]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value??'Não informado'}</dd></div>)}</dl><div className="command-buttons">{context.availableCommands.some(c=>c.id==='revise')&&<EnterpriseButton type="button" className="secondary" disabled={saving} onClick={()=>edit(context)}>Atualizar cadastro</EnterpriseButton>}<EnterpriseButton type="button" className="secondary" disabled={saving} onClick={()=>void changeState()}>{saving?'Executando…':context.availableCommands.find(c=>c.id!=='revise')?.label}</EnterpriseButton>{context.state.code==='active'&&<EnterpriseButton type="button" className="primary" disabled={saving} onClick={()=>onCreateOrder(context)}>Criar ordem de serviço</EnterpriseButton>}{nextcrm?.state==='not_linked'&&<EnterpriseButton type="button" className="secondary" disabled={saving} onClick={()=>void linkNextcrm()}>{saving?'Vinculando…':'Vincular conta NextCRM'}</EnterpriseButton>}</div>{commandError&&<div role="alert" className="form-error">{commandError}<EnterpriseButton type="button" className="text-button" disabled={saving} onClick={()=>{commandAttempt.current=null;void open(context.id);}}>Atualizar contexto</EnterpriseButton></div>}</ObjectSection><ObjectSection id="client-crm" title="Integração NextCRM">{nextcrmLoading?<p role="status" className="linked-info">Consultando vínculo aprovado…</p>:nextcrm?.mapped?<div className="linked-info"><strong>Cliente sincronizado com o NextCRM</strong><small>Conta {nextcrm.mapping?.accountId.slice(0,8).toUpperCase()} · instância {nextcrm.mapping?.instanceKey} · verificado em {new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Porto_Velho',dateStyle:'short',timeStyle:'short'}).format(new Date(nextcrm.mapping!.verifiedAt))}</small></div>:<div className="linked-info"><strong>{nextcrm?.state==='unavailable'?'NextCRM indisponível — ERP continua operacional':'Cliente sem vínculo NextCRM'}</strong><small>{nextcrm?.message??'O vínculo aprovado ainda não está disponível para este contexto.'}</small>{nextcrmError&&<small>{nextcrmError}</small>}</div>}{nextcrm?.mapped&&nextcrm.profile&&<section className="crm-profile" aria-label="Perfil empresarial NextCRM">
<h3>Dados empresariais NextCRM</h3><EnterpriseButton type="button" className="secondary" disabled={saving} onClick={()=>{setCommandError('');setCrmEditing(true);}}>Editar dados CRM</EnterpriseButton>
<div className="profile-section"><strong>Identificação CRM</strong><dl>
{[['Conta',nextcrm.profile.name],['Tipo',nextcrm.profile.type],['Documento fiscal',nextcrm.profile.vat??nextcrm.profile.companyId],['Situação',nextcrm.profile.status],['Setor',nextcrm.profile.industry]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value??'Não informado'}</dd></div>)}
</dl></div>
<div className="profile-section"><strong>Contato e comunicação</strong><dl>
{[['E-mail',nextcrm.profile.email],['Telefone comercial',nextcrm.profile.officePhone],['Fax',nextcrm.profile.fax],['Website',nextcrm.profile.website]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value??'Não informado'}</dd></div>)}
</dl></div>
<div className="profile-section"><strong>Endereço de cobrança</strong><dl>
{[['Logradouro',nextcrm.profile.billingStreet],['CEP',nextcrm.profile.billingPostalCode],['Cidade',nextcrm.profile.billingCity],['Estado',nextcrm.profile.billingState],['País',nextcrm.profile.billingCountry]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value??'Não informado'}</dd></div>)}
</dl></div>
<div className="profile-section"><strong>Endereço de entrega</strong><dl>
{[['Logradouro',nextcrm.profile.shippingStreet],['CEP',nextcrm.profile.shippingPostalCode],['Cidade',nextcrm.profile.shippingCity],['Estado',nextcrm.profile.shippingState],['País',nextcrm.profile.shippingCountry]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value??'Não informado'}</dd></div>)}
</dl></div>
<div className="profile-section"><strong>Perfil comercial</strong><dl>
{[['Receita anual',nextcrm.profile.annualRevenue],['Empresa relacionada',nextcrm.profile.memberOf],['Descrição',nextcrm.profile.description]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value??'Não informado'}</dd></div>)}
</dl></div>
</section>}</ObjectSection><ObjectSection id="client-commercial" title="Propostas e contratos relacionados"><div className="client-related-grid"><section aria-label="Propostas do cliente"><h4>Propostas · {context.related.proposals.length}{context.related.proposals.length===20?' ou mais':''}</h4>{context.related.proposals.length?context.related.proposals.map(proposal=><EnterpriseButton type="button" className="related" key={proposal.id} onClick={()=>onProposal(proposal.id)}><span><strong>{proposal.title}</strong><small>{{draft:'Rascunho',issued:'Emitida',accepted:'Aceita',rejected:'Rejeitada',expired:'Expirada',cancelled:'Cancelada'}[proposal.status]??proposal.status} · validade {proposal.validUntil||'não informada'}</small></span><span aria-hidden="true">↗</span></EnterpriseButton>):<p className="enterprise-muted">Nenhuma proposta retornada para este cliente.</p>}</section><section aria-label="Contratos do cliente"><h4>Contratos · {context.related.contracts.length}{context.related.contracts.length===20?' ou mais':''}</h4>{context.related.contracts.length?context.related.contracts.map(contract=><EnterpriseButton type="button" className="related" key={contract.id} onClick={()=>onContract(contract.id)}><span><strong>{contract.reference}</strong><small>{{draft:'Rascunho',active:'Ativo',closed:'Encerrado',cancelled:'Cancelado'}[contract.status]??contract.status} · início {contract.startsOn||'não informado'}</small></span><span aria-hidden="true">↗</span></EnterpriseButton>):<p className="enterprise-muted">Nenhum contrato retornado para este cliente.</p>}</section></div></ObjectSection><ObjectSection id="client-orders" title="Ordens de serviço relacionadas"><EnterpriseButton type="button" className="related" onClick={()=>onOrders(context.id)}><span><strong>Ordens de serviço</strong><small>{context.related.orders.total} ordens vinculadas · abrir lista filtrada</small></span><span aria-hidden="true">↗</span></EnterpriseButton></ObjectSection><ObjectSection id="client-history" title="Histórico recente · até 20 comandos">{context.history.map((entry,i)=><div key={i} className="event-row"><span>{{register:'Cadastro registrado',revise:'Cadastro atualizado',activate:'Cliente ativado',deactivate:'Cliente desativado'}[entry.command]??entry.command}</span><small>{new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Porto_Velho',dateStyle:'short',timeStyle:'short'}).format(new Date(entry.createdAt))}</small></div>)}{context.warnings.map(w=><p className="linked-info" key={w}>{w}</p>)}</ObjectSection></EnterpriseObjectPage>}
 {crmEditing&&context&&nextcrm?.profile&&<EnterpriseDialog open={crmEditing} ariaLabel="Editar dados CRM" onDismiss={()=>{setCrmEditing(false);commandAttempt.current=null;}}><section ref={panel} className="modal"><header><h2>Editar dados CRM</h2><EnterpriseButton type="button" className="icon-button" disabled={saving} aria-label="Fechar edição CRM" onClick={()=>{setCrmEditing(false);commandAttempt.current=null;}}><X size={20}/></EnterpriseButton></header><form onSubmit={submitCrm}><h3>Contato</h3><label>Telefone comercial<EnterpriseInput name="officePhone" defaultValue={nextcrm.profile.officePhone??''} maxLength={200}/></label><label>Website<EnterpriseInput name="website" defaultValue={nextcrm.profile.website??''} maxLength={200}/></label><label>E-mail<EnterpriseInput type="email" name="email" defaultValue={nextcrm.profile.email??''} maxLength={254}/></label><h3>Endereço de cobrança</h3><label>Logradouro<EnterpriseInput name="billingStreet" defaultValue={nextcrm.profile.billingStreet??''} maxLength={500}/></label><label>CEP<EnterpriseInput name="billingPostalCode" defaultValue={nextcrm.profile.billingPostalCode??''} maxLength={50}/></label><label>Cidade<EnterpriseInput name="billingCity" defaultValue={nextcrm.profile.billingCity??''} maxLength={200}/></label><label>Estado<EnterpriseInput name="billingState" defaultValue={nextcrm.profile.billingState??''} maxLength={100}/></label><label>País<EnterpriseInput name="billingCountry" defaultValue={nextcrm.profile.billingCountry??''} maxLength={100}/></label><h3>Endereço de entrega</h3><label>Logradouro<EnterpriseInput name="shippingStreet" defaultValue={nextcrm.profile.shippingStreet??''} maxLength={500}/></label><label>CEP<EnterpriseInput name="shippingPostalCode" defaultValue={nextcrm.profile.shippingPostalCode??''} maxLength={50}/></label><label>Cidade<EnterpriseInput name="shippingCity" defaultValue={nextcrm.profile.shippingCity??''} maxLength={200}/></label><label>Estado<EnterpriseInput name="shippingState" defaultValue={nextcrm.profile.shippingState??''} maxLength={100}/></label><label>País<EnterpriseInput name="shippingCountry" defaultValue={nextcrm.profile.shippingCountry??''} maxLength={100}/></label><h3>Perfil comercial</h3><label>Descrição<EnterpriseTextarea name="description" defaultValue={nextcrm.profile.description??''} maxLength={500}/></label><label>Receita anual<EnterpriseInput name="annualRevenue" defaultValue={nextcrm.profile.annualRevenue??''} maxLength={100}/></label>{commandError&&<p role="alert" className="form-error">{commandError}</p>}<footer><EnterpriseButton type="button" className="secondary" disabled={saving} onClick={()=>setCrmEditing(false)}>Cancelar</EnterpriseButton><EnterpriseButton type="submit" className="primary" disabled={saving}>{saving?'Salvando…':'Salvar dados CRM'}</EnterpriseButton></footer></form></section></EnterpriseDialog>}
 {dialog&&<EnterpriseDialog open={Boolean(dialog)} ariaLabel={dialog.client?'Atualizar cliente':'Cadastrar cliente'} onDismiss={()=>{setDialog(null);commandAttempt.current=null;}}><section ref={panel} className="modal"><header><h2>{dialog.client?'Atualizar cliente':'Cadastrar cliente'}</h2><EnterpriseButton type="button" className="icon-button" disabled={saving} aria-label="Fechar cadastro" onClick={()=>{setDialog(null);commandAttempt.current=null;}}><X size={20}/></EnterpriseButton></header><form onSubmit={submit} className="client-registration-form">
  <div className="form-section"><span className="eyebrow">CADASTRO ERP</span><h3>Identificação e contato</h3><p>Dados operacionais persistidos no CISNE Field.</p>
   <div className="form-grid">
    <label>Razão social / nome<EnterpriseInput name="legalName" required minLength={2} defaultValue={dialog.client?.legalName??''}/></label>
    <label>Nome fantasia<EnterpriseInput name="tradeName" defaultValue={dialog.client?.tradeName??''}/></label>
    <label>Documento informado<EnterpriseInput name="document" defaultValue={dialog.client?.document??''}/></label>
    <label>E-mail<EnterpriseInput type="email" name="email" defaultValue={dialog.client?.email??''}/></label>
    <label>Telefone<EnterpriseInput name="phone" defaultValue={dialog.client?.phone??''}/></label>
   </div>
  </div>
  <div className="form-section"><span className="eyebrow">PERFIL CRM</span><h3>Dados empresariais do NextCRM</h3><p>Quando houver contexto autorizado, estes dados são gravados na conta CRM real vinculada ao cliente.</p>
   <div className="form-grid">
    <label>Telefone comercial<EnterpriseInput name="officePhone" defaultValue={nextcrm?.profile?.officePhone??''}/></label>
    <label>Website<EnterpriseInput name="website" type="url" defaultValue={nextcrm?.profile?.website??''}/></label>
    <label>Fax<EnterpriseInput name="fax" defaultValue={nextcrm?.profile?.fax??''}/></label>
    <label>Identificação fiscal CRM<EnterpriseInput name="companyId" defaultValue={nextcrm?.profile?.companyId??''}/></label>
    <label>VAT / inscrição<EnterpriseInput name="vat" defaultValue={nextcrm?.profile?.vat??''}/></label>
    <label>Receita anual<EnterpriseInput name="annualRevenue" defaultValue={nextcrm?.profile?.annualRevenue??''}/></label>
    <label>Empresa relacionada<EnterpriseInput name="memberOf" defaultValue={nextcrm?.profile?.memberOf??''}/></label>
   </div>
  </div>
  <div className="form-section"><span className="eyebrow">ENDEREÇO DE COBRANÇA</span><div className="form-grid">
   <label>Logradouro<EnterpriseInput name="billingStreet" defaultValue={nextcrm?.profile?.billingStreet??''}/></label>
   <label>CEP<EnterpriseInput name="billingPostalCode" defaultValue={nextcrm?.profile?.billingPostalCode??''}/></label>
   <label>Cidade<EnterpriseInput name="billingCity" defaultValue={nextcrm?.profile?.billingCity??''}/></label>
   <label>Estado<EnterpriseInput name="billingState" defaultValue={nextcrm?.profile?.billingState??''}/></label>
   <label>País<EnterpriseInput name="billingCountry" defaultValue={nextcrm?.profile?.billingCountry??''}/></label>
  </div></div>
  <div className="form-section"><span className="eyebrow">ENDEREÇO DE ENTREGA</span><div className="form-grid">
   <label>Logradouro<EnterpriseInput name="shippingStreet" defaultValue={nextcrm?.profile?.shippingStreet??''}/></label>
   <label>CEP<EnterpriseInput name="shippingPostalCode" defaultValue={nextcrm?.profile?.shippingPostalCode??''}/></label>
   <label>Cidade<EnterpriseInput name="shippingCity" defaultValue={nextcrm?.profile?.shippingCity??''}/></label>
   <label>Estado<EnterpriseInput name="shippingState" defaultValue={nextcrm?.profile?.shippingState??''}/></label>
   <label>País<EnterpriseInput name="shippingCountry" defaultValue={nextcrm?.profile?.shippingCountry??''}/></label>
  </div></div>
  <div className="form-section"><span className="eyebrow">CONTEXTO COMERCIAL</span><label>Descrição empresarial<EnterpriseTextarea name="description" rows={4} defaultValue={nextcrm?.profile?.description??''}/></label></div>
  {commandError&&<div role="alert" className="form-error">{commandError}</div>}
  <footer><EnterpriseButton type="button" className="secondary" disabled={saving} onClick={()=>setDialog(null)}>Cancelar</EnterpriseButton><EnterpriseButton type="submit" className="primary" disabled={saving}>{saving?'Salvando cadastro…' :'Salvar cadastro'}</EnterpriseButton></footer>
 </form></section></EnterpriseDialog>}
 </section>;
}

export default function ClientsWorkspaceEnterprise(props: Parameters<typeof ClientsWorkspace>[0]) { return <EnterpriseErrorBoundary><section className="enterprise-module cisne-enterprise-experience"><EnterprisePageHeader eyebrow="CISNE ENTERPRISE EXPERIENCE" title="Gestão de clientes e contas CRM" description="Identidade empresarial, integração NextCRM e ordens vinculadas."/><ClientsWorkspace {...props}/></section></EnterpriseErrorBoundary>; }
