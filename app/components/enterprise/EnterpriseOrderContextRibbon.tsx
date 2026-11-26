'use client';
import {useEffect,useState} from 'react';
import {ArrowRight,GitBranch,ShieldCheck,TriangleAlert,X} from 'lucide-react';
type RecordState={id:string;title:string;client:string;status:string;version:number};
type ResponseBody={order?:RecordState;error?:string};
const destinations=['Ordens de serviço','Dossiês empresariais','Execução','Medições','Faturamento','Financeiro'] as const;
const labels:Record<string,string>={draft:'Rascunho',authorized:'Autorizada',executing:'Em execução',completed:'Concluída',cancelled:'Cancelada'};

/** A context ID is only a pointer: server-backed ownership is required before presenting business details or links. */
export default function EnterpriseOrderContextRibbon({orderId,currentPage,navigate,openOrder,clear}:{
 orderId:string;currentPage:string;navigate:(module:string,orderId?:string)=>void;
 openOrder:(id:string)=>void;clear:()=>void;
}){
 const [order,setOrder]=useState<RecordState|null>(null);
 const [error,setError]=useState('');
 const [loading,setLoading]=useState(true);
 useEffect(()=>{
  const controller=new AbortController();
  const timer=window.setTimeout(async()=>{
   setLoading(true);setOrder(null);setError('');
   try{
    const response=await fetch('/api/orders/'+encodeURIComponent(orderId),{
     credentials:'same-origin',cache:'no-store',signal:controller.signal,
    });
    if(!response.ok)throw Error('Documento não disponível para esta sessão.');
    const json=await response.json() as ResponseBody;
    if(json.order?.id!==orderId||typeof json.order.title!=='string'||
       typeof json.order.version!=='number')throw Error('O documento autorizado não corresponde ao link.');
    if(!controller.signal.aborted)setOrder(json.order);
   }catch(cause){
    if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Contexto não disponível.');
   }finally{if(!controller.signal.aborted)setLoading(false);}
  },0);
  return()=>{window.clearTimeout(timer);controller.abort();};
 },[orderId]);
 const route=(module:string)=>{
  if(!order)return;
  if(module==='Ordens de serviço'){openOrder(order.id);return;}
  navigate(module,order.id);
 };
 return <section className="cisne-transaction-context" aria-label="Contexto transacional da ordem" data-state={loading?'loading':order?'ready':'unavailable'}>
  <div className="cisne-transaction-context-identity">
   {order?<ShieldCheck size={17}/>:error?<TriangleAlert size={17}/>:<GitBranch size={17}/>}
   <span>
    <strong>{order?'OS · '+order.id.slice(0,8).toUpperCase():loading?'Validando documento…':'Contexto não autorizado'}</strong>
    <small>{order?order.title+' · '+order.client+' · '+(labels[order.status]??order.status)+' · Versão '+order.version:
     error||'Consultando autorização e versão no servidor'}</small>
   </span>
  </div>
  {order&&<nav className="cisne-transaction-context-links" aria-label="Etapas da OS selecionada">
   {destinations.map(module=><button key={module} type="button"
    aria-current={currentPage===module?'page':undefined}
    onClick={()=>route(module)}>
    {module}<ArrowRight size={12}/>
   </button>)}
  </nav>}
  <button type="button" onClick={clear} className="cisne-transaction-context-dismiss" aria-label="Limpar contexto da ordem">
   <X size={15}/>
  </button>
 </section>;
}
