'use client';
import {useEffect,useState} from 'react';
import {ArrowRight,Package,RefreshCw,TriangleAlert} from 'lucide-react';

type Item={id:string;sku:string;name:string;unit:string;minimum:number;available:number;netRequirement:number;status:'attention'|'covered'};
export default function MRPWorkspace({onMaterial}:{onMaterial:(id:string)=>void}){
 const [items,setItems]=useState<Item[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
 async function load(){setLoading(true);setError('');try{const r=await fetch('/api/mrp');const d=await r.json() as {items?:Item[];recommendations?:Item[];error?:string};if(!r.ok)throw new Error(d.error||'Planejamento indisponível.');setItems(d.items??d.recommendations??[]);}catch(e){setError(e instanceof Error?e.message:'Planejamento indisponível.');}finally{setLoading(false);}}
 useEffect(()=>{void load();},[]);
 const needs=items.filter(x=>x.status==='attention'||x.netRequirement>0);
 return <section className="mrp-workspace" aria-label="Planejamento de materiais"><header><div><span className="eyebrow">PLANEJAMENTO · MRP</span><h2>Necessidades de materiais</h2><p>Necessidade líquida calculada sobre saldo disponível e estoque mínimo persistidos.</p></div><button className="icon-button" onClick={()=>void load()} disabled={loading} aria-label="Atualizar MRP"><RefreshCw size={16}/></button></header>{error?<div className="mrp-empty"><TriangleAlert size={20}/><p>{error}</p></div>:loading?<div className="mrp-empty">Calculando necessidades…</div>:needs.length?<div className="mrp-table"><div className="mrp-row mrp-head"><span>Material</span><span>Disponível</span><span>Mínimo</span><span>Necessidade líquida</span><span>Origem</span></div>{needs.map(x=><div className="mrp-row" key={x.id}><button className="mrp-material" onClick={()=>onMaterial(x.id)}><Package size={15}/><span><strong>{x.sku}</strong><small>{x.name}</small></span></button><span>{(x.available/1000).toLocaleString('pt-BR')} {x.unit}</span><span>{(x.minimum/1000).toLocaleString('pt-BR')} {x.unit}</span><strong className="mrp-gap">{(x.netRequirement/1000).toLocaleString('pt-BR')} {x.unit}</strong><button className="text-button" onClick={()=>onMaterial(x.id)}>Abrir material <ArrowRight size={13}/></button></div>)}</div>:<div className="mrp-empty"><Package size={20}/><span>Nenhuma necessidade abaixo do mínimo.</span></div>}</section>;
}
