"use client";

import { useEffect, useMemo, useState, type Key, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Columns3, Download, RotateCcw } from "lucide-react";

export type EnterpriseSmartColumn<T> = {
 key: string;
 title: string;
 render: (row:T)=>ReactNode;
 text: (row:T)=>string;
 sortValue?: (row:T)=>string|number|null;
 required?: boolean;
 align?: "start"|"end";
};
export type EnterpriseSmartGridProps<T> = {
 viewId:string;
 caption:string;
 rows:readonly T[];
 columns:readonly EnterpriseSmartColumn<T>[];
 getRowKey:(row:T)=>Key;
 onOpen?:(row:T)=>void;
 openLabel?:(row:T)=>string;
 currentPageLabel?:string;
};

/** Table configuration persists only column IDs, never tenant records or credentials.
 * Client sorting/export only affect the currently authorized page of data.
 * Business authorizations are exclusively enforced by server APIs.
 */
function safeCsv(text:string):string {
 const safe = /^[\s]*[=+@-]/.test(text) ? "'"+text : text;
 return '"'+safe.replace(/"/g,'""').replace(/\r?\n/g,' ')+'"';
}
function savePageCsv(filename:string,headers:string[],rows:string[][]){
 const content="\uFEFF"+[headers,...rows].map(row=>row.map(safeCsv).join(";")).join("\r\n");
 const blob=new Blob([content],{type:"text/csv;charset=utf-8"});
 const url=URL.createObjectURL(blob);
 try{
  const a=document.createElement("a");a.href=url;a.download=filename;
  document.body.append(a);a.click();a.remove();
 }finally{URL.revokeObjectURL(url);}
}

export function EnterpriseSmartGrid<T>({
 viewId,caption,rows,columns,getRowKey,onOpen,openLabel,currentPageLabel="Página atual",
}:EnterpriseSmartGridProps<T>){
 const storageKey="cisne:table:columns:"+viewId;
 const [hidden,setHidden]=useState<string[]>([]);
 const [settingsOpen,setSettingsOpen]=useState(false);
 const [sort,setSort]=useState<{key:string;direction:"asc"|"desc"}|null>(null);
 const [selected,setSelected]=useState<Set<Key>>(()=>new Set());
 const [exportNotice,setExportNotice]=useState("");
 const keys=columns.map(column=>column.key).join("|");
 useEffect(()=>{
  const timer=window.setTimeout(()=>{
   try{
    const saved=JSON.parse(window.localStorage.getItem(storageKey)||"[]") as unknown;
    if(Array.isArray(saved)){
     const allowed=new Set(keys.split("|"));
     const next=saved.filter((key):key is string=>typeof key==="string"&&allowed.has(key)&&
      !columns.some(column=>column.key===key&&column.required));
     setHidden(next.length>=columns.length?[]:next);
    }
   }catch{ /* Optional view preferences never block access to data. */ }
  },0);
  return()=>window.clearTimeout(timer);
 },[storageKey,keys,columns]);
 const visible=columns.filter(column=>!hidden.includes(column.key));
 const ordered=useMemo(()=>{
  const column=columns.find(value=>value.key===sort?.key);
  if(!column?.sortValue||!sort)return [...rows];
  return [...rows].sort((a,b)=>{
   const av=column.sortValue?.(a),bv=column.sortValue?.(b);
   if(av==null&&bv==null)return 0;
   if(av==null)return 1;
   if(bv==null)return -1;
   const delta=typeof av==="number"&&typeof bv==="number"?av-bv:
    String(av).localeCompare(String(bv),"pt-BR",{numeric:true,sensitivity:"base"});
   return sort.direction==="asc"?delta:-delta;
  });
 },[rows,columns,sort]);
 const toggleColumn=(key:string)=>{
  if(columns.find(column=>column.key===key)?.required)return;
  const next=hidden.includes(key)?hidden.filter(value=>value!==key):[...hidden,key];
  if(next.length>=columns.length)return;
  setHidden(next);
  try{window.localStorage.setItem(storageKey,JSON.stringify(next));}
  catch{ /* Rendering and authorization do not depend on browser storage. */ }
 };
 const resetColumns=()=>{
  setHidden([]);setSort(null);
  try{window.localStorage.removeItem(storageKey);}catch{ /* Optional preference. */ }
 };
 const allSelected=ordered.length>0&&ordered.every(row=>selected.has(getRowKey(row)));
 const toggleAll=()=>setSelected(previous=>{
  const next=new Set(previous);
  if(allSelected)ordered.forEach(row=>next.delete(getRowKey(row)));
  else ordered.forEach(row=>next.add(getRowKey(row)));
  return next;
 });
 const toggleRow=(key:Key)=>setSelected(previous=>{
  const next=new Set(previous);
  if(next.has(key))next.delete(key);else next.add(key);
  return next;
 });
 const displayedSelected=ordered.filter(row=>selected.has(getRowKey(row)));
 const exportRows=displayedSelected.length?displayedSelected:ordered;
 const exportPage=()=>{
  if(!exportRows.length)return;
  savePageCsv("cisne-"+viewId.replace(/[^a-z0-9-]/gi,"-")+".csv",
   visible.map(c=>c.title),exportRows.map(row=>visible.map(c=>c.text(row))));
  setExportNotice(displayedSelected.length?
   "Exportados apenas "+displayedSelected.length+" registros selecionados desta página.":
   "Exportada somente a página autorizada carregada, sem consultar outros registros.");
 };
 return <section className="enterprise-smart-grid" aria-label={caption}>
  <div className="enterprise-smart-toolbar">
   <div className="enterprise-smart-label">
    <strong>{caption}</strong><span>{currentPageLabel} · {rows.length} registro(s)</span>
   </div>
   <div className="enterprise-smart-controls">
    <span className="enterprise-smart-selected" aria-live="polite">{displayedSelected.length?displayedSelected.length+" selecionados":"Sem seleção"}</span>
    <button type="button" className="secondary" disabled={!exportRows.length} onClick={exportPage}>
     <Download size={15} aria-hidden="true"/> Exportar página
    </button>
    <button type="button" className="secondary" onClick={()=>setSettingsOpen(v=>!v)}
     aria-expanded={settingsOpen} aria-controls={"cisne-columns-"+viewId}>
     <Columns3 size={15} aria-hidden="true"/> Colunas
    </button>
   </div>
  </div>
  {settingsOpen&&<fieldset id={"cisne-columns-"+viewId} className="enterprise-smart-columns">
    <legend>Personalização da tabela</legend>
    {columns.map(column=><label key={column.key}>
      <input type="checkbox" checked={!hidden.includes(column.key)}
       disabled={column.required||(!hidden.includes(column.key)&&visible.length<=1)}
       onChange={()=>toggleColumn(column.key)} />
      {column.title}{column.required&&<small>obrigatória</small>}
    </label>)}
    <button type="button" className="text-button" onClick={resetColumns}>
     <RotateCcw size={15}/> Restaurar colunas e ordenação
    </button>
  </fieldset>}
  <div className="enterprise-smart-scroll" role="region" tabIndex={0} aria-label={"Tabela "+caption}>
   <table>
    <caption className="sr-only">{caption} · {currentPageLabel}</caption>
    <thead><tr>
     <th scope="col"><input type="checkbox" aria-label="Selecionar registros visíveis da página"
      checked={allSelected} onChange={toggleAll} disabled={!ordered.length}/></th>
     {visible.map(column=><th scope="col" key={column.key} aria-sort={sort?.key===column.key?(sort.direction==="asc"?"ascending":"descending"):"none"}
      className={column.align==="end"?"enterprise-smart-num":undefined}>
       {column.sortValue?<button type="button" className="enterprise-smart-sort"
         aria-label={"Ordenar página por "+column.title}
         onClick={()=>setSort(current=>current?.key===column.key?
          {key:column.key,direction:current.direction==="asc"?"desc":"asc"}:
          {key:column.key,direction:"asc"})}>
         {column.title}
         {sort?.key===column.key?(sort.direction==="asc"?<ArrowUp size={13}/>:<ArrowDown size={13}/>):null}
       </button>:column.title}
     </th>)}
     {onOpen&&<th scope="col">Documento</th>}
    </tr></thead>
    <tbody>
     {ordered.length?ordered.map(row=><tr key={getRowKey(row)}>
      <td><input type="checkbox" checked={selected.has(getRowKey(row))}
       onChange={()=>toggleRow(getRowKey(row))}
       aria-label={"Selecionar registro "+String(getRowKey(row))}/></td>
      {visible.map(column=><td key={column.key} className={column.align==="end"?"enterprise-smart-num":undefined}>
        {column.render(row)}
       </td>)}
      {onOpen&&<td><button type="button" className="secondary enterprise-smart-open"
       onClick={()=>onOpen(row)} aria-label={openLabel?.(row)??"Abrir documento"}>Examinar</button></td>}
     </tr>):<tr><td colSpan={visible.length+1+(onOpen?1:0)} className="enterprise-smart-empty">
      Nenhum registro autorizado disponível nesta página.
     </td></tr>}
    </tbody>
   </table>
  </div>
  {exportNotice&&<p className="enterprise-smart-export-notice" role="status">{exportNotice}</p>}
  <p className="enterprise-smart-footnote">Ordenação, seleção e exportação são restritas aos registros desta página já retornados pela API autorizada. Não incluem outras páginas nem alteram permissões.</p>
 </section>;
}
