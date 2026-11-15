import "./public-demo.css";
import {
  Activity, ArrowDownRight, ArrowRight, Boxes, BriefcaseBusiness, Check,
  ChevronRight, CircleHelp, ClipboardList, Layers3, PackageCheck,
  ShieldCheck, ShoppingCart, Sparkles,
} from "lucide-react";

const sections = [
  { id: "visao-geral", label: "Visão geral", icon: Activity },
  { id: "pedidos", label: "Pedidos", icon: ClipboardList },
  { id: "estoque", label: "Estoque", icon: Boxes },
  { id: "compras", label: "Compras", icon: ShoppingCart },
  { id: "mrp", label: "Planejamento MRP", icon: Layers3 },
];

const workQueue = [
  { ref: "OS-DEMO-024", title: "Manutenção de equipamento", area: "Serviços de campo", status: "Em execução", tone: "blue" },
  { ref: "OS-DEMO-023", title: "Inspeção de frota", area: "Operação regional", status: "Aguardando medição", tone: "amber" },
  { ref: "OS-DEMO-022", title: "Reparo de infraestrutura", area: "Equipe Norte", status: "Planejada", tone: "green" },
];

export default function PublicDemoWorkspace() {
  return <div className="demo-app">
    <aside className="demo-sidebar" aria-label="Navegação principal">
      <a className="demo-brand" href="#visao-geral" aria-label="Cisne Rondônia, início">
        <span className="demo-brand-mark"><BriefcaseBusiness size={21}/></span>
        <span>CISNE<small>RONDÔNIA ERP</small></span>
      </a>
      <div className="demo-tenant"><span className="demo-tenant-avatar">CR</span><span><strong>Cisne Rondônia</strong><small>Workspace demonstrativo</small></span><ChevronRight size={15}/></div>
      <p className="demo-nav-caption">WORKSPACE</p>
      <nav>{sections.map(({id,label,icon:Icon},index)=><a key={id} href={`#${id}`} className={index===0?"demo-nav-link active":"demo-nav-link"}><Icon size={17} strokeWidth={1.8}/><span>{label}</span>{index===0&&<span className="demo-nav-dot"/>}</a>)}</nav>
      <div className="demo-sidebar-bottom"><div className="demo-protection"><ShieldCheck size={17}/><span><strong>Dados protegidos</strong><small>Operações reais exigem identidade validada.</small></span></div><span className="demo-version"><i/> STAGING · MODO DEMONSTRATIVO</span></div>
    </aside>
    <div className="demo-main">
      <header className="demo-topbar"><div className="demo-breadcrumb"><span>Workspace</span><ChevronRight size={14}/><strong>Visão geral</strong></div><div className="demo-topbar-right"><span className="demo-readonly"><ShieldCheck size={14}/> Somente demonstração</span><button type="button" className="demo-help" aria-label="Sobre esta demonstração"><CircleHelp size={18}/></button><span className="demo-profile" aria-label="Ambiente público demonstrativo">D</span></div></header>
      <main className="demo-content">
        <div className="demo-banner" role="note"><Sparkles size={17}/><p><strong>Ambiente demonstrativo</strong><span>Os registros desta tela são exemplos fictícios. Nenhuma alteração é gravada e os dados do ERP não são exibidos.</span></p><span className="demo-banner-tag">SEM LOGIN</span></div>
        <section id="visao-geral" className="demo-intro"><div><div className="demo-eyebrow"><Activity size={14}/> OPERAÇÃO EMPRESARIAL</div><h1>Bom trabalho.</h1><p>Uma visão clara das frentes operacionais, dos pedidos ao planejamento de materiais.</p></div><span className="demo-date">PAINEL DE DEMONSTRAÇÃO <ArrowRight size={14}/></span></section>
        <section className="demo-flow" aria-label="Etapas do processo"><div className="demo-flow-label"><span>FLUXO OPERACIONAL</span><small>Visão integrada</small></div>{["Pedidos","Execução","Estoque","Compras","MRP"].map((step,i)=><div className="demo-flow-step" key={step}><span className="demo-flow-number">0{i+1}</span><strong>{step}</strong>{i<4&&<ArrowRight className="demo-flow-arrow" size={15}/>}</div>)}</section>
        <section className="demo-summary" aria-label="Indicadores de demonstração">
          <article className="demo-stat"><div><span>Pedidos em acompanhamento</span><ClipboardList size={17}/></div><strong>Exemplo</strong><small><span className="demo-stat-pip blue"/> Fila operacional</small></article>
          <article className="demo-stat"><div><span>Materiais e disponibilidade</span><Boxes size={17}/></div><strong>Exemplo</strong><small><span className="demo-stat-pip amber"/> Consulta de estoque</small></article>
          <article className="demo-stat"><div><span>Planejamento de compras</span><ShoppingCart size={17}/></div><strong>Exemplo</strong><small><span className="demo-stat-pip green"/> Necessidades de material</small></article>
          <article className="demo-summary-note"><span className="demo-note-icon"><ShieldCheck size={19}/></span><div><strong>Sem conexão com dados reais</strong><p>O painel público mostra apenas exemplos e não consulta o PostgreSQL.</p></div></article>
        </section>
        <section id="pedidos" className="demo-panel">
          <div className="demo-panel-heading"><div><div className="demo-eyebrow">FILA DE TRABALHO</div><h2>Pedidos em acompanhamento</h2><p>Exemplos de estados e contexto de uma ordem operacional.</p></div><span className="demo-view-tag">EXEMPLOS FICTÍCIOS</span></div>
          <div className="demo-table-wrap"><table className="demo-table"><thead><tr><th>REFERÊNCIA</th><th>ASSUNTO</th><th>ÁREA RESPONSÁVEL</th><th>STATUS</th><th aria-label="Detalhe"/></tr></thead><tbody>{workQueue.map(row=><tr key={row.ref}><td className="demo-ref">{row.ref}</td><td><strong>{row.title}</strong><small>Registro de exemplo · sem vínculo com clientes reais</small></td><td>{row.area}</td><td><span className={`demo-status ${row.tone}`}><i/>{row.status}</span></td><td><ChevronRight size={16}/></td></tr>)}</tbody></table></div>
          <div className="demo-table-foot"><span><Check size={14}/> Exibição local · nenhuma API consultada</span><span>3 exemplos</span></div>
        </section>
        <section className="demo-module-grid" aria-label="Áreas demonstrativas">
          <article id="estoque" className="demo-module-card"><span className="demo-module-icon stock"><PackageCheck size={19}/></span><div className="demo-eyebrow">CONTROLE DE MATERIAIS</div><h2>Estoque</h2><p>Visualize como saldos, movimentações e materiais críticos podem ser organizados.</p><div className="demo-placeholder"><span><i/> Saldo disponível</span><strong>Exemplo</strong></div><a href="#compras">Ver fluxo de reposição <ArrowRight size={14}/></a></article>
          <article id="compras" className="demo-module-card"><span className="demo-module-icon procurement"><ShoppingCart size={19}/></span><div className="demo-eyebrow">SUPRIMENTOS</div><h2>Compras</h2><p>Acompanhe solicitações, pedidos e recebimentos dentro do processo operacional.</p><div className="demo-placeholder"><span><i/> Solicitações</span><strong>Exemplo</strong></div><a href="#mrp">Ver planejamento <ArrowRight size={14}/></a></article>
          <article id="mrp" className="demo-module-card"><span className="demo-module-icon planning"><Layers3 size={19}/></span><div className="demo-eyebrow">PLANEJAMENTO</div><h2>MRP</h2><p>Entenda a relação entre necessidade, disponibilidade e recomendação de compra.</p><div className="demo-placeholder"><span><i/> Necessidade líquida</span><strong>Exemplo</strong></div><a href="#visao-geral">Voltar à visão geral <ArrowDownRight size={14}/></a></article>
        </section>
        <footer className="demo-footer"><span>CISNE RONDÔNIA ERP <b>·</b> Workspace público de demonstração</span><span>As ações empresariais seguem restritas pela API.</span></footer>
      </main>
    </div>
  </div>;
}
