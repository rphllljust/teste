'use client';
import {useMemo,useState} from 'react';
import {ArrowDownRight,ArrowRightLeft,ShieldCheck} from 'lucide-react';
import {buildCashStressScenario,type CashScenarioSource} from '../lib/domain/finance-cash-scenario';
import {moneyScaled} from '../lib/domain/orders';

const amount=(scaled:string)=>{const neg=scaled.startsWith('-');return (neg?'−':'')+moneyScaled(neg?scaled.slice(1):scaled);};
const date=(iso:string)=>new Intl.DateTimeFormat('pt-BR',{timeZone:'UTC'}).format(new Date(iso+'T12:00:00Z'));
const path=(values:bigint[],min:bigint,max:bigint)=>{
 if(!values.length)return '';
 const spread=max-min||1n;
 return values.map((value,i)=>(i?'L':'M')+(values.length===1?480:(40+i*880/(values.length-1)).toFixed(1))+','+
  (175-Number((value-min)*130n/spread)).toFixed(1)).join(' ');
};
export default function CashFlowScenarioWorkbench({rows,to}:{rows:CashScenarioSource[];to:string}){
 const [delay,setDelay]=useState<0|7|15|30>(0);
 const [showDetails,setShowDetails]=useState(false);
 const result=useMemo(()=>buildCashStressScenario(rows,to,delay),[rows,to,delay]);
 const first=result.rows.map(x=>BigInt(x.baselineRunningScaled));
 const second=result.rows.map(x=>BigInt(x.stressedRunningScaled));
 const all=[0n,...first,...second];
 const low=all.reduce((a,b)=>a<b?a:b,0n),high=all.reduce((a,b)=>a>b?a:b,0n);
 return <section id="cashflow-scenario" className="finance-stress-workbench" aria-label="Simulador gerencial de atrasos de recebimento">
  <header className="finance-stress-header">
   <div><span className="finance-small-eyebrow"><ArrowRightLeft size={14}/> PROJEÇÃO GERENCIAL · WHAT-IF</span>
    <h3>Teste de pressão no fluxo de caixa</h3>
    <p>Simule atraso nos vencimentos a receber sem modificar títulos, pagamentos, extratos ou lançamentos.</p></div>
   <label>Atraso hipotético de recebimentos
    <select value={delay} onChange={e=>setDelay(Number(e.target.value) as 0|7|15|30)}>
     <option value="0">Cenário contratual</option><option value="7">Atraso de 7 dias</option>
     <option value="15">Atraso de 15 dias</option><option value="30">Atraso de 30 dias</option>
    </select>
   </label>
  </header>
  {result.rows.length===0?<div className="finance-stress-empty">Nenhum compromisso documentado na janela. Nenhuma projeção foi gerada.</div>:<>
   <div className="finance-stress-metrics" aria-label="Indicadores do cenário">
    <div><span>Saldo líquido projetado na janela</span><strong>{amount(result.baselineNetScaled)}</strong><small>Fluxos contratuais, não caixa disponível</small></div>
    <div><span>Saldo projetado sob estresse</span><strong>{amount(result.stressedNetScaled)}</strong><small>Com recebimentos deslocados</small></div>
    <div><span>Maior lacuna temporária</span><strong>{amount(result.maximumTemporaryGapScaled)}</strong><small>Diferença acumulada máxima frente à base</small></div>
    <div><span>Recebíveis após a janela</span><strong>{amount(result.delayedBeyondHorizonScaled)}</strong><small>Adiados além de {date(to)}</small></div>
   </div>
   <figure className="finance-stress-chart" aria-label="Curvas de saldo projetado acumulado, sem representar saldo bancário">
    <figcaption>Posição líquida acumulada dos compromissos documentados na janela</figcaption>
    <svg viewBox="0 0 960 210" preserveAspectRatio="none" role="img"
      aria-label="Curva base e cenário de atraso; posição acumulada não é saldo disponível no banco">
      <line x1="34" x2="935" y1="175" y2="175" stroke="#d4e1e7" strokeWidth="1"/>
      <line x1="34" x2="935" y1="110" y2="110" stroke="#e4edf1" strokeDasharray="5 7"/>
      <line x1="34" x2="935" y1="45" y2="45" stroke="#e4edf1" strokeDasharray="5 7"/>
      <path d={path(first,low,high)} fill="none" stroke="#186c81" strokeWidth="3" strokeLinejoin="round"/>
      {delay!==0&&<path d={path(second,low,high)} fill="none" stroke="#b77638" strokeWidth="3" strokeLinejoin="round" strokeDasharray="8 5"/>}
    </svg>
    <div className="finance-stress-legend"><span><i className="finance-legend-original"/>Base documentada</span>
     {delay!==0&&<span><i className="finance-legend-scenario"/>Atraso hipotético</span>}
     <small>Primeiro evento {date(result.rows[0].date)} · último {date(result.rows.at(-1)!.date)}</small></div>
   </figure>
   <button className="secondary finance-stress-toggle" type="button"
     aria-expanded={showDetails} onClick={()=>setShowDetails(v=>!v)}>
     {showDetails?'Ocultar memória de cálculo':'Inspecionar memória de cálculo'} <ArrowDownRight size={14}/>
   </button>
   {showDetails&&<div className="table-wrap finance-stress-table"><table><thead><tr><th>Competência de evento</th>
    <th>Acumulado base</th><th>Acumulado estresse</th><th>Diferença</th></tr></thead><tbody>
    {result.rows.map(r=><tr key={r.date}><td>{date(r.date)}</td>
     <td className="amount">{amount(r.baselineRunningScaled)}</td><td className="amount">{amount(r.stressedRunningScaled)}</td>
     <td className="amount">{amount(r.deltaScaled)}</td></tr>)}
   </tbody></table></div>}
   <p className="finance-stress-disclaimer"><ShieldCheck size={15}/> Simulação exclusivamente em memória:
    posterga apenas a previsão de recebíveis já registrados. Não altera realizações, alocações bancárias nem produz saldo de caixa.
    A janela pode deixar recebimentos deslocados para além do último dia; esse valor é exposto acima.</p>
  </>}
 </section>;
