'use client';
import {useEffect,useRef,useState} from 'react';
export type BatchSelection={lineId:string;targetType:'receipt'|'payment';targetId:string;description:string;amountScaled:string};
type Preview={ready:boolean;count:number;items:Array<{lineId:string;amountScaled:string;effectiveDate:string}>;error?:string};
type History={items:Array<{id:string;createdAt:string;receipt:{count:number}}>;error?:string};
const money=(v:string)=>{const n=BigInt(v);return 'R$ '+(n/10000n).toLocaleString('pt-BR')+','+((n%10000n)/100n).toString().padStart(2,'0');};
export default function BankReconciliationBatchPanel({statementId,items,onRemove,onCompleted}:{
 statementId:string;items:BatchSelection[];onRemove:(lineId:string)=>void;onCompleted:()=>void;
}){
 const key=useRef(crypto.randomUUID());
 const [verified,setVerified]=useState<Preview|null>(null),[signature,setSignature]=useState('');
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const [history,setHistory]=useState<History|null>(null),[reload,setReload]=useState(0);
 const current=JSON.stringify({statementId,items:items.map(({lineId,targetType,targetId})=>({lineId,targetType,targetId}))});
 useEffect(()=>{const t=setTimeout(()=>{key.current=crypto.randomUUID();setVerified(null);setSignature('');},0);return()=>clearTimeout(t);},[current]);
 useEffect(()=>{if(!statementId)return;const ctl=new AbortController();
   const run=async()=>{try{const r=await fetch('/api/bank/reconciliation-batches?'+new URLSearchParams({statementId}),{cache:'no-store',signal:ctl.signal});
    const d=await r.json() as History;if(r.ok&&!ctl.signal.aborted)setHistory(d);}catch{}};
   void run();return()=>ctl.abort();
 },[statementId,reload]);
 async function execute(mode:'preview'|'commit'){
  if(!statementId||!items.length)return;
  if(mode==='commit'&&(!verified?.ready||signature!==current))return;
  if(mode==='commit'&&!window.confirm('Confirmar todos os vínculos selecionados? A operação será atômica.'))return;
  setBusy(true);setError('');setNotice('');
  try{
   const r=await fetch('/api/bank/reconciliation-batches',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({key:key.current,statementId,mode,items:items.map(({lineId,targetType,targetId})=>({lineId,targetType,targetId}))})});
   const d=await r.json() as Preview&{error?:string};
   if(!r.ok)throw Error(d.error??'Falha no lote de conciliação.');
   if(mode==='preview'){setVerified(d);setSignature(current);setNotice('Pré-validação sem conflitos. Confira os vínculos e confirme.');}
   else{setVerified(null);key.current=crypto.randomUUID();setReload(n=>n+1);setNotice('Conciliação registrada com integridade atômica.');onCompleted();}
  }catch(e){setVerified(null);setError(e instanceof Error?e.message:'Falha na conciliação.');}
  finally{setBusy(false);}
 }
 return <section className="next-block" aria-label="Conciliação bancária em lote">
  <h3>Conciliação em lote · {items.length}/25 vínculos</h3>
  <p>A fila é provisória até a confirmação. O servidor revalida propriedade, competência, sinal, valor, estornos e unicidade em uma única transação.</p>
  {items.length>0&&<div className="table-wrap"><table><thead><tr><th>Linha</th><th>Valor absoluto</th><th>Destino</th><th>Ação</th></tr></thead>
   <tbody>{items.map(item=><tr key={item.lineId}><td>{item.description}</td><td>{money(item.amountScaled.replace('-',''))}</td>
    <td>{item.targetType==='receipt'?'Recebimento':'Pagamento'} · {item.targetId.slice(0,8)}</td>
    <td><button type="button" disabled={busy} onClick={()=>onRemove(item.lineId)}>Retirar</button></td></tr>)}</tbody></table></div>}
  <div className="worklist-tools">
   <button type="button" className="secondary" disabled={busy||items.length===0||items.length>25} onClick={()=>void execute('preview')}>Pré-validar lote</button>
   <button type="button" className="primary" disabled={busy||!verified?.ready||signature!==current} onClick={()=>void execute('commit')}>Confirmar {items.length} conciliações</button>
  </div>
  {error&&<p role="alert" className="linked-info">{error}</p>}{notice&&<p role="status" className="linked-info">{notice}</p>}
  <details><summary>Histórico de lotes confirmados</summary>{history?.items.length?<ul>
   {history.items.map(h=><li key={h.id}>{new Date(h.createdAt).toLocaleString('pt-BR')} · {h.receipt.count} correspondências · lote {h.id.slice(0,8)}</li>)}
  </ul>:<p>Nenhum lote confirmado para este extrato.</p>}</details>
 </section>;
}
