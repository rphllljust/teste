'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Check, ClipboardCheck, Package, RefreshCw, Search, ShoppingCart, TriangleAlert, X } from 'lucide-react';
import { BusinessStatus, EnterprisePageHeader } from './components/enterprise/EnterprisePrimitives';

type Recommendation = {
 recommendationId: string; runId: string; materialId: string; sku: string; name: string;
 unit: string; available: number; minimum: number; netRequirement: number;
 coverageStatus: 'attention' | 'covered'; approvalStatus: 'draft' | 'approved' | 'rejected' | 'converted';
 rowVersion: number; purchaseOrderId: string | null;
};
type Run = { id: string; status: string; startedAt: string; evaluatedMaterials: number; shortages: number; recommendations: number };
type Supplier = { id: string; legalName: string };
async function api<T>(url: string, options?: RequestInit) {
 const response = await fetch(url, options);
 const body = await response.json() as T & { error?: string };
 if (!response.ok) throw new Error(body.error || 'Operação indisponível.');
 return body;
}
const quantity = (value: number) => (value / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const statusText = { draft: 'Aguardando aprovação', approved: 'Aprovada', rejected: 'Rejeitada', converted: 'Pedido criado' };

export default function MRPWorkspace({
 onMaterial, onPurchaseOrder,
}: { onMaterial: (id: string) => void; onPurchaseOrder?: (id: string) => void }) {
 const [items, setItems] = useState<Recommendation[]>([]);
 const [runs, setRuns] = useState<Run[]>([]);
 const [suppliers, setSuppliers] = useState<Supplier[]>([]);
 const [converting, setConverting] = useState<Recommendation | null>(null);
 const [query, setQuery] = useState('');
 const [loading, setLoading] = useState(true);
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState('');
 const [notice, setNotice] = useState('');
 const retry = useRef<{ signature: string; orderId: string; lineId: string } | null>(null);

 async function load() {
  setLoading(true);
  try {
   const data = await api<{ recommendations: Recommendation[]; runs: Run[] }>('/api/mrp');
   setItems(data.recommendations ?? []);
   setRuns(data.runs ?? []);
   setError('');
  } catch (cause) {
   setError(cause instanceof Error ? cause.message : 'Planejamento indisponível.');
  } finally { setLoading(false); }
 }
 useEffect(() => { void load(); }, []);

 async function runPlanning() {
  if (busy) return;
  setBusy(true); setError(''); setNotice('');
  try {
   const data = await api<{ runId: string; shortages: number; recommendations: number }>('/api/mrp', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ horizonDays: 30 }),
   });
   setNotice(`Planejamento registrado: ${data.shortages} materiais abaixo do mínimo, ${data.recommendations} novas recomendações.`);
   await load();
  } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível planejar.'); }
  finally { setBusy(false); }
 }
 async function decide(rec: Recommendation, command: 'approve' | 'reject') {
  if (busy) return;
  setBusy(true); setError(''); setNotice('');
  try {
   await api('/api/mrp/commands', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, recommendationId: rec.recommendationId, expectedVersion: rec.rowVersion }),
   });
   setNotice(command === 'approve' ? 'Recomendação aprovada. A compra exige uma decisão separada.' : 'Recomendação rejeitada.');
   await load();
  } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível decidir.'); }
  finally { setBusy(false); }
 }
 async function openConversion(rec: Recommendation) {
  setError(''); retry.current = null;
  try {
   const data = await api<{ suppliers: Supplier[] }>('/api/procurement');
   setSuppliers(data.suppliers ?? []);
   setConverting(rec);
  } catch (cause) { setError(cause instanceof Error ? cause.message : 'Fornecedores indisponíveis.'); }
 }
 async function convert(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  if (busy || !converting) return;
  const fields = Object.fromEntries(new FormData(event.currentTarget));
  const signature = JSON.stringify({ recommendationId: converting.recommendationId,
   expectedVersion: converting.rowVersion, supplierId: fields.supplierId,
   reference: fields.reference, expectedOn: fields.expectedOn, unitPrice: fields.unitPrice });
  if (retry.current?.signature !== signature)
   retry.current = { signature, orderId: crypto.randomUUID(), lineId: crypto.randomUUID() };
  setBusy(true); setError(''); setNotice('');
  try {
   const result = await api<{ purchaseOrderId: string }>('/api/mrp/commands', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
     command: 'convert', recommendationId: converting.recommendationId,
     expectedVersion: converting.rowVersion,
     purchaseOrderId: retry.current.orderId, lineId: retry.current.lineId,
     supplierId: fields.supplierId, reference: fields.reference,
     expectedOn: fields.expectedOn, unitPrice: fields.unitPrice,
    }),
   });
   setConverting(null);
   retry.current = null;
   setNotice('Pedido de compra em rascunho criado. A aprovação do pedido continua no Centro de Compras.');
   await load();
   onPurchaseOrder?.(result.purchaseOrderId);
  } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível criar o pedido.'); }
  finally { setBusy(false); }
 }

 const pending = items.filter(item => item.approvalStatus === 'draft').length;
 const visibleItems = items.filter(item => !query || `${item.sku} ${item.name}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
 return <section className="mrp-workspace" aria-label="Planejamento de materiais">
  <EnterprisePageHeader breadcrumb="Suprimentos / Planejamento de materiais" eyebrow="WORKLIST · SUPRIMENTOS" title="Planejamento de materiais" description="Reposição por estoque mínimo, com aprovação explícita e compras vinculadas ao ERP." />
  <header className="mrp-header">
   <div><span className="eyebrow">GESTÃO INTEGRADA · SUPRIMENTOS</span>
    <h2>Planejamento de materiais</h2>
    <p>Reposição por estoque mínimo, com aprovação explícita e compras vinculadas ao ERP.</p></div>
   <div className="mrp-actions">
    <button className="secondary" onClick={() => void load()} disabled={busy || loading}><RefreshCw size={15}/> Atualizar</button>
    <button className="primary" onClick={() => void runPlanning()} disabled={busy || loading}><ClipboardCheck size={15}/> Executar planejamento</button>
   </div>
  </header>
  <div className="mrp-summary"><strong>{pending}</strong> recomendações aguardando decisão
   {runs[0] && <span>Última rodada: {new Date(runs[0].startedAt).toLocaleString('pt-BR')} · {runs[0].evaluatedMaterials} materiais avaliados</span>}
  </div>
  {notice && <div className="notice"><Check size={15}/><span>{notice}</span><button aria-label="Fechar aviso" onClick={() => setNotice('')}><X size={14}/></button></div>}
  {error && <div className="form-error" role="alert"><TriangleAlert size={16}/> {error}</div>}
  {!loading && items.length > 0 && <div className="mrp-filter-bar"><label><Search size={15}/><span className="sr-only">Buscar material</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar material por código ou descrição" /></label><span>{visibleItems.length} de {items.length} recomendações</span></div>}
  {loading ? <div className="mrp-empty">Consultando planejamento persistido…</div>
   : !items.length ? <div className="mrp-empty"><Package size={22}/><span>Não há recomendações. Execute o planejamento para avaliar o estoque.</span></div>
   : <div className="mrp-list">
     <div className="mrp-list-head"><span>Material</span><span>Disponível</span><span>Mínimo</span><span>Reposição</span><span>Decisão e ações</span></div>
     {visibleItems.map(rec => <div className="mrp-list-row" key={rec.recommendationId}>
      <div className="mrp-material-name"><button className="text-button" onClick={() => onMaterial(rec.materialId)}>
       <Package size={16}/><span><strong>{rec.sku}</strong><small>{rec.name}</small></span></button></div>
      <span>{quantity(rec.available)} {rec.unit}</span>
      <span>{quantity(rec.minimum)} {rec.unit}</span>
      <strong>{quantity(rec.netRequirement)} {rec.unit}</strong>
      <div className="mrp-row-actions">
       <BusinessStatus status={rec.approvalStatus==='draft'?'draft':rec.approvalStatus==='approved'?'approved':rec.approvalStatus==='converted'?'completed':'cancelled'} label={statusText[rec.approvalStatus]} />
       {rec.approvalStatus === 'draft' && <>
        <button className="secondary" disabled={busy} onClick={() => void decide(rec, 'approve')}>Aprovar</button>
        <button className="text-button" disabled={busy} onClick={() => void decide(rec, 'reject')}>Rejeitar</button>
       </>}
       {rec.approvalStatus === 'approved' && <button className="primary" disabled={busy} onClick={() => void openConversion(rec)}><ShoppingCart size={14}/> Criar pedido</button>}
       {rec.approvalStatus === 'converted' && rec.purchaseOrderId && <button className="text-button" onClick={() => onPurchaseOrder?.(rec.purchaseOrderId!)}>Abrir compra <ArrowRight size={14}/></button>}
      </div>
     </div>)}
     </div>}
  {!loading && items.length > 0 && !visibleItems.length && <div className="mrp-empty"><Package size={22}/><span>Nenhuma recomendação corresponde ao filtro atual.</span></div>}
  {converting && <form className="mrp-conversion" onSubmit={e => void convert(e)}>
   <div><span className="eyebrow">CONVERSÃO AUTORIZADA · COMPRAS</span>
    <h3>Novo pedido: {converting.sku}</h3>
    <p>Quantidade: {quantity(converting.netRequirement)} {converting.unit}. O pedido será registrado como rascunho para aprovação em Compras.</p></div>
   <label>Fornecedor ativo
    <select name="supplierId" required defaultValue="">
     <option value="" disabled>Selecione um fornecedor</option>
     {suppliers.map(s => <option value={s.id} key={s.id}>{s.legalName}</option>)}
    </select></label>
   <label>Referência do pedido
    <input name="reference" minLength={3} maxLength={80} required defaultValue={`MRP-${converting.recommendationId.slice(0,8).toUpperCase()}`}/></label>
   <label>Data prevista de entrega
    <input name="expectedOn" type="date" required/></label>
   <label>Preço unitário (R$)
    <input name="unitPrice" type="text" inputMode="decimal" placeholder="0,00" required/></label>
   {!suppliers.length && <p role="alert">Cadastre um fornecedor ativo no Centro de Compras antes de continuar.</p>}
   <div className="mrp-actions">
    <button className="secondary" type="button" disabled={busy} onClick={() => setConverting(null)}>Cancelar</button>
    <button className="primary" type="submit" disabled={busy || !suppliers.length}>Registrar pedido em rascunho</button>
   </div>
  </form>}
 </section>;
}
