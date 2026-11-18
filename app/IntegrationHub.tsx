'use client';

import {useCallback,useEffect,useState} from 'react';
import {ArrowRight,ClipboardList,FileCheck2,Landmark,RefreshCw,ShieldCheck,Unplug,Workflow} from 'lucide-react';
import OrderNextcrmDocuments from './OrderNextcrmDocuments';

type OrderOverview={
 id:string;title:string;client?:string;status:string;version:number;
 relations?:{measurements:number;invoices:number;receivables:number};
 finance?:{measuredScaled:string;invoicedScaled:string;settledScaled:string;outstandingScaled:string;moneyScale:4};
};
type ApiList={orders?:OrderOverview[];error?:string};
type ApiDetail={order?:OrderOverview;error?:string};
type LoadStatus='loading'|'ready'|'unavailable';
type Props={
 onOpenOrder:(id:string)=>void;
 onOpenFinance:(id:string)=>void;
 onOpenCRM:()=>void;
};

function count(value:number|undefined){return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:0;}

export default function IntegrationHub({onOpenOrder,onOpenFinance,onOpenCRM}:Props){
 const [refresh,setRefresh]=useState(0);
 const [status,setStatus]=useState<LoadStatus>('loading');
 const [error,setError]=useState('');
 const [orders,setOrders]=useState<OrderOverview[]>([]);
 const [selectedId,setSelectedId]=useState('');
 const [detail,setDetail]=useState<OrderOverview|null>(null);
 const [detailLoading,setDetailLoading]=useState(false);
 const [detailError,setDetailError]=useState('');

 useEffect(()=>{
  const controller=new AbortController();
  async function load(){
   setStatus('loading');setError('');
   setOrders([]);setDetail(null);
   try{
    const [health,listing]=await Promise.all([
     fetch('/api/health/ready',{cache:'no-store',signal:controller.signal}),
     fetch('/api/orders?page=1&pageSize=30&sort=createdAt.desc',{
      cache:'no-store',credentials:'same-origin',signal:controller.signal,
     }),
    ]);
    if(!health.ok)throw new Error('A prontidão do Field não foi confirmada.');
    const h=await health.json() as {status?:string};
    if(h.status!=='ready')throw new Error('O banco do Field ainda não está pronto.');
    const payload=await listing.json() as ApiList;
    if(!listing.ok||!Array.isArray(payload.orders))
     throw new Error(listing.status===403
      ?'Acesso negado. Entre com sua sessão autorizada para consultar as ordens.'
      :'Não foi possível consultar as ordens de serviço.');
    if(!controller.signal.aborted){
     const valid=payload.orders.filter((item):item is OrderOverview=>
      Boolean(item)&&typeof item.id==='string'&&/^[0-9a-f-]{36}$/i.test(item.id)
      &&typeof item.title==='string');
     setOrders(valid);
     setSelectedId(previous=>valid.some(order=>order.id===previous)?previous:(valid[0]?.id??''));
     setStatus('ready');
    }
   }catch(e){
    if(!controller.signal.aborted){
     setStatus('unavailable');
     setError(e instanceof Error?e.message:'Verificação da integração indisponível.');
    }
   }
  }
  void load();
  return()=>controller.abort();
 },[refresh]);

 useEffect(()=>{
  if(status!=='ready'||!selectedId){setDetail(null);setDetailError('');return;}
  const controller=new AbortController();
  async function loadDetail(){
   setDetailLoading(true);setDetailError('');setDetail(null);
   try{
    const response=await fetch('/api/orders/'+encodeURIComponent(selectedId),{
     credentials:'same-origin',cache:'no-store',signal:controller.signal,
    });
    const payload=await response.json() as ApiDetail;
    if(!response.ok||payload.order?.id!==selectedId)
     throw new Error('Não foi possível confirmar os registros desta OS.');
    if(!controller.signal.aborted)setDetail(payload.order);
   }catch(e){
    if(!controller.signal.aborted)
     setDetailError(e instanceof Error?e.message:'Detalhes indisponíveis.');
   }finally{
    if(!controller.signal.aborted)setDetailLoading(false);
   }
  }
  void loadDetail();
  return()=>controller.abort();
 },[status,selectedId,refresh]);

 const chosen=orders.find(item=>item.id===selectedId);
 const totals=detail?.relations;
 const stages=[
  {label:'Ordem de serviço',value:detail?'Registro confirmado':'Aguardando seleção',ready:!!detail},
  {label:'Medições',value:totals?count(totals.measurements)+' registro(s)':'Aguardando dados',ready:!!totals&&count(totals.measurements)>0},
  {label:'Faturamento',value:totals?count(totals.invoices)+' registro(s)':'Aguardando dados',ready:!!totals&&count(totals.invoices)>0},
  {label:'Títulos a receber',value:totals?count(totals.receivables)+' registro(s)':'Aguardando dados',ready:!!totals&&count(totals.receivables)>0},
 ];

 return <section className="integration-hub" aria-label="Central de integração CISNE e NextCRM" data-testid="integration-hub">
  <header className="integration-hero">
   <div className="integration-hero-copy">
    <span className="integration-eyebrow"><Workflow size={15} aria-hidden="true"/> CISNE · FIELD · NEXTCRM</span>
    <h2>Uma operação, módulos conectados.</h2>
    <p>Consulte a mesma ordem de serviço, seus documentos autorizados no NextCRM e os registros financeiros do Field, sem sair do CISNE.</p>
   </div>
   <div className="integration-hero-actions">
    <span className={'integration-connection integration-connection-'+status} role="status" aria-live="polite">
     {status==='ready'?'Field e banco disponíveis':status==='loading'?'Verificando conexão':'Conexão não comprovada'}
    </span>
    <button type="button" className="integration-refresh" disabled={status==='loading'}
      onClick={()=>setRefresh(v=>v+1)}><RefreshCw size={16} aria-hidden="true"/> Atualizar dados</button>
   </div>
  </header>

  <div className="integration-summary" aria-label="Áreas integradas">
   <article><ClipboardList size={22} aria-hidden="true"/><span>Field</span><strong>Ordens de serviço</strong><small>Operação e execução</small></article>
   <article><FileCheck2 size={22} aria-hidden="true"/><span>NextCRM</span><strong>Documentos e permissões</strong><small>Autorização por OS, sob consulta</small></article>
   <article><Landmark size={22} aria-hidden="true"/><span>Financeiro</span><strong>Medições e recebíveis</strong><small>Dados persistidos do Field</small></article>
  </div>

  {status==='unavailable'&&<div className="integration-message integration-error" role="alert"><Unplug size={18}/><span>{error} Não são exibidos dados simulados nem status de integração presumidos.</span></div>}

  <div className="integration-grid">
   <section className="integration-panel" aria-label="Selecionar ordem de serviço">
    <div className="integration-panel-heading">
     <div><span className="integration-kicker">01 / PROCESSO</span><h3>Escolha uma OS</h3></div>
     {status==='ready'&&<span className="integration-subtle">{orders.length} exibida(s)</span>}
    </div>
    {status==='loading'&&<p role="status" className="integration-empty">Consultando ordens autorizadas…</p>}
    {status==='ready'&&!orders.length&&<div className="integration-empty">
     <strong>Nenhuma ordem encontrada</strong>
     <p>Cadastre uma OS no módulo operacional para acompanhar seus vínculos aqui.</p>
    </div>}
    {status==='ready'&&orders.length>0&&<div className="integration-order-list">
     {orders.map(order=><button type="button" key={order.id}
       aria-pressed={selectedId===order.id}
       className={'integration-order'+(selectedId===order.id?' selected':'')}
       onClick={()=>setSelectedId(order.id)}>
       <span><strong>{order.title}</strong><small>{order.client||'Cliente não informado'} · {order.id.slice(0,8).toUpperCase()}</small></span>
       <ArrowRight size={17} aria-hidden="true"/>
      </button>)}
    </div>}
    <footer className="integration-panel-footer">
     A lista respeita a sessão e os vínculos de propriedade autorizados pelo Field.
    </footer>
   </section>

   <section className="integration-panel integration-flow" aria-label="Registros da mesma OS">
    <div className="integration-panel-heading">
     <div><span className="integration-kicker">02 / RASTREABILIDADE</span><h3>Uma OS, um histórico</h3></div>
     <ShieldCheck size={20} aria-label="Dados sujeitos à autorização da API"/>
    </div>
    {!chosen&&<p className="integration-empty">Selecione uma ordem para consultar o processo.</p>}
    {chosen&&<>
     <div className="integration-selected"><small>ORDEM SELECIONADA</small><strong>{chosen.title}</strong><span>{chosen.id.slice(0,8).toUpperCase()}</span></div>
     {detailLoading&&<p role="status">Consultando vínculos financeiros…</p>}
     {detailError&&<p className="integration-message integration-error" role="alert">{detailError}</p>}
     <ol className="integration-steps">
      {stages.map((stage,i)=><li key={stage.label}>
       <span className={'integration-step-icon'+(stage.ready?' confirmed':'')}>{String(i+1).padStart(2,'0')}</span>
       <span><strong>{stage.label}</strong><small>{stage.value}</small></span>
      </li>)}
     </ol>
     {detail&&<p className="integration-fact-note">Os números acima são registros efetivamente associados a esta OS. Ausência de registros não significa falha de integração.</p>}
     <div className="integration-actions">
      <button type="button" className="primary" onClick={()=>onOpenOrder(chosen.id)}>Abrir OS <ArrowRight size={16}/></button>
      <button type="button" className="secondary" onClick={()=>onOpenFinance(chosen.id)}>Abrir financeiro</button>
     </div>
    </>}
   </section>
  </div>
  <section className="integration-panel integration-documents" aria-label="Documentos autorizados da ordem">
   <div className="integration-panel-heading"><div><span className="integration-kicker">03 / DOCUMENTOS</span><h3>NextCRM dentro da ordem</h3></div><button type="button" className="text-button" onClick={onOpenCRM}>Abrir CRM e Vendas <ArrowRight size={15}/></button></div>
   <p className="integration-docs-subtext">A autorização de cada documento é verificada na origem. O arquivo passa pelo próprio Field; nenhuma URL privada de armazenamento é exposta.</p>
   {selectedId&&detail?<OrderNextcrmDocuments key={selectedId} orderId={selectedId}/>:
    <p className="integration-empty">Selecione uma OS autorizada para verificar seus documentos.</p>}
  </section>
  <p className="integration-guardrail"><ShieldCheck size={16} aria-hidden="true"/> Este painel não cria dados e não declara homologação concluída. A liberação para produção depende dos testes reais de escrita, documentos, estorno e aceite empresarial.</p>
 </section>;
}
