'use client';

import { useEffect, useMemo, useState } from 'react';

type Cnae = { code: string; description: string; isPrimary: boolean };
type Catalog = { items: Cnae[]; total: number; error?: string };

/** Company-independent, read-only view of the already persisted PostgreSQL CNAE catalog. */
export default function EnterpriseCnaeCatalog({hasOrganization}:{hasOrganization:boolean}) {
  const [items,setItems]=useState<Cnae[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [search,setSearch]=useState('');

  useEffect(()=>{
    const controller=new AbortController();
    const timer=window.setTimeout(async()=>{
      try {
        const response=await fetch('/api/enterprise/cnaes',{
          cache:'no-store',credentials:'same-origin',signal:controller.signal,
        });
        const body=await response.json() as Catalog;
        if(!response.ok)throw new Error(body.error??'O catálogo CNAE está indisponível.');
        if(!controller.signal.aborted)setItems(body.items);
      }catch(cause){
        if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Falha ao consultar o catálogo CNAE.');
      }finally {
        if(!controller.signal.aborted)setLoading(false);
      }
    },0);
    return ()=>{window.clearTimeout(timer);controller.abort();};
  },[]);

  const filtered=useMemo(()=>{
    const term=search.trim().toLocaleLowerCase('pt-BR');
    return term?items.filter(item=>item.code.includes(term)||
      item.description.toLocaleLowerCase('pt-BR').includes(term)):items;
  },[items,search]);
  const primary=items.find(item=>item.isPrimary);
  const secondaryCount=items.filter(item=>!item.isPrimary).length;

  return <section id="governance-cnaes" className="enterprise-governance-panel enterprise-cnae-catalog-panel"
    aria-labelledby="governance-cnaes-title" aria-busy={loading}>
    <div className="enterprise-governance-panel-heading">
      <div>
        <span className="eyebrow">ATIVIDADES ECONÔMICAS / SERVIÇOS</span>
        <h2 id="governance-cnaes-title">CNAEs cadastrados no ERP</h2>
        <p>Relação persistida no PostgreSQL, disponível para consulta independentemente do cadastro de uma organização.</p>
      </div>
      <span className="enterprise-governance-count">
        {loading?'Consultando…':error?'Consulta indisponível':items.length+' CNAEs no catálogo'}
      </span>
    </div>
    {!hasOrganization&&<p className="enterprise-cnae-context-note" role="status">
      Os CNAEs estão cadastrados no catálogo do ERP, mas ainda não vinculados a um CNPJ nesta sessão.
      Para criar o vínculo permanente, <a href="#governance-organizations">registre ou selecione uma organização</a> e cadastre a empresa jurídica.
    </p>}
    {hasOrganization&&<p className="enterprise-cnae-context-note" role="status">
      Catálogo geral para consulta. Para associar os 49 CNAEs a um CNPJ, abra a seção <a href="#governance-companies">Empresas jurídicas</a>,
      selecione a empresa e confirme a vinculação no painel de atividades da empresa.
    </p>}
    {error&&<p className="form-error" role="alert">{error}</p>}
    {loading&&<p role="status">Carregando os CNAEs persistidos…</p>}
    {!loading&&!error&&<>
      <div className="enterprise-cnae-catalog-facts" aria-label="Resumo das atividades cadastradas">
        <span><strong>{items.length}</strong> atividades cadastradas</span>
        <span><strong>{primary?.code??'—'}</strong> atividade principal</span>
        <span><strong>{secondaryCount}</strong> atividades secundárias</span>
      </div>
      <label className="enterprise-cnae-catalog-search">Buscar CNAE ou serviço
        <input type="search" value={search} onChange={event=>setSearch(event.target.value)}
          placeholder="Código, nome ou descrição" aria-label="Pesquisar CNAEs do ERP"/>
      </label>
      <div className="table-wrap enterprise-governance-table enterprise-cnae-catalog-scroll">
        <table>
          <caption className="sr-only">Catálogo de atividades econômicas cadastradas no ERP</caption>
          <thead><tr><th scope="col">CNAE</th><th scope="col">Atividade / serviço</th><th scope="col">Classificação</th></tr></thead>
          <tbody>{filtered.map(item=><tr key={item.code}>
            <td><strong>{item.code}</strong></td><td>{item.description}</td>
            <td><span className="enterprise-governance-state">{item.isPrimary?'Principal':'Secundária'}</span></td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="enterprise-governance-hint" role="status">{filtered.length} de {items.length} atividades exibidas.
        {items.length!==49?' Verifique a integridade do catálogo: são esperados 49 CNAEs.':''}
        {' '}Catálogo informado pelo usuário; não constitui validação oficial da Receita Federal.
      </p>
    </>}
  </section>;
}
