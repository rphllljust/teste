'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Company = { id: string; code: string; name: string; taxId?: string | null };
type Activity = { code: string; description: string; isPrimary: boolean };
type ResponseData = { items: Activity[]; declaredProfile: Activity[] };
type Props = { tenantId: string; companies: Company[]; canManage: boolean };

async function responseData<T>(response: Response): Promise<T> {
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? 'Não foi possível consultar os CNAEs.');
  return result;
}

/** Corporate CNAEs are server-owned records, not browser-only placeholders. */
export function LegalEntityCnaes({tenantId,companies,canManage}: Props) {
  const [companyId,setCompanyId]=useState(companies[0]?.id ?? '');
  const [result,setResult]=useState<ResponseData>({items:[],declaredProfile:[]});
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [filter,setFilter]=useState('');
  const sequence=useRef(0);
  const company=companies.find(item=>item.id===companyId) ?? companies[0];
  const endpoint=company
    ? '/api/enterprise/tenants/'+encodeURIComponent(tenantId)+
      '/legal-entities/'+encodeURIComponent(company.id)+'/cnaes'
    : '';

  const refresh=useCallback(async(url: string)=>{
    const requested=++sequence.current;
    setLoading(true);setError('');
    setResult({items:[],declaredProfile:[]});
    try{
      const next=await responseData<ResponseData>(await fetch(url,{cache:'no-store',credentials:'same-origin'}));
      if(requested===sequence.current)setResult(next);
    }catch(cause){
      if(requested===sequence.current)setError(cause instanceof Error?cause.message:'Catálogo indisponível.');
    }finally{
      if(requested===sequence.current)setLoading(false);
    }
  },[]);
  useEffect(()=>{
    if(!endpoint){sequence.current+=1;return;}
    // Start async synchronization after React commits; cleanup rejects stale responses.
    const timer=setTimeout(()=>void refresh(endpoint),0);
    return ()=>{clearTimeout(timer);sequence.current+=1;};
  },[endpoint,refresh]);

  const persisted=result.items.length>0;
  const activities=persisted?result.items:result.declaredProfile;
  const displayed=useMemo(()=>{
    const query=filter.trim().toLocaleLowerCase('pt-BR');
    return query?activities.filter(activity=>
      activity.code.includes(query)||activity.description.toLocaleLowerCase('pt-BR').includes(query)):activities;
  },[activities,filter]);
  const primary=activities.find(activity=>activity.isPrimary);

  async function applyProfile(){
    if(!company||!endpoint||!canManage||saving||persisted||result.declaredProfile.length!==49)return;
    if(!window.confirm('Vincular permanentemente os 49 CNAEs informados à empresa '+company.name+
       '? Esta operação será registrada na auditoria e não modifica o CNPJ.'))return;
    setSaving(true);setError('');setNotice('');
    try{
      const receipt=await responseData<{count:number}>(await fetch(endpoint,{
        method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'applyDeclaredProfile',commandKey:crypto.randomUUID()}),
      }));
      await refresh(endpoint);
      setNotice(receipt.count+' CNAEs vinculados e auditados para a empresa selecionada.');
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Não foi possível registrar o perfil de atividades.');
    }finally{setSaving(false);}
  }

  if(!companies.length)return null;
  return <section className="enterprise-cnaes" aria-label="Atividades econômicas da empresa jurídica">
    <div className="enterprise-governance-panel-heading">
      <div>
        <span className="eyebrow">ATIVIDADES ECONÔMICAS / CNAE</span>
        <h3>Cadastro persistente por CNPJ</h3>
        <p>As atividades são armazenadas no banco de dados e vinculadas à empresa jurídica selecionada.</p>
      </div>
      <span className="enterprise-governance-count">
        {loading?'Consultando…':persisted?result.items.length+' CNAEs registrados':result.declaredProfile.length+' CNAEs disponíveis'}
      </span>
    </div>
    <label className="enterprise-governance-select">Empresa jurídica
      <select value={company?.id??''} onChange={event=>{
        sequence.current+=1;
        setCompanyId(event.target.value);setFilter('');setNotice('');setError('');
        setResult({items:[],declaredProfile:[]});
      }}>
        {companies.map(item=><option value={item.id} key={item.id}>
          {item.code} · {item.name}{item.taxId?' · CNPJ '+item.taxId:''}
        </option>)}
      </select>
    </label>
    {company&&<p className="enterprise-governance-hint">
      Empresa: <strong>{company.name}</strong> · CNPJ: {company.taxId||'não cadastrado'}
    </p>}
    {error&&<p role="alert" className="form-error">{error}</p>}
    {notice&&<p role="status" className="linked-info">{notice}</p>}
    {!loading&&activities.length>0&&<>
      <div className="enterprise-cnaes-facts">
        <span><strong>{persisted?'Persistido':'Prévia não vinculada'}</strong></span>
        <span><strong>Principal:</strong> {primary?.code??'—'}</span>
        <span><strong>Secundárias:</strong> {activities.filter(activity=>!activity.isPrimary).length}</span>
      </div>
      {!persisted&&<p className="enterprise-governance-hint">
        Esta é a relação informada pelo operador. A vinculação ao CNPJ exige confirmação de usuário autorizado e não substitui validação oficial do cadastro na Receita Federal.
      </p>}
      {!persisted&&canManage&&<button type="button" className="primary"
        disabled={saving||loading||result.declaredProfile.length!==49}
        onClick={()=>void applyProfile()}>
        {saving?'Registrando atividades…':'Vincular 49 CNAEs à empresa'}
      </button>}
      <details className="enterprise-governance-disclosure">
        <summary>{persisted?'Consultar CNAEs persistidos':'Visualizar os 49 CNAEs para vinculação'}</summary>
        <div className="enterprise-cnaes-table">
          <label>Filtrar por CNAE ou descrição
            <input type="search" value={filter} onChange={e=>setFilter(e.target.value)}
              placeholder="Código ou atividade" aria-label="Filtrar CNAEs"/>
          </label>
          <div className="table-wrap enterprise-governance-table">
            <table>
              <caption className="sr-only">CNAEs {persisted?'persistidos':'informados para cadastro'}</caption>
              <thead><tr><th scope="col">CNAE</th><th scope="col">Descrição</th><th scope="col">Classificação</th></tr></thead>
              <tbody>{displayed.map(item=><tr key={item.code}>
                <td><strong>{item.code}</strong></td><td>{item.description}</td>
                <td>{item.isPrimary?'Principal':'Secundária'}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <p className="enterprise-governance-hint">{displayed.length} de {activities.length} atividade(s).</p>
        </div>
      </details>
    </>}
    {loading&&<p role="status">Carregando atividades da empresa…</p>}
  </section>;
}
