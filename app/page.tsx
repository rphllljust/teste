"use client";
import { EnterpriseDropdown } from './components/enterprise/EnterprisePrimitives';
import { EnterpriseButton, EnterpriseSearchField, EnterpriseInput, EnterpriseTextarea,} from './components/enterprise/EnterprisePrimitives';
import { useState, useEffect, useCallback, useRef } from "react";
import { EnterpriseSidebar, EnterpriseTopbar } from "./components/enterprise/EnterpriseAppNavigation";
import { EnterpriseWorkspaceContext } from "./components/enterprise/EnterpriseWorkspaceContext";
import { EnterpriseExperienceHub } from "./components/enterprise/EnterpriseExperienceHub";
import { EnterpriseStagingAccess } from "./components/enterprise/EnterpriseStagingAccess";
import { EnterpriseProcessJourney } from "./components/enterprise/EnterpriseProcessJourney";
import { EnterpriseModuleWorkspace } from "./components/enterprise/EnterpriseModuleWorkspace";
import PayablesWorkspace from "./PayablesWorkspace";
import ClientsWorkspace, { type Client } from "./ClientsWorkspace";
import ProposalsWorkspace from "./ProposalsWorkspace";
import ContractsWorkspace, { type Contract } from "./ContractsWorkspace";
import ExecutionWorkspace from "./ExecutionWorkspace";
import OrderNextcrmDocuments from "./OrderNextcrmDocuments";
import OrderPreparation from "./OrderPreparation";
import MeasurementPreparation from "./MeasurementPreparation";
import BillingPreparation from "./BillingPreparation";
import FinanceOverviewWorkspace from "./FinanceOverviewWorkspace";
import CashFlowWorkspace from "./CashFlowWorkspace";
import TreasuryWorkspace from "./TreasuryWorkspace";
import LedgerWorkspace from "./LedgerWorkspace";
import BankReconciliationWorkspace from "./BankReconciliationWorkspace";
import AccountingWorkspace from "./AccountingWorkspace";
import FiscalWorkspace from "./FiscalWorkspace";
import CloseCenterWorkspace from "./CloseCenterWorkspace";
import InventoryWorkspace from "./InventoryWorkspace";
import ProcurementWorkspace from "./ProcurementWorkspace";
import EnterpriseCommandCenter from "./EnterpriseCommandCenter";
import type { ControlTowerLaneId } from "./EnterpriseControlTower";
import CRMWorkspace from "./CRMWorkspace";
import MRPWorkspace from "./MRPWorkspace";
import ProfessionalsWorkspace from "./ProfessionalsWorkspace";
import AssetsWorkspace from "./AssetsWorkspace";
import ServiceOperationsAgenda from "./ServiceOperationsAgenda";
import ServiceOperationsWorkspace from "./ServiceOperationsWorkspace";
import FieldServiceCockpit from "./FieldServiceCockpit";
import ResourcePlanningBoard from "./ResourcePlanningBoard";
import type { LucideIcon } from "lucide-react";
import { statusNames, moneyScaled } from "../lib/domain/orders";
import { executionQuantity } from "../lib/domain/execution";
import {
  Activity,
  LayoutDashboard,
  ClipboardList,
  Users,
  Truck,
  Wallet,
  Receipt,
  Landmark,
  BookOpen,
  Package,
  Search,
  Plus,
  ChevronRight,
  ChevronDown,
  X,
  SlidersHorizontal,
  RefreshCw,
  Check,
  FileText,
  ArrowUpRight,
  PanelLeft,
  Command,
  Layers,
  HardHat,
  CalendarDays,
  Building2,
  Filter,
  ChevronLeft,
  CircleAlert,
} from "lucide-react";
import type {
  AvailableCommand,
  PageInfo,
  ViewDefinition,
} from "../lib/contracts";
import type { FinancialDefinition } from "../lib/api/view-definitions";
type Order = {
  availableCommands: AvailableCommand[];
  client_id?: string | null;
  contract_id?: string | null;
  relations?: {
    clientId?: string | null;
    contractId?: string | null;
    measurements: number;
    invoices: number;
    receivables: number;
  };
  sublists?: {
    history: { items: Event[]; pageInfo: { total: number; hasMore: boolean } };
  };
  status: string;
  version: number;
  id: string;
  title: string;
  client: string;
  category: string;
  description: string;
  due_date: string | null;
  created_at: string;
};
const modules: { group: string; items: [string, LucideIcon][] }[] = [
  // Keep the existing public workspace names and navigation contracts intact.
  // Each business domain owns a coherent set of workspaces, not a CRUD menu.
  // ['CRM e Vendas',Users] — canonical module marker retained for source-contract checks.
  // page==='CRM e Vendas'?<CRMWorkspace — legacy source contract marker.
  {
    group: "OPERAÇÃO",
    items: [
      ["Visão operacional", LayoutDashboard],
      ["Centro de operações", Activity],
      ["Ordens de serviço", ClipboardList],
      ["Execução", HardHat],
      ["Medições", SlidersHorizontal],
    ],
  },
  {
    group: "PLANEJAMENTO E RECURSOS",
    items: [
      ["Field Service Cockpit", Activity],
      ["Resource Planning Board", CalendarDays],
      ["Frota e ativos", Truck],
      ["Profissionais", HardHat],
    ],
  },
  {
    group: "RELACIONAMENTO",
    items: [
      ["CRM e Vendas", Users],
      ["Clientes e propostas", Users],
      ["Propostas e PO", FileText],
      ["Contratos", FileText],
    ],
  },
  {
    group: "FINANÇAS",
    items: [
      ["Faturamento", Receipt],
      ["Visão financeira", LayoutDashboard],
      ["Financeiro", Wallet],
      ["Fluxo de caixa", Wallet],
      ["Tesouraria", Landmark],
      ["Contas a pagar", Receipt],
      ["Caixa e conciliação", Landmark],
    ],
  },
  {
    group: "SUPRIMENTOS",
    items: [
      ["Compras", Package],
      ["Estoque e compras", Package],
    ],
  },
  {
    group: "FISCAL E CONTABILIDADE",
    items: [
      ["Fiscal e tributos", FileText],
      ["Contabilidade", BookOpen],
      ["Razão contábil", BookOpen],
      ["Fechamentos", CalendarDays],
    ],
  },
];
const chain = [
  "Ordem de serviço",
  "Execução",
  "Medição",
  "Faturamento",
  "Financeiro",
  "Fiscal",
  "Contabilidade",
];
type Linked = {
  availableCommands: AvailableCommand[];
  facts?: { outstandingScaled: string; settledScaled: string };
  amountScaled: string;
  id: string;
  order_id: string;
  title: string;
  client: string;
  description?: string;
  status: string;
  version: number;
  due_date: string;
  created_at: string;
};
type LinkedMetric = {
  metricId: string;
  label: string;
  value: number | string | null;
  scale?: number;
  status: "available" | "unknown";
  authority: string;
  generatedAt: string;
  drilldown: { viewKey: string; filters: Record<string, string> };
};
type BusinessSearchItem={id:string;kind:'client'|'proposal'|'contract';title:string;subtitle:string;status:string};
type Event = {
  label: string;
  id: string;
  order_id: string;
  command: string;
  created_at: string;
};
type ReceivableContext = {
  evidence?: {
    id: string;
    resourceKind: string;
    description: string;
    quantityScaled: string;
    unit: string;
    effectiveDate: string;
    reference: string;
  }[];
  evidencePageInfo?: { page: number; total: number; hasMore: boolean };
  availableCommands?: AvailableCommand[];
  identity: {
    id: string;
    title: string;
    subtitle: string;
    entityKey?: "measurements" | "invoices" | "receivables";
  };
  state?: { code: string; label: string; rowVersion: number | null };
  facts: {
    principalScaled: string;
    dueDate: string | null;
    createdAt: string;
    outstandingScaled: string | null;
    settledScaled: string | null;
  };
  settlementsPageInfo?: { page: number; total: number; hasMore: boolean };
  settlements?: {
    canReverse: number;
    id: string;
    kind: "receipt" | "reversal";
    amountScaled: string;
    effectiveDate: string;
    reference: string;
    reversed: number;
  }[];
  relations: {
    orderId: string;
    orderTitle: string;
    measurementId: string;
    measurementDescription: string;
    invoiceId: string | null;
    receivableId?: string | null;
  };
  warnings: string[];
};
const categories = [
  "Todas as atividades",
  "Locação",
  "Serviços",
  "Transporte",
  "Obra",
];
function date(v: string | null) {
  return v
    ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(
        new Date(v.length === 10 ? v + "T12:00:00Z" : v),
      )
    : "Não informado";
}
function HomeView() {
  const [mrpMaterialId, setMrpMaterialId] = useState("");
  const [mrpOrderId, setMrpOrderId] = useState("");
  const [payableOrigin, setPayableOrigin] = useState("");
  const [supplyView, setSupplyView] = useState<"inventory" | "mrp">(
    "inventory",
  );
  const [page, setPage] = useState("Visão operacional"),
    [orders, setOrders] = useState<Order[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState(categories[0]),
    [view, setView] = useState("Todas as ordens"),
    [selected, setSelected] = useState<Order | null>(null),
    [creating, setCreating] = useState(false),
    [saving, setSaving] = useState(false),
    [notice, setNotice] = useState(""),
    [noticeTone, setNoticeTone] = useState<"success" | "error">("success"),
    [sidebar, setSidebar] = useState(false),
    [palette, setPalette] = useState(false),
    [pageNumber, setPageNumber] = useState(1),
    [total, setTotal] = useState(0),
    [summary, setSummary] = useState({
      total: 0,
      drafts: 0,
      planned: 0,
      pendingMeasurements: 0,
    }),
    [operation, setOperation] = useState<{
      measurements: Linked[];
      invoices: Linked[];
      receivables: Linked[];
      events: Event[];
      relations: {
        order_id: string;
        measurements: number;
        invoices: number;
        receivables: number;
      }[];
    }>({
      measurements: [],
      invoices: [],
      receivables: [],
      events: [],
      relations: [],
    }),
    [operationError, setOperationError] = useState(""),
    [savedViews, setSavedViews] = useState<
      {
        id: string;
        name: string;
        query: string;
        category: string;
        view: string;
        rowVersion: number;
        isDefault: boolean;
        compatible: boolean;
        definition: ViewDefinition | null;
      }[]
    >([]),
    [savingView, setSavingView] = useState(false),
    [viewKey, setViewKey] = useState(""),
    [viewNotice, setViewNotice] = useState(""),
    [paletteQuery, setPaletteQuery] = useState(""),
    [action, setAction] = useState<{
      command: string;
      record: Order | Linked;
      key: string;
    } | null>(null);
  const [sort, setSort] = useState("createdAt.desc"),
    [pageSize, setPageSize] = useState(25),
    [generatedAt, setGeneratedAt] = useState(""),
    [linkedNumber, setLinkedNumber] = useState(1),
    [linkedInfo, setLinkedInfo] = useState<PageInfo | null>(null),
    [linkedLoading, setLinkedLoading] = useState(false),
    [businessOrder, setBusinessOrder] = useState(""),
    [contextError, setContextError] = useState("");
  const [receivableContext, setReceivableContext] =
    useState<ReceivableContext | null>(null);
  const [orderRelation, setOrderRelation] = useState<{
    orderId: string;
    kind: string;
    id: string;
    loading: boolean;
    error: string;
    projection?: {
      legalName?: string;
      reference?: string;
      scope?: string;
      document?: string | null;
      email?: string | null;
      clientName?: string;
      proposalId?: string;
      proposalTitle?: string;
      purchaseOrderId?: string | null;
      poReference?: string | null;
      state?: { label: string };
      history?: { command: string; createdAt: string }[];
    };
  } | null>(null);
  const [settlementAction, setSettlementAction] = useState<{
    command: "record_receipt" | "reverse_receipt";
    key: string;
    reversesId?: string;
  } | null>(null);
  const [docked, setDocked] = useState(false),
    [paletteResult, setPaletteResult] = useState<{
      items: Order[];
      total: number;
      query: string;
    }>({ items: [], total: 0, query: "" }),
    [paletteLoading, setPaletteLoading] = useState(false),
    [paletteError, setPaletteError] = useState("");
  const [businessSearch,setBusinessSearch]=useState<{items:BusinessSearchItem[];query:string}>({items:[],query:''});
  const [businessSearchLoading,setBusinessSearchLoading]=useState(false),[businessSearchError,setBusinessSearchError]=useState('');
  const [linkedViews, setLinkedViews] = useState<
      {
        id: string;
        name: string;
        rowVersion: number;
        isDefault: boolean;
        compatible: boolean;
        definition: FinancialDefinition | null;
      }[]
    >([]),
    [savingViewFor, setSavingViewFor] = useState("serviceOrders.worklist");
  const [linkedQuery, setLinkedQuery] = useState(""),
    [linkedSort, setLinkedSort] = useState("createdAt.desc"),
    [linkedSize, setLinkedSize] = useState(25),
    [linkedStatus, setLinkedStatus] = useState(""),
    [settlementState, setSettlementState] = useState(""),
    [dueFrom, setDueFrom] = useState(""),
    [dueTo, setDueTo] = useState(""),
    [linkedMetrics, setLinkedMetrics] = useState<LinkedMetric[]>([]),
    [linkedGeneratedAt, setLinkedGeneratedAt] = useState("");
  const [drillFilters, setDrillFilters] = useState<Record<string, string>>({}),
    [bankAccount, setBankAccount] = useState("");
  const [orderClient, setOrderClient] = useState<Client | null>(null),
    [businessClient, setBusinessClient] = useState("");
  const [orderContract, setOrderContract] = useState<Contract | null>(null),
    [businessContract, setBusinessContract] = useState(""),
    [commercialOrigin, setCommercialOrigin] = useState(""),
    [contractOrigin, setContractOrigin] = useState(""),
    [clientOrigin, setClientOrigin] = useState(""),
    [executionOrder, setExecutionOrder] = useState("");
  const defaultsApplied = useRef(false);
  const operationGeneration = useRef(0);
  const requestGeneration = useRef(0);
  const chainViewport = useRef<HTMLDivElement>(null);
  const [chainEdges, setChainEdges] = useState({ before: false, after: false });
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1440px)");
    const update = () => setDocked(media.matches);
    const timer = setTimeout(update, 0);
    media.addEventListener("change", update);
    return () => {
      clearTimeout(timer);
      media.removeEventListener("change", update);
    };
  }, []);
  useEffect(() => {
    if (!palette) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setPaletteError("");
      if (paletteQuery.trim().length < 2) {
        setPaletteResult({ items: [], total: 0, query: paletteQuery.trim() });
        setPaletteLoading(false);
        return;
      }
      setPaletteLoading(true);
      try {
        const r = await fetch(
          "/api/orders?" +
            new URLSearchParams({ q: paletteQuery.trim(), pageSize: "10" }),
          { signal: controller.signal },
        );
        const d = (await r.json()) as {
          items: Order[];
          total: number;
          error?: string;
        };
        if (!r.ok) throw new Error(d.error);
        if (!controller.signal.aborted)
          setPaletteResult({
            items: d.items,
            total: d.total,
            query: paletteQuery.trim(),
          });
      } catch (e) {
        if (!controller.signal.aborted)
          setPaletteError(
            e instanceof Error ? e.message : "Busca indisponível.",
          );
      } finally {
        if (!controller.signal.aborted) setPaletteLoading(false);
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [palette, paletteQuery]);
  useEffect(()=>{
    if(!palette)return;
    const query=paletteQuery.trim();
    if(query.length<2)return;
    const controller=new AbortController();
    const timer=setTimeout(async()=>{
      setBusinessSearch({items:[],query});setBusinessSearchLoading(true);setBusinessSearchError('');
      try{
        const params=new URLSearchParams({q:query,page:'1',pageSize:'5'});
        const [clientResponse,proposalResponse,contractResponse]=await Promise.all([
          fetch('/api/clients?'+params,{signal:controller.signal}),
          fetch('/api/proposals?'+params,{signal:controller.signal}),
          fetch('/api/contracts?'+params,{signal:controller.signal}),
        ]);
        const [clients,proposals,contracts]=await Promise.all([
          clientResponse.json() as Promise<{items:{id:string;legalName:string;document:string|null;state:{label:string}}[];error?:string}>,
          proposalResponse.json() as Promise<{items:{id:string;title:string;clientName:string;state:{label:string}}[];error?:string}>,
          contractResponse.json() as Promise<{items:{id:string;reference:string;clientName:string;state:{label:string}}[];error?:string}>,
        ]);
        if(!clientResponse.ok||!proposalResponse.ok||!contractResponse.ok)throw new Error(clients.error||proposals.error||contracts.error||'Busca empresarial indisponível.');
        if(!controller.signal.aborted)setBusinessSearch({query,items:[
          ...clients.items.map(x=>({id:x.id,kind:'client' as const,title:x.legalName,subtitle:x.document??'Documento não informado',status:x.state.label})),
          ...proposals.items.map(x=>({id:x.id,kind:'proposal' as const,title:x.title,subtitle:x.clientName,status:x.state.label})),
          ...contracts.items.map(x=>({id:x.id,kind:'contract' as const,title:x.reference,subtitle:x.clientName,status:x.state.label})),
        ]});
      }catch(e){if(!controller.signal.aborted)setBusinessSearchError(e instanceof Error?e.message:'Busca empresarial indisponível.');}
      finally{if(!controller.signal.aborted)setBusinessSearchLoading(false);}
    },180);
    return()=>{clearTimeout(timer);controller.abort();};
  },[palette,paletteQuery]);
  function handleQueueKey(e: React.KeyboardEvent<HTMLTableElement>) {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    const buttons = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>(".row-link"),
    );
    const index = buttons.indexOf(e.target as HTMLButtonElement);
    if (index < 0) return;
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? buttons.length - 1
          : Math.min(
              buttons.length - 1,
              Math.max(0, index + (e.key === "ArrowUp" ? -1 : 1)),
            );
    e.preventDefault();
    buttons[next]?.focus();
    const order = orders[next];
    if (order && docked) setSelected(order);
  }
  const updateChainEdges = useCallback(() => {
    const el = chainViewport.current;
    if (!el) return;
    const before = el.scrollLeft > 2,
      after = el.scrollWidth - el.clientWidth - el.scrollLeft > 2;
    setChainEdges((old) =>
      old.before === before && old.after === after ? old : { before, after },
    );
  }, []);
  useEffect(() => {
    const el = chainViewport.current;
    if (!el) return;
    const observer = new ResizeObserver(updateChainEdges);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [updateChainEdges]);
  function scrollChain(direction: number) {
    const el = chainViewport.current;
    if (!el) return;
    el.scrollBy({
      left: direction * Math.max(180, el.clientWidth * 0.65),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }
  function handleChainKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const el = chainViewport.current;
    if (!el) return;
    const buttons = Array.from(
      el.querySelectorAll<HTMLButtonElement>("button[data-stage-index]"),
    );
    const index = buttons.indexOf(e.target as HTMLButtonElement);
    if (index < 0) {
      el.scrollTo({
        left:
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? el.scrollWidth
              : el.scrollLeft + (e.key === "ArrowLeft" ? -180 : 180),
        behavior: "instant",
      });
      return;
    }
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? buttons.length - 1
          : Math.min(
              buttons.length - 1,
              Math.max(0, index + (e.key === "ArrowLeft" ? -1 : 1)),
            );
    buttons[next]?.focus({ preventScroll: true });
    buttons[next]?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: "instant",
    });
  }
  function applyView(nextView: string) {
    defaultsApplied.current = true;
    setPageNumber(1);
    setView(nextView);
    setQuery("");
    setCategory(categories[0]);
  }
  function metricValue(value: number | null | undefined) {
    return loading || error || value == null || !Number.isFinite(value)
      ? "—"
      : String(value);
  }
  function nextCommand(order: Order | Linked) {
    const c = order.availableCommands?.find((c) => c.primary);
    return c ? { name: c.id, label: c.label } : null;
  }
  const loadViews = useCallback(async () => {
    try {
      const r = await fetch("/api/views");
      const d = (await r.json()) as {
        views: typeof savedViews;
        error?: string;
      };
      if (!r.ok) throw new Error(d.error);
      setSavedViews(d.views);
      if (!defaultsApplied.current) {
        defaultsApplied.current = true;
        const v = d.views.find((v) => v.isDefault && v.compatible);
        if (v?.definition) {
          setPageNumber(1);
          setQuery(v.query);
          setCategory(v.category);
          setView(v.view);
          setSort(v.definition.sort);
          setPageSize(v.definition.pageSize);
        }
      }
    } catch {
      setViewNotice("");
    }
  }, []);
  async function defaultView(
    v: { id: string; rowVersion: number; isDefault: boolean },
    linked = false,
  ) {
    setViewNotice("");
    try {
      const r = await fetch("/api/views/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: v.id,
          rowVersion: v.rowVersion,
          key: crypto.randomUUID(),
          command: v.isDefault ? "clear_default" : "set_default",
        }),
      });
      const d = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(d.error);
      if (linked) await loadLinkedViews();
      else await loadViews();
    } catch (e) {
      setViewNotice(
        e instanceof Error ? e.message : "Falha ao definir consulta padrão.",
      );
    }
  }
  const loadLinkedViews = useCallback(async () => {
    if (!["Medições", "Faturamento", "Financeiro"].includes(page)) return;
    const kind =
      page === "Medições"
        ? "measurements"
        : page === "Faturamento"
          ? "invoices"
          : "receivables";
    try {
      const r = await fetch(
        "/api/views?" + new URLSearchParams({ viewKey: "operation." + kind }),
      );
      const d = (await r.json()) as {
        views: typeof linkedViews;
        error?: string;
      };
      if (!r.ok) throw new Error(d.error);
      setLinkedViews(d.views);
    } catch (e) {
      setViewNotice(
        e instanceof Error ? e.message : "Consultas indisponíveis.",
      );
    }
  }, [page]);
  const loadOperation = useCallback(async () => {
    const generation = ++operationGeneration.current;
    if (!["Medições", "Faturamento", "Financeiro"].includes(page)) return;
    setLinkedLoading(true);
    setOperationError("");
    try {
      const kind =
        page === "Medições"
          ? "measurements"
          : page === "Faturamento"
            ? "invoices"
            : "receivables";
      const r = await fetch(
        "/api/operation?" +
          new URLSearchParams({
            kind,
            q: linkedQuery,
            sort: linkedSort,
            page: String(linkedNumber),
            pageSize: String(linkedSize),
            ...(businessOrder ? { orderId: businessOrder } : {}),
            ...(page === "Medições" && linkedStatus
              ? { status: linkedStatus }
              : {}),
            ...(page === "Financeiro" && settlementState
              ? { settlementState }
              : {}),
            ...(dueFrom ? { dueFrom } : {}),
            ...(dueTo ? { dueTo } : {}),
          }),
      );
      const d = (await r.json()) as typeof operation & {
        error?: string;
        pageInfo: PageInfo;
        aggregates: LinkedMetric[];
        generatedAt: string;
      };
      if (!r.ok) throw new Error(d.error);
      if (generation !== operationGeneration.current) return;
      setOperation(d);
      setLinkedInfo(d.pageInfo);
      setLinkedMetrics(d.aggregates);
      setLinkedGeneratedAt(d.generatedAt);
    } catch (e) {
      if (generation === operationGeneration.current)
        setOperationError(
          e instanceof Error ? e.message : "Registros indisponíveis.",
        );
    } finally {
      if (generation === operationGeneration.current) setLinkedLoading(false);
    }
  }, [
    page,
    linkedNumber,
    businessOrder,
    linkedQuery,
    linkedSort,
    linkedSize,
    linkedStatus,
    settlementState,
    dueFrom,
    dueTo,
  ]);
  const load = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setLoading(true);
    setError("");
    try {
      const r = await fetch(
        "/api/orders?" +
          new URLSearchParams({
            q: query,
            category,
            view,
            page: String(pageNumber),
            sort,
            pageSize: String(pageSize),
            ...(businessClient ? { clientId: businessClient } : {}),
            ...(businessContract ? { contractId: businessContract } : {}),
          }),
      );
      const raw = await r.text();
      let d: {
        error?: string;
        orders: Order[];
        total: number;
        summary: typeof summary;
        generatedAt: string;
      };
      try {
        d = JSON.parse(raw) as typeof d;
      } catch {
        throw new Error(
          r.ok ? "Resposta inválida do servidor." : "Serviço indisponível.",
        );
      }
      if (!r.ok) throw new Error(d.error || "Falha ao carregar ordens.");
      // SQL drivers may serialize aggregate values as strings and SUM() returns
      // null for an empty set. Normalize the verified projection before rendering
      // so a valid authorized response is not incorrectly treated as unavailable.
      const normalizedTotal = Number(d.total);
      const normalizedSummary = d.summary
        ? {
            total: Number(d.summary.total),
            drafts: Number(d.summary.drafts ?? 0),
            planned: Number(d.summary.planned ?? 0),
            pendingMeasurements: Number(d.summary.pendingMeasurements ?? 0),
          }
        : null;
      if (
        !Array.isArray(d.orders) ||
        !Number.isSafeInteger(normalizedTotal) ||
        normalizedTotal < 0 ||
        normalizedTotal < d.orders.length ||
        !normalizedSummary ||
        !Number.isSafeInteger(normalizedSummary.total) ||
        normalizedSummary.total < 0 ||
        !Number.isSafeInteger(normalizedSummary.drafts) ||
        !Number.isSafeInteger(normalizedSummary.planned) ||
        !Number.isSafeInteger(normalizedSummary.pendingMeasurements) ||
        normalizedSummary.drafts < 0 ||
        normalizedSummary.planned < 0 ||
        normalizedSummary.pendingMeasurements < 0
      ) {
        throw new Error("O servidor não confirmou os dados operacionais.");
      }
      if (generation !== requestGeneration.current) return;
      setOrders(d.orders);
      setTotal(normalizedTotal);
      setSummary(normalizedSummary);
      setGeneratedAt(d.generatedAt);
    } catch (e) {
      if (generation === requestGeneration.current)
        setError(e instanceof Error ? e.message : "Falha ao carregar.");
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [
    query,
    category,
    view,
    pageNumber,
    sort,
    pageSize,
    businessClient,
    businessContract,
  ]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 180);
    return () => clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    const timer = setTimeout(() => void loadOperation(), 0);
    return () => clearTimeout(timer);
  }, [loadOperation]);

  useEffect(() => {
    const t = setTimeout(() => void loadViews(), 0);
    return () => clearTimeout(t);
  }, [loadViews]);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      }
      if (e.key === "Escape") {
        setPalette(false);
        setSelected(null);
        setReceivableContext(null);
        setAction(null);
        setSavingView(false);
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  function navigate(name: string, orderId = "") {
    setBusinessClient("");
    setBusinessContract("");
    setCommercialOrigin("");
    setContractOrigin("");
    setClientOrigin("");
    setDrillFilters({});
    setPayableOrigin("");
    setBankAccount("");
    operationGeneration.current++;
    setLinkedViews([]);
    setLinkedMetrics([]);
    setLinkedGeneratedAt("");
    setLinkedQuery("");
    setLinkedStatus("");
    setSettlementState("");
    setDueFrom("");
    setDueTo("");
    setLinkedLoading(["Medições", "Faturamento", "Financeiro"].includes(name));
    setBusinessOrder(orderId);
    setLinkedNumber(1);
    setPage(name);
    // Use the native hash transition so the route listener and browser history
    // observe the same workspace change as the local React state.
    const nextHash = "#" + encodeURIComponent(name);
    if (window.location.hash !== nextHash) window.location.hash = encodeURIComponent(name);
    setSelected(null);
    setReceivableContext(null);
    setLinkedInfo(null);
    setOperation({
      measurements: [],
      invoices: [],
      receivables: [],
      events: [],
      relations: [],
    });
    setSidebar(false);
    setPalette(false);
    setQuery("");
  }
  useEffect(() => {
    function route() {
      const name = decodeURIComponent(window.location.hash.slice(1));
      if (modules.some((g) => g.items.some(([n]) => n === name))) setPage(name);
    }
    const timer = setTimeout(route, 0);
    window.addEventListener("hashchange", route);
    window.addEventListener("popstate", route);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("hashchange", route);
      window.removeEventListener("popstate", route);
    };
  }, []);
  useEffect(() => {
    if (
      !selected &&
      !receivableContext &&
      !creating &&
      !action &&
      !palette &&
      !savingView
    )
      return;
    if (
      selected &&
      docked &&
      !receivableContext &&
      !creating &&
      !action &&
      !palette &&
      !savingView
    )
      return;
    const before = document.activeElement as HTMLElement | null;
    function trap(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const panels = document.querySelectorAll(".overlay");
      const panel = panels[panels.length - 1];
      const nodes = panel?.querySelectorAll<HTMLElement>(
        "button:not(:disabled),input,select,textarea,a[href]",
      );
      if (!nodes?.length) return;
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      before?.focus();
    };
  }, [
    selected,
    receivableContext,
    creating,
    action,
    palette,
    savingView,
    docked,
  ]);
  function applyLinkedView(d: FinancialDefinition) {
    changeLinked(() => {
      setLinkedQuery(d.filters.q);
      setLinkedSort(d.sort);
      setLinkedSize(d.pageSize);
      setBusinessOrder(d.filters.orderId ?? "");
      setLinkedStatus(d.filters.status ?? "");
      setSettlementState(d.filters.settlementState ?? "");
      setDueFrom(d.filters.dueFrom ?? "");
      setDueTo(d.filters.dueTo ?? "");
    });
  }
  function changeLinked(update: () => void) {
    operationGeneration.current++;
    setLinkedLoading(true);
    setLinkedNumber(1);
    update();
  }
  function clearLinkedFilters() {
    changeLinked(() => {
      setLinkedQuery("");
      setLinkedStatus("");
      setSettlementState("");
      setDueFrom("");
      setDueTo("");
    });
  }
  function drillLinked(metric: LinkedMetric) {
    const f = metric.drilldown.filters;
    changeLinked(() => {
      setLinkedQuery(f.q ?? "");
      setLinkedSort(f.sort ?? "createdAt.desc");
      setLinkedStatus(f.status ?? "");
      setSettlementState(f.settlementState ?? "");
      setBusinessOrder(f.orderId ?? "");
      setDueFrom(f.dueFrom ?? "");
      setDueTo(f.dueTo ?? "");
    });
    document.getElementById("linked-results")?.focus();
  }
  function newOrder() {
    setSelected(null);
    setOrderContract(null);
    setOrderClient(null);
    setCreating(true);
    setNotice("");
  }

  async function saveView(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const f = new FormData(e.currentTarget);
    try {
      const body =
        savingViewFor === "serviceOrders.worklist"
          ? {
              id: viewKey,
              name: f.get("name"),
              query,
              category,
              view,
              definition: {
                schemaVersion: 1,
                entityKey: "serviceOrder",
                viewKey: "serviceOrders.worklist",
                filters: { query, category, view },
                sort,
                visibleColumns: [
                  "order",
                  "client",
                  "status",
                  "dueDate",
                  "nextAction",
                ],
                pageSize,
              },
            }
          : {
              id: viewKey,
              name: f.get("name"),
              definition: {
                schemaVersion: 2,
                entityKey:
                  savingViewFor === "operation.measurements"
                    ? "measurement"
                    : savingViewFor === "operation.invoices"
                      ? "invoice"
                      : "receivable",
                viewKey: savingViewFor,
                filters: {
                  q: linkedQuery,
                  ...(businessOrder ? { orderId: businessOrder } : {}),
                  ...(savingViewFor === "operation.measurements" && linkedStatus
                    ? { status: linkedStatus }
                    : {}),
                  ...(savingViewFor === "operation.receivables" &&
                  settlementState
                    ? { settlementState }
                    : {}),
                  ...(dueFrom ? { dueFrom } : {}),
                  ...(dueTo ? { dueTo } : {}),
                },
                sort: linkedSort,
                visibleColumns: [
                  "origin",
                  "description",
                  "principal",
                  "state",
                  "nextAction",
                ],
                pageSize: linkedSize,
              },
            };
      const r = await fetch("/api/views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(d.error);
      if (savingViewFor === "serviceOrders.worklist") await loadViews();
      else await loadLinkedViews();
      setSavingView(false);
      setNoticeTone("success");
      setNotice("Consulta salva.");
    } catch (e) {
      setViewNotice(
        e instanceof Error ? e.message : "Falha ao salvar consulta.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function openReceivable(
    id: string,
    kind: "measurements" | "invoices" | "receivables" = "receivables",
    historyPage = 1,
    evidencePage = 1,
  ) {
    try {
      const r = await fetch(
        "/api/operation/" +
          kind +
          "/" +
          encodeURIComponent(id) +
          "?" +
          new URLSearchParams({
            historyPage: String(historyPage),
            evidencePage: String(evidencePage),
          }),
      );
      const d = (await r.json()) as {
        projection: ReceivableContext;
        error?: string;
      };
      if (!r.ok) throw new Error(d.error);
      setReceivableContext(d.projection);
    } catch (e) {
      setNoticeTone("error");
      setNotice(e instanceof Error ? e.message : "Título indisponível.");
    }
  }
  async function submitSettlement(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!receivableContext || !settlementAction) return;
    setSaving(true);
    setNotice("");
    const f = new FormData(e.currentTarget);
    try {
      const r = await fetch(
        "/api/receivables/" +
          encodeURIComponent(receivableContext.identity.id) +
          "/settlements",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            command: settlementAction.command,
            key: settlementAction.key,
            version: receivableContext.state?.rowVersion,
            amount:
              settlementAction.command === "record_receipt"
                ? f.get("amount")
                : undefined,
            effectiveDate: f.get("effectiveDate"),
            reference: f.get("reference"),
            reversesId: settlementAction.reversesId,
          }),
        },
      );
      const d = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(d.error);
      setSettlementAction(null);
      await Promise.all([
        openReceivable(receivableContext.identity.id),
        loadOperation(),
      ]);
      setNoticeTone("success");
      setNotice("Lançamento registrado.");
    } catch (e) {
      setNoticeTone("error");
      setNotice(e instanceof Error ? e.message : "Falha no lançamento.");
    } finally {
      setSaving(false);
    }
  }
  async function openOrderRelation(
    kind: "clients" | "contracts" | "proposals" | "purchase-orders",
    id: string,
    orderId: string,
  ) {
    setOrderRelation({ kind, id, orderId, loading: true, error: "" });
    try {
      const r = await fetch("/api/" + kind + "/" + encodeURIComponent(id));
      const d = (await r.json()) as {
        projection?: NonNullable<typeof orderRelation>["projection"];
        error?: string;
      };
      if (!r.ok || !d.projection)
        throw new Error(d.error ?? "Contexto indisponível.");
      setOrderRelation({
        kind,
        id,
        orderId,
        loading: false,
        error: "",
        projection: d.projection,
      });
    } catch (e) {
      setOrderRelation({
        kind,
        id,
        orderId,
        loading: false,
        error: e instanceof Error ? e.message : "Contexto indisponível.",
      });
    }
  }
  async function openOrigin(id: string) {
    try {
      const r = await fetch("/api/orders/" + encodeURIComponent(id));
      const d = (await r.json()) as { order?: Order; error?: string };
      if (!r.ok || !d.order) throw new Error(d.error);
      setContextError("");
      setSelected(d.order);
    } catch (e) {
      setNoticeTone("error");
      setNotice(e instanceof Error ? e.message : "Origem indisponível.");
    }
  }
  useEffect(() => {
    if (!selected || selected.sublists) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setContextError("");
      void fetch("/api/orders/" + encodeURIComponent(selected.id))
        .then(async (r) => {
          const d = (await r.json()) as { order: Order; error?: string };
          if (!r.ok) throw new Error(d.error);
          if (!cancelled) setSelected(d.order);
        })
        .catch((e) => {
          if (!cancelled)
            setContextError(
              e instanceof Error ? e.message : "Contexto indisponível.",
            );
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [selected]);
  async function execute(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!action) return;
    setSaving(true);
    setNotice("");
    const f = new FormData(e.currentTarget);
    try {
      const r = await fetch("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: action.record.id,
          version: action.record.version,
          key: action.key,
          command: action.command,
          description: f.get("description") || undefined,
          amount: f.get("amount") || undefined,
          dueDate: f.get("dueDate") || undefined,
        }),
      });
      const d = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(d.error);
      setAction(null);
      setSelected(null);
      setNoticeTone("success");
      setNotice("Comando executado. Registros atualizados.");
      await Promise.all([load(), loadOperation()]);
    } catch (e) {
      setNoticeTone("error");
      setNotice(e instanceof Error ? e.message : "Falha ao executar.");
    } finally {
      setSaving(false);
    }
  }
  function command(c: string, r: Order | Linked) {
    const allowed = r.availableCommands?.find((item) => item.id === c);
    if (!allowed) return;
    setNotice("");
    if (c === "measure" || c === "invoice") {
      setSelected(null);
      setReceivableContext(null);
    }
    setAction({
      command: c,
      record: { ...r, version: allowed.expectedVersion },
      key: crypto.randomUUID(),
    });
  }
  const filtered = orders; // Filtering and pagination remain authoritative on the existing server contract.
  const linkedPage = ["Medições", "Faturamento", "Financeiro"].includes(page);
  const linkedRows =
    page === "Medições"
      ? operation.measurements
      : page === "Faturamento"
        ? operation.invoices
        : operation.receivables;
  function drillFinance(d: {
    viewKey: string;
    filters: Record<string, string>;
  }) {
    if (d.viewKey === "payables.worklist") {
      navigate("Contas a pagar");
      setDrillFilters(d.filters);
      return;
    }
    navigate("Financeiro");
    setLinkedQuery(d.filters.q ?? "");
    setSettlementState(d.filters.settlementState ?? "");
    setDueFrom(d.filters.dueFrom ?? "");
    setDueTo(d.filters.dueTo ?? "");
    setLinkedSort(d.filters.sort ?? "dueDate.asc");
  }
  function handleControlLane(lane: ControlTowerLaneId, asOf: string) {
    switch (lane) {
      case 'lateOrders': navigate('Centro de operações'); break;
      case 'unmeasuredOrders': navigate('Ordens de serviço'); applyView('Concluídas sem medição'); break;
      case 'overdueReceivables': drillFinance({ viewKey:'receivables.worklist', filters:{ dueTo:asOf, settlementState:'outstanding', sort:'dueDate.asc' } }); break;
      case 'overduePayables': drillFinance({ viewKey:'payables.worklist', filters:{ dueTo:asOf, state:'outstanding', sort:'dueDate.asc' } }); break;
      case 'latePurchases': navigate('Compras'); break;
      case 'stockShortage': navigate('Estoque e compras'); setSupplyView('inventory'); break;
      case 'myApprovals': navigate('Fechamentos'); break;
    }
  }
  function handleControlRecord(lane: ControlTowerLaneId, id: string) {
    switch (lane) {
      case 'lateOrders':
      case 'unmeasuredOrders': navigate('Ordens de serviço'); void openOrigin(id); break;
      case 'overdueReceivables': navigate('Financeiro'); void openReceivable(id); break;
      case 'overduePayables': navigate('Contas a pagar'); setPayableOrigin(id); break;
      case 'latePurchases': navigate('Compras'); setMrpOrderId(id); break;
      case 'stockShortage': navigate('Estoque e compras'); setSupplyView('inventory'); setMrpMaterialId(id); break;
      case 'myApprovals': navigate('Fechamentos'); break;
    }
  }
  const isWork = page === "Ordens de serviço" || page === "Visão operacional";
  const currentStage =
    action?.command === "invoice"
      ? 3
      : action?.command === "measure"
        ? 2
        : isWork
          ? view === "Em execução"
            ? 1
            : 0
          : ({
              Medições: 2,
              Faturamento: 3,
              Financeiro: 4,
              "Fiscal e tributos": 5,
              Contabilidade: 6,
            }[page] ?? -1);
  const moduleDescription: Record<string, string> = {
    Medições:
      "Acompanhamento da produção realizada e das medições vinculadas às ordens de serviço.",
    "CRM e Vendas":
      "Leads e oportunidades comerciais conectados a clientes do ERP.",
    "Clientes e propostas":
      "Relacionamento comercial, solicitações, propostas e pedidos de compra.",
    "Frota e ativos":
      "Disponibilidade, alocação e histórico dos recursos da operação.",
    "Pessoas e equipes":
      "Equipes, responsáveis e vínculos com as ordens de serviço.",
    Faturamento: "Documentos de cobrança originados em medições aprovadas.",
    Financeiro: "Títulos a receber com origem, valor registrado e vencimento.",
    "Caixa e conciliação":
      "Movimentação bancária, extratos e conciliação por transação.",
    "Fiscal e tributos": "Documentos fiscais, períodos, obrigações e apuração.",
    Contabilidade: "Lançamentos, plano de contas, diário e fechamento.",
    Compras:
      "Fornecedores, aprovação de pedidos e recebimento integrado ao estoque.",
    "Estoque e compras":
      "Controle de materiais, saldo e retiradas vinculadas às ordens de serviço.",
  };
  return (
    <div className="app">
      <a className="enterprise-skip-link" href="#cisne-workspace-content">Ir para conteúdo principal</a>
      {sidebar && (
        <EnterpriseButton type="button"
          appearance="transparent"
          className="sidebar-scrim"
          aria-label="Fechar navegação"
          onClick={() => setSidebar(false)}
        />
      )}
      <EnterpriseSidebar
        groups={modules}
        activePage={page}
        open={sidebar}
        ordersCount={loading || Boolean(error) ? null : summary.total}
        onNavigate={navigate}
        onSearch={() => { setPaletteQuery(""); setPalette(true); }}
      />
      <div className={"main " + (selected && docked ? "with-context" : "")}>
        <EnterpriseTopbar
          activePage={page}
          group={modules.find(group => group.items.some(([name]) => name === page))?.group ?? 'OPERAÇÃO'}
          sidebarOpen={sidebar}
          onToggleSidebar={() => setSidebar(value => !value)}
          onSearch={() => { setPaletteQuery(""); setPalette(true); }}
        />
        {!creating && !action && <EnterpriseWorkspaceContext activePage={page} onNavigate={navigate} />}
        <main
          id="cisne-workspace-content"
          className={isWork ? "operational-workspace" : "business-workspace"}
        >
          <EnterpriseStagingAccess />
          {!creating && !action && <EnterpriseExperienceHub activePage={page} groups={modules} onNavigate={navigate} onSearch={() => { setPaletteQuery(""); setPalette(true); }} onControlTowerLane={handleControlLane} onControlTowerRecord={handleControlRecord} /> }
          {!creating &&
            !["measure", "invoice"].includes(action?.command ?? "") &&
            ![
              "Compras",
              "Estoque e compras",
              "Visão financeira",
              "Fluxo de caixa",
              "CRM e Vendas",
              "Centro de operações",
              "Field Service Cockpit",
              "Resource Planning Board",
              "Clientes e propostas",
              "Propostas e PO",
              "Contratos",
              "Fiscal e tributos",
              "Profissionais",
              "Frota e ativos",
            ].includes(page) && (
              <div className="heading">
                <div>
                  <div className="eyebrow">
                    {
                      modules.find((g) => g.items.some(([n]) => n === page))
                        ?.group
                    }{" "}
                    · CISNE RONDÔNIA
                  </div>
                  <h1>{page}</h1>
                  {viewNotice && !savingView && (
                    <p role="alert" className="form-error">
                      {viewNotice}
                    </p>
                  )}
                  <p>
                    {isWork
                      ? "Acompanhe as ordens e execute o próximo passo na fila."
                      : moduleDescription[page]}
                  </p>
                </div>
                {isWork && (
                  <EnterpriseButton type="button" className="primary" onClick={newOrder}>
                    <Plus size={18} />
                    Nova ordem de serviço
                  </EnterpriseButton>
                )}
              </div>
            )}
          {notice && !creating && !action && !savingView && (
            <div
              className={"notice notice-" + noticeTone}
              role={noticeTone === "error" ? "alert" : "status"}
            >
              {noticeTone === "error" ? (
                <CircleAlert size={18} />
              ) : (
                <Check size={18} />
              )}
              {notice}
              <EnterpriseButton type="button" aria-label="Fechar aviso" onClick={() => setNotice("")}>
                <X size={16} />
              </EnterpriseButton>
            </div>
          )}
          {[
            "Visão operacional",
            "Ordens de serviço",
            "Execução",
            "Medições",
            "Faturamento",
            "Financeiro",
            "Fiscal e tributos",
            "Contabilidade",
          ].includes(page) && (
            <EnterpriseProcessJourney
              steps={chain}
              currentStage={currentStage}
              edges={chainEdges}
              viewportRef={chainViewport}
              onViewportScroll={updateChainEdges}
              onViewportKeyDown={handleChainKey}
              onScrollDirection={scrollChain}
              onStageSelect={(index) => {
                navigate([
                  "Ordens de serviço",
                  "Ordens de serviço",
                  "Medições",
                  "Faturamento",
                  "Financeiro",
                ][index]);
                if (index === 0 || index === 1) {
                  applyView(index === 1 ? "Em execução" : "Todas as ordens");
                }
              }}
            />
          )}
          <EnterpriseModuleWorkspace activePage={page} group={modules.find(g => g.items.some(([n]) => n === page))?.group ?? "OPERAÇÃO"} onNavigate={navigate}>
          {action?.command === "invoice" ? (
            <BillingPreparation
              measurementId={action.record.id}
              onCancel={() => setAction(null)}
              onCreated={async (id, orderId) => {
                setAction(null);
                navigate("Faturamento", orderId);
                await openReceivable(id, "invoices");
              }}
            />
          ) : action?.command === "measure" ? (
            <MeasurementPreparation
              order={action.record}
              onCancel={() => setAction(null)}
              onCreated={async (id) => {
                const orderId = action.record.id;
                setAction(null);
                navigate("Medições", orderId);
                await openReceivable(id, "measurements");
              }}
            />
          ) : creating ? (
            <OrderPreparation
              initialClient={orderClient}
              initialContract={orderContract}
              onCancel={() => setCreating(false)}
              onCreated={async (id) => {
                defaultsApplied.current = true;
                setCreating(false);
                navigate("Ordens de serviço");
                setPageNumber(1);
                setView("Rascunhos");
                setCategory(categories[0]);
                setNoticeTone("success");
                setNotice(
                  "Rascunho persistido. Consulte o escopo e a próxima ação autorizada.",
                );
                await openOrigin(id);
              }}
            />
          ) : page === "Centro de operações" || page === "Ordens de serviço" ? (
            <ServiceOperationsWorkspace
              onCreate={newOrder}
              onOpen={(id) => {
                navigate("Ordens de serviço");
                void openOrigin(id);
              }}
            />
          ) : page === "Field Service Cockpit" ? (
            <FieldServiceCockpit
              onNavigate={navigate}
              onOpenOrder={(id) => {
                navigate("Ordens de serviço");
                void openOrigin(id);
              }}
            />
          ) : page === "Resource Planning Board" ? (
            <ResourcePlanningBoard
              onOpenOrder={(id) => {
                navigate("Ordens de serviço");
                void openOrigin(id);
              }}
            />
          ) : page === "Visão operacional" ? (
            <EnterpriseCommandCenter
              summary={summary}
              dataState={loading ? "loading" : error ? "unavailable" : "ready"}
              navigate={navigate}
              onCreate={newOrder}
              onPendingMeasurements={() => { navigate("Ordens de serviço"); applyView("Concluídas sem medição"); }}
              onOpenOrder={(id) => {
                navigate("Ordens de serviço");
                void openOrigin(id);
              }}
              onControlTowerLane={handleControlLane}
              onControlTowerRecord={handleControlRecord}
            />
          ) : isWork ? (
            <>
              <ServiceOperationsAgenda
                orders={orders}
                onSelect={(id) => {
                  const order = orders.find((item) => item.id === id);
                  if (order) setSelected(order);
                }}
                onShowScheduled={() => applyView("Com data prevista")}
              />
              <section
                className="metrics"
                aria-label="Resumo das ordens; agregados de todas as ordens"
              >
                <EnterpriseButton type="button"
                  onClick={() => applyView("Todas as ordens")}
                  aria-pressed={
                    view === "Todas as ordens" &&
                    !query &&
                    category === categories[0]
                  }
                >
                  <span>
                    Ordens registradas
                    <ClipboardList size={17} />
                  </span>
                  <strong>{metricValue(summary.total)}</strong>
                  <small>
                    Consultar todas as ordens <ArrowUpRight size={14} />
                  </small>
                </EnterpriseButton>
                <EnterpriseButton type="button"
                  onClick={() => applyView("Rascunhos")}
                  aria-pressed={
                    view === "Rascunhos" && !query && category === categories[0]
                  }
                >
                  <span>
                    Em preparação
                    <FileText size={17} />
                  </span>
                  <strong>
                    {metricValue(summary.total === 0 ? 0 : summary.drafts)}
                  </strong>
                  <small>
                    Revisar rascunhos <ArrowUpRight size={14} />
                  </small>
                </EnterpriseButton>
                <EnterpriseButton type="button"
                  onClick={() => applyView("Com data prevista")}
                  aria-pressed={
                    view === "Com data prevista" &&
                    !query &&
                    category === categories[0]
                  }
                >
                  <span>
                    Com data prevista
                    <CalendarDays size={17} />
                  </span>
                  <strong>
                    {metricValue(summary.total === 0 ? 0 : summary.planned)}
                  </strong>
                  <small>
                    Consultar planejamento <ArrowUpRight size={14} />
                  </small>
                </EnterpriseButton>
                <EnterpriseButton type="button"
                  onClick={() => applyView("Concluídas sem medição")}
                  aria-pressed={
                    view === "Concluídas sem medição" &&
                    !query &&
                    category === categories[0]
                  }
                >
                  <span>
                    Aguardando medição
                    <CircleAlert size={17} />
                  </span>
                  <strong>
                    {metricValue(
                      summary.total === 0 ? 0 : summary.pendingMeasurements,
                    )}
                  </strong>
                  <small>
                    Retomar ordens concluídas <ArrowUpRight size={14} />
                  </small>
                </EnterpriseButton>
              </section>
              <div className="work-layout">
                <section
                  className="worklist"
                  onInput={() => {
                    defaultsApplied.current = true;
                  }}
                  onClick={() => {
                    defaultsApplied.current = true;
                  }}
                  aria-labelledby="queue-title"
                  aria-busy={loading}
                >
                  <div className="list-title">
                    <div>
                      <span className="queue-eyebrow">ORDENS DE SERVIÇO</span>
                      <h2 id="queue-title">Fila de trabalho</h2>
                      <span className="queue-subtitle">
                        Situação e próxima ação
                      </span>
                    </div>
                    <div className="worklist-tools">
                      <details className="views-menu">
                        <summary>
                          <BookOpen size={15} />
                          Consultas
                          <ChevronDown size={13} />
                        </summary>
                        <div className="saved-views">
                          <span>CONSULTAS PESSOAIS</span>
                          {!savedViews.length && <p>Nenhuma consulta salva.</p>}
                          {savedViews.map((v) => (
                            <div className="saved-view-row" key={v.id}>
                              <EnterpriseButton type="button"
                                onClick={() => {
                                  setPageNumber(1);
                                  setQuery(v.query);
                                  setCategory(v.category);
                                  setView(v.view);
                                  if (v.definition) {
                                    setSort(v.definition.sort);
                                    setPageSize(v.definition.pageSize);
                                  }
                                }}
                                disabled={!v.compatible}
                                aria-pressed={
                                  query === v.query &&
                                  category === v.category &&
                                  view === v.view
                                }
                              >
                                {v.name}
                                {v.isDefault ? " · padrão" : ""}
                              </EnterpriseButton>
                              <EnterpriseButton type="button"
                                disabled={!v.compatible || !v.rowVersion}
                                aria-label={
                                  (v.isDefault
                                    ? "Remover padrão: "
                                    : "Definir padrão: ") + v.name
                                }
                                onClick={() => void defaultView(v)}
                              >
                                {v.isDefault
                                  ? "Remover padrão"
                                  : "Definir padrão"}
                              </EnterpriseButton>
                            </div>
                          ))}
                          <EnterpriseButton type="button"
                            className="save-view"
                            onClick={() => {
                              setViewKey(crypto.randomUUID());
                              setViewNotice("");
                              setSavingViewFor("serviceOrders.worklist");
                              setSavingView(true);
                            }}
                          >
                            <Plus size={14} />
                            Salvar consulta
                          </EnterpriseButton>
                        </div>
                      </details>
                      <EnterpriseButton type="button"
                        className="icon-button"
                        disabled={loading}
                        onClick={() => void load()}
                        aria-label="Atualizar ordens"
                      >
                        <RefreshCw
                          size={17}
                          className={loading ? "spin" : ""}
                        />
                      </EnterpriseButton>
                    </div>
                  </div>
                  <div className="tabs">
                    {[
                      "Todas as ordens",
                      "Rascunhos",
                      "Em execução",
                      "Com data prevista",
                      "Concluídas sem medição",
                    ].map((t) => (
                      <EnterpriseButton type="button"
                        key={t}
                        onClick={() => {
                          setPageNumber(1);
                          setView(t);
                        }}
                        className={view === t ? "selected" : ""}
                        aria-pressed={view === t}
                      >
                        {t}
                        {t === "Todas as ordens" && (
                          <span>{loading || error ? "—" : summary.total}</span>
                        )}
                      </EnterpriseButton>
                    ))}
                  </div>
                  <div className="filters">
                    <EnterpriseSearchField label="Buscar OS ou cliente" placeholder="Buscar OS ou cliente" value={query} disabled={false} onValueChange={value => {
                          setPageNumber(1);
                          setQuery(value);
                        }} />
                    <label className="select-filter">
                      <Filter size={15} />
                      <EnterpriseDropdown
                        aria-label="Filtrar atividade"
                        value={category}
                        onValueChange={value => {
                          setPageNumber(1);
                          setCategory(value);
                        }}
                      >
                        {categories.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </EnterpriseDropdown>
                    </label>
                    <details className="options-menu">
                      <summary>
                        <SlidersHorizontal size={15} />
                        Exibição
                        <ChevronDown size={13} />
                      </summary>
                      <div className="view-options">
                        <label className="select-filter">
                          Ordenação
                          <EnterpriseDropdown
                            aria-label="Ordenar ordens"
                            value={sort}
                            onValueChange={value => {
                              setSort(value);
                              setPageNumber(1);
                            }}
                          >
                            <option value="createdAt.desc">
                              Mais recentes
                            </option>
                            <option value="createdAt.asc">Mais antigas</option>
                            <option value="title.asc">Título</option>
                            <option value="dueDate.asc">Data prevista</option>
                          </EnterpriseDropdown>
                        </label>
                        <label className="select-filter">
                          Por página
                          <EnterpriseDropdown
                            aria-label="Ordens por página"
                            value={pageSize}
                            onValueChange={value => {
                              setPageSize(Number(value));
                              setPageNumber(1);
                            }}
                          >
                            {[10, 25, 50, 100].map((n) => (
                              <option key={n}>{n}</option>
                            ))}
                          </EnterpriseDropdown>
                        </label>
                      </div>
                    </details>
                    {(query || category !== categories[0]) && (
                      <EnterpriseButton type="button"
                        onClick={() => {
                          setPageNumber(1);
                          setQuery("");
                          setCategory(categories[0]);
                        }}
                        className="text-button"
                      >
                        Limpar
                      </EnterpriseButton>
                    )}
                  </div>
                  {(query || category !== categories[0]) && (
                    <div className="filter-context">
                      <span>Filtros ativos</span>
                      {query && (
                        <EnterpriseButton type="button"
                          onClick={() => {
                            setPageNumber(1);
                            setQuery("");
                          }}
                          aria-label="Remover busca"
                        >
                          Busca: {query}
                          <X size={12} />
                        </EnterpriseButton>
                      )}
                      {category !== categories[0] && (
                        <EnterpriseButton type="button"
                          onClick={() => {
                            setPageNumber(1);
                            setCategory(categories[0]);
                          }}
                          aria-label="Remover filtro de atividade"
                        >
                          {category}
                          <X size={12} />
                        </EnterpriseButton>
                      )}
                    </div>
                  )}
                  <div className="table-wrap queue-table">
                    <table onKeyDown={handleQueueKey}>
                      <caption className="sr-only">
                        Ordens de serviço, situação, data prevista e próximo
                        comando
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Ordem / atividade</th>
                          <th scope="col">Cliente</th>
                          <th scope="col">Situação</th>
                          <th scope="col">Data prevista</th>
                          <th scope="col">Próxima ação</th>
                          <th scope="col">
                            <span className="sr-only">Contexto</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {loading
                          ? Array.from({ length: 5 }, (_, i) => (
                              <tr
                                className="skeleton-row"
                                key={i}
                                aria-hidden="true"
                              >
                                {Array.from({ length: 6 }, (_, j) => (
                                  <td key={j}>
                                    <span className="skeleton-line" />
                                  </td>
                                ))}
                              </tr>
                            ))
                          : !error &&
                            filtered.map((o) => {
                              const next = nextCommand(o);
                              return (
                                <tr
                                  key={o.id}
                                  data-order-id={o.id}
                                  className={
                                    selected?.id === o.id ? "row-selected" : ""
                                  }
                                >
                                  <td>
                                    <EnterpriseButton type="button"
                                      className="row-link"
                                      onClick={() => setSelected(o)}
                                    >
                                      {o.title}
                                    </EnterpriseButton>
                                    <small>
                                      OS · {o.id.slice(0, 8).toUpperCase()}{" "}
                                      <span className="metadata-divider">
                                        ·
                                      </span>{" "}
                                      {o.category}
                                    </small>
                                  </td>
                                  <td>
                                    <span
                                      className="cell-text"
                                      title={o.client}
                                    >
                                      {o.client}
                                    </span>
                                  </td>
                                  <td>
                                    <span
                                      className={"badge status-" + o.status}
                                    >
                                      {statusNames[o.status] || o.status}
                                    </span>
                                  </td>
                                  <td className="date-cell">
                                    {date(o.due_date)}
                                  </td>
                                  <td>
                                    {next ? (
                                      <EnterpriseButton type="button"
                                        className="row-command"
                                        disabled={saving}
                                        onClick={() => command(next.name, o)}
                                      >
                                        {next.label}
                                      </EnterpriseButton>
                                    ) : (
                                      <span className="cell-secondary">
                                        Sem ação nesta etapa
                                      </span>
                                    )}
                                  </td>
                                  <td>
                                    <EnterpriseButton type="button"
                                      className="icon-button row-context"
                                      onClick={() => setSelected(o)}
                                      aria-label={
                                        "Abrir contexto da OS " + o.title
                                      }
                                    >
                                      <ChevronRight size={17} />
                                    </EnterpriseButton>
                                  </td>
                                </tr>
                              );
                            })}
                      </tbody>
                    </table>
                  </div>
                  {loading && (
                    <span className="sr-only" role="status">
                      Carregando ordens de serviço
                    </span>
                  )}
                  {!loading && (error || !filtered.length) && (
                    <div
                      className={"empty " + (error ? "error-state" : "")}
                      role={error ? "alert" : "status"}
                    >
                      <span className="empty-icon">
                        <ClipboardList size={25} />
                      </span>
                      <h3>
                        {error
                          ? "Não foi possível consultar a fila"
                          : summary.total
                            ? "Nenhuma ordem neste filtro"
                            : "Nenhuma ordem registrada"}
                      </h3>
                      <p>
                        {error ||
                          (summary.total
                            ? "Ajuste os filtros para retomar a fila de trabalho."
                            : "Registre uma ordem para definir o cliente, a atividade e o escopo da operação.")}
                      </p>
                      {error ? (
                        <EnterpriseButton type="button"
                          className="secondary"
                          onClick={() => void load()}
                        >
                          <RefreshCw size={15} />
                          Tentar novamente
                        </EnterpriseButton>
                      ) : summary.total ? (
                        <EnterpriseButton type="button"
                          className="secondary"
                          onClick={() => applyView("Todas as ordens")}
                        >
                          Limpar filtros
                        </EnterpriseButton>
                      ) : (
                        <EnterpriseButton type="button" className="secondary" onClick={newOrder}>
                          <Plus size={16} />
                          Registrar primeira ordem
                        </EnterpriseButton>
                      )}
                    </div>
                  )}
                  <footer className="table-footer">
                    <span>
                      {loading || error
                        ? "Resultado indisponível"
                        : `${total} ${total === 1 ? "ordem" : "ordens"} · página ${pageNumber}`}
                    </span>
                    {generatedAt && !loading && !error && (
                      <span title={generatedAt}>
                        Atualizado às{" "}
                        {new Intl.DateTimeFormat("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(new Date(generatedAt))}
                      </span>
                    )}
                    <div className="pagination">
                      <EnterpriseButton type="button"
                        disabled={loading || !!error || pageNumber === 1}
                        onClick={() => setPageNumber((n) => n - 1)}
                      >
                        Anterior
                      </EnterpriseButton>
                      <EnterpriseButton type="button"
                        disabled={
                          loading || !!error || pageNumber * pageSize >= total
                        }
                        onClick={() => setPageNumber((n) => n + 1)}
                      >
                        Próxima
                      </EnterpriseButton>
                    </div>
                  </footer>
                </section>
              </div>
            </>
          ) : linkedPage ? (
            <section className="worklist" aria-busy={linkedLoading}>
              <div className="list-title">
                <h2>
                  {page === "Medições"
                    ? "Produção registrada"
                    : page === "Faturamento"
                      ? "Cobranças internas"
                      : "Contas a receber"}
                </h2>
                <div className="worklist-tools">
                  <details className="views-menu">
                    <summary>
                      <BookOpen size={15} />
                      Consultas
                      <ChevronDown size={13} />
                    </summary>
                    <div className="saved-views">
                      <span>CONSULTAS PESSOAIS</span>
                      {!linkedViews.length && <p>Nenhuma consulta salva.</p>}
                      {linkedViews.map((v) => (
                        <div className="saved-view-row" key={v.id}>
                          <EnterpriseButton type="button"
                            disabled={!v.compatible || !v.definition}
                            onClick={() => {
                              if (v.definition) applyLinkedView(v.definition);
                            }}
                          >
                            {v.name}
                            {v.isDefault ? " · padrão" : ""}
                            {!v.compatible ? " · incompatível" : ""}
                          </EnterpriseButton>
                          <EnterpriseButton type="button"
                            disabled={!v.compatible || !v.rowVersion}
                            aria-label={
                              (v.isDefault
                                ? "Remover padrão: "
                                : "Definir padrão: ") + v.name
                            }
                            onClick={() => void defaultView(v, true)}
                          >
                            {v.isDefault ? "Remover padrão" : "Definir padrão"}
                          </EnterpriseButton>
                        </div>
                      ))}
                      <EnterpriseButton type="button"
                        className="save-view"
                        onClick={() => {
                          setViewKey(crypto.randomUUID());
                          setViewNotice("");
                          setSavingViewFor(
                            "operation." +
                              (page === "Medições"
                                ? "measurements"
                                : page === "Faturamento"
                                  ? "invoices"
                                  : "receivables"),
                          );
                          setSavingView(true);
                        }}
                      >
                        <Plus size={14} />
                        Salvar consulta
                      </EnterpriseButton>
                    </div>
                  </details>
                  <EnterpriseButton type="button"
                    className="icon-button"
                    onClick={() => void loadOperation()}
                    aria-label="Atualizar registros"
                  >
                    <RefreshCw size={17} />
                  </EnterpriseButton>
                </div>
              </div>
              <div className="filters linked-filters">
                <EnterpriseSearchField label="Buscar registros por OS, cliente ou identificador" placeholder="Buscar OS, cliente ou identificador" value={linkedQuery} disabled={false} onValueChange={value =>
                      changeLinked(() => setLinkedQuery(value))} />
                <label className="select-filter">
                  Ordenação
                  <EnterpriseDropdown
                    aria-label="Ordenar registros"
                    value={linkedSort}
                    onValueChange={value =>
                      changeLinked(() => setLinkedSort(value))
                    }
                  >
                    <option value="createdAt.desc">Mais recentes</option>
                    <option value="createdAt.asc">Mais antigos</option>
                    <option value="title.asc">Título da OS</option>
                    <option value="dueDate.asc">
                      {page === "Medições" ? "Data prevista" : "Vencimento"}
                    </option>
                  </EnterpriseDropdown>
                </label>
                <label className="select-filter">
                  Por página
                  <EnterpriseDropdown
                    aria-label="Registros por página"
                    value={linkedSize}
                    onValueChange={value =>
                      changeLinked(() => setLinkedSize(Number(value)))
                    }
                  >
                    {[10, 25, 50, 100].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </EnterpriseDropdown>
                </label>
                {page === "Financeiro" && (
                  <label className="select-filter">
                    Liquidação
                    <EnterpriseDropdown
                      aria-label="Filtrar situação da liquidação"
                      value={settlementState}
                      onValueChange={value =>
                        changeLinked(() => setSettlementState(value))
                      }
                    >
                      <option value="">Todas</option>
                      <option value="outstanding">Com saldo</option>
                      <option value="open">Em aberto</option>
                      <option value="partial">Parciais</option>
                      <option value="settled">Liquidadas</option>
                    </EnterpriseDropdown>
                  </label>
                )}
                {page === "Medições" && (
                  <label className="select-filter">
                    Situação
                    <EnterpriseDropdown
                      aria-label="Situação da medição"
                      value={linkedStatus}
                      onValueChange={value =>
                        changeLinked(() => setLinkedStatus(value))
                      }
                    >
                      <option value="">Todas</option>
                      <option value="draft">Rascunho</option>
                      <option value="approved">Aprovada</option>
                      <option value="billed">Faturada</option>
                    </EnterpriseDropdown>
                  </label>
                )}
                <label className="select-filter">
                  {page === "Medições" ? "Previsão de" : "Vencimento de"}
                  <EnterpriseInput
                    type="date"
                    aria-label="Data inicial dos registros"
                    value={dueFrom}
                    onChange={(e) =>
                      changeLinked(() => setDueFrom(e.target.value))
                    }
                  />
                </label>
                <label className="select-filter">
                  Até
                  <EnterpriseInput
                    type="date"
                    aria-label="Data final dos registros"
                    value={dueTo}
                    onChange={(e) =>
                      changeLinked(() => setDueTo(e.target.value))
                    }
                  />
                </label>
                {(linkedQuery ||
                  linkedStatus ||
                  settlementState ||
                  dueFrom ||
                  dueTo) && (
                  <EnterpriseButton type="button" className="text-button" onClick={clearLinkedFilters}>
                    Limpar filtros
                  </EnterpriseButton>
                )}
              </div>
              <section
                className="metrics linked-metrics"
                aria-label="Totais dos registros filtrados"
              >
                {linkedMetrics.map((metric) => (
                  <EnterpriseButton type="button"
                    key={metric.metricId}
                    disabled={
                      linkedLoading ||
                      !!operationError ||
                      metric.status === "unknown"
                    }
                    onClick={() => drillLinked(metric)}
                    title={"Origem: " + metric.authority}
                  >
                    <span>{metric.label}</span>
                    <strong>
                      {linkedLoading || operationError || metric.value == null
                        ? "—"
                        : metric.scale === 4
                          ? moneyScaled(String(metric.value))
                          : String(metric.value)}
                    </strong>
                    <small>Consultar registros deste total</small>
                  </EnterpriseButton>
                ))}
              </section>
              <div className="linked-info">
                {page === "Medições"
                  ? "A medição registra o valor informado da produção. Aprovação e cobrança preservam sua OS de origem."
                  : page === "Faturamento"
                    ? "Cobranças internas originadas em medições aprovadas. Não substituem documentos fiscais."
                    : "Títulos originados em cobranças internas. Recebimentos manuais preservam histórico; conciliação bancária requer extrato."}
              </div>
              {businessOrder && (
                <div className="filter-context">
                  <span>
                    Contexto: OS · {businessOrder.slice(0, 8).toUpperCase()}
                  </span>
                  <EnterpriseButton type="button"
                    onClick={() => {
                      setBusinessOrder("");
                      setLinkedNumber(1);
                    }}
                  >
                    Remover contexto
                    <X size={12} />
                  </EnterpriseButton>
                </div>
              )}
              {linkedLoading ? (
                <div className="empty" role="status">
                  Consultando registros…
                </div>
              ) : operationError ? (
                <div className="empty">
                  <h3>Registros indisponíveis</h3>
                  <p>{operationError}</p>
                  <EnterpriseButton type="button"
                    className="secondary"
                    onClick={() => void loadOperation()}
                  >
                    Tentar novamente
                  </EnterpriseButton>
                </div>
              ) : linkedRows.length ? (
                <div className="table-wrap" id="linked-results" tabIndex={-1}>
                  <table>
                    <thead>
                      <tr>
                        <th>Origem / cliente</th>
                        <th>Descrição</th>
                        <th>Valor registrado</th>
                        <th>Situação</th>
                        <th>Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {linkedRows.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <EnterpriseButton type="button"
                              className="row-link"
                              onClick={() => {
                                void openOrigin(r.order_id);
                              }}
                            >
                              {r.title}
                            </EnterpriseButton>
                            <small>{r.client}</small>
                          </td>
                          <td>
                            {r.description ||
                              "Cobrança · " + r.id.slice(0, 8).toUpperCase()}
                            {r.due_date && (
                              <small>Vencimento: {date(r.due_date)}</small>
                            )}
                          </td>
                          <td className="amount">
                            {moneyScaled(r.amountScaled)}
                          </td>
                          <td>
                            <span className="badge">
                              {page === "Medições"
                                ? {
                                    draft: "Rascunho",
                                    approved: "Aprovada",
                                    billed: "Faturada",
                                  }[r.status] || r.status
                                : page === "Faturamento"
                                  ? "Registrada"
                                  : r.facts?.outstandingScaled === "0"
                                    ? "Liquidado"
                                    : r.facts?.settledScaled === "0"
                                      ? "Em aberto"
                                      : "Parcial"}
                            </span>
                          </td>
                          <td>
                            {nextCommand(r) ? (
                              <EnterpriseButton type="button"
                                className="secondary"
                                disabled={saving}
                                onClick={() => command(nextCommand(r)!.name, r)}
                              >
                                {nextCommand(r)!.label}
                              </EnterpriseButton>
                            ) : (
                              <EnterpriseButton type="button"
                                className="text-button"
                                onClick={() => {
                                  void openReceivable(
                                    r.id,
                                    page === "Medições"
                                      ? "measurements"
                                      : page === "Faturamento"
                                        ? "invoices"
                                        : "receivables",
                                  );
                                }}
                              >
                                {page === "Financeiro"
                                  ? "Consultar título"
                                  : "Consultar registro"}
                              </EnterpriseButton>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty">
                  <span className="empty-icon">
                    <Receipt size={30} />
                  </span>
                  <h3>
                    {linkedInfo?.sourceTotal
                      ? "Nenhum registro nesta consulta"
                      : page === "Medições"
                        ? "Nenhuma medição registrada"
                        : page === "Faturamento"
                          ? "Nenhuma cobrança gerada"
                          : "Nenhum recebível gerado"}
                  </h3>
                  <p>
                    {linkedInfo?.sourceTotal
                      ? "Ajuste os filtros ou volte à primeira página para retomar os registros."
                      : page === "Medições"
                        ? "Conclua a execução de uma OS e registre sua medição no contexto da ordem."
                        : page === "Faturamento"
                          ? "Aprove uma medição para gerar a cobrança e seu título a receber."
                          : "As cobranças geradas a partir de medições aprovadas originam os títulos a receber."}
                  </p>
                  {linkedInfo?.sourceTotal ? (
                    <EnterpriseButton type="button" className="secondary" onClick={clearLinkedFilters}>
                      Retomar registros
                    </EnterpriseButton>
                  ) : (
                    <EnterpriseButton type="button"
                      className="secondary"
                      onClick={() =>
                        navigate(
                          page === "Medições"
                            ? "Ordens de serviço"
                            : "Medições",
                        )
                      }
                    >
                      Abrir{" "}
                      {page === "Medições" ? "ordens de serviço" : "medições"}
                    </EnterpriseButton>
                  )}
                </div>
              )}
              <footer className="table-footer">
                <span>
                  {linkedLoading || operationError
                    ? "Resultado indisponível"
                    : `${linkedInfo?.total ?? "—"} registros · página ${linkedNumber}`}
                </span>
                <div className="pagination">
                  <EnterpriseButton type="button"
                    disabled={
                      linkedLoading || !!operationError || linkedNumber === 1
                    }
                    onClick={() => setLinkedNumber((n) => n - 1)}
                  >
                    Anterior
                  </EnterpriseButton>
                  <EnterpriseButton type="button"
                    disabled={
                      linkedLoading || !!operationError || !linkedInfo?.hasMore
                    }
                    onClick={() => setLinkedNumber((n) => n + 1)}
                  >
                    Próxima
                  </EnterpriseButton>
                </div>
                <span>
                  {linkedGeneratedAt && !linkedLoading && !operationError
                    ? `Atualizado às ${new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(linkedGeneratedAt))} · BRL`
                    : "Valores registrados · BRL"}
                </span>
              </footer>
            </section>
          ) : page === "Profissionais" ? (
            <ProfessionalsWorkspace />
          ) : page === "Frota e ativos" ? (
            <AssetsWorkspace />
          ) : page === "CRM e Vendas" ? (
            <CRMWorkspace
              onClients={() => navigate("Clientes e propostas")}
              onProposals={(id) => {
                navigate("Propostas e PO");
                if (id) setCommercialOrigin(id);
              }}
            />
          ) : page === "Clientes e propostas" ? (
            <ClientsWorkspace
              initialId={clientOrigin}
              onCreateOrder={(client) => {
                navigate("Ordens de serviço");
                setOrderContract(null);
                setOrderClient(client);
                setNotice("");
                setCreating(true);
              }}
              onOrders={(id) => {
                defaultsApplied.current = true;
                navigate("Ordens de serviço");
                setBusinessClient(id);
                setPageNumber(1);
                setView("Todas as ordens");
                setCategory(categories[0]);
              }}
              onProposal={(id) => {
                navigate("Propostas e PO");
                setCommercialOrigin(id);
              }}
              onContract={(id) => {
                navigate("Contratos");
                setContractOrigin(id);
              }}
            />
          ) : page === "Execução" ? (
            <ExecutionWorkspace
              initialOrderId={executionOrder}
              onOrder={(id) => {
                navigate("Ordens de serviço");
                void openOrigin(id);
              }}
            />
          ) : page === "Contratos" ? (
            <ContractsWorkspace
              initialId={contractOrigin}
              onSource={(id) => {
                navigate("Propostas e PO");
                setCommercialOrigin(id);
              }}
              onOrders={(id) => {
                defaultsApplied.current = true;
                navigate("Ordens de serviço");
                setBusinessContract(id);
                setPageNumber(1);
                setView("Todas as ordens");
                setCategory(categories[0]);
              }}
              onCreateOrder={(contract) => {
                if (!contract.client) return;
                navigate("Ordens de serviço");
                setOrderClient(contract.client);
                setOrderContract(contract);
                setNotice("");
                setCreating(true);
              }}
            />
          ) : page === "Propostas e PO" ? (
            <ProposalsWorkspace
              initialId={commercialOrigin}
              onContract={(id) => {
                navigate("Contratos");
                setContractOrigin(id);
              }}
            />
          ) : page === "Visão financeira" ? (
            <FinanceOverviewWorkspace onDrilldown={drillFinance} />
          ) : page === "Fluxo de caixa" ? (
            <CashFlowWorkspace />
          ) : page === "Tesouraria" ? (
            <TreasuryWorkspace
              onAccount={(account) => {
                navigate("Caixa e conciliação");
                setBankAccount(account);
              }}
            />
          ) : page === "Contas a pagar" ? (
            <PayablesWorkspace initialFilters={drillFilters} initialId={payableOrigin} />
          ) : page === "Caixa e conciliação" ? (
            <BankReconciliationWorkspace
              initialAccountReference={bankAccount}
            />
          ) : page === "Razão contábil" ? (
            <LedgerWorkspace />
          ) : page === "Contabilidade" ? (
            <AccountingWorkspace />
          ) : page === "Fiscal e tributos" ? (
            <FiscalWorkspace />
          ) : page === "Fechamentos" ? (
            <CloseCenterWorkspace />
          ) : page === "Compras" ? (
            <ProcurementWorkspace initialOrderId={mrpOrderId} />
          ) : page === "Estoque e compras" ? (
            <section className="supply-workspace" aria-label="Suprimentos">
              <div
                className="supply-view-tabs"
                role="tablist"
                aria-label="Selecionar área de suprimentos"
              >
                <EnterpriseButton type="button"
                  role="tab"
                  id="tab-inventory"
                  aria-controls="panel-supply"
                  aria-selected={supplyView === "inventory"}
                  className={supplyView === "inventory" ? "active" : ""}
                  onClick={() => setSupplyView("inventory")}
                >
                  Estoque e materiais
                </EnterpriseButton>
                <EnterpriseButton type="button"
                  role="tab"
                  id="tab-mrp"
                  aria-controls="panel-supply"
                  aria-selected={supplyView === "mrp"}
                  className={supplyView === "mrp" ? "active" : ""}
                  onClick={() => setSupplyView("mrp")}
                >
                  Planejamento MRP
                </EnterpriseButton>
              </div>
              <div
                id="panel-supply"
                role="tabpanel"
                aria-labelledby={
                  supplyView === "inventory" ? "tab-inventory" : "tab-mrp"
                }
              >
                {supplyView === "inventory" ? (
                  <InventoryWorkspace initialMaterialId={mrpMaterialId} />
                ) : (
                  <MRPWorkspace
                    onMaterial={(id) => {
                      setMrpMaterialId(id);
                      setSupplyView("inventory");
                    }}
                    onPurchaseOrder={(id) => {
                      setMrpOrderId(id);
                      navigate("Compras");
                    }}
                  />
                )}
              </div>
            </section>
          ) : (
            <section className="module-workspace">
              <div className="module-grid">
                <div>
                  <span className="eyebrow">GESTÃO EMPRESARIAL</span>
                  <h2>{page}</h2>
                  <p>{moduleDescription[page]}</p>
                  <div className="module-empty">
                    <span className="empty-icon">
                      <Layers size={28} />
                    </span>
                    <h3>Nenhum registro conectado</h3>
                    <p>
                      Esta área está em preparação. Os registros e as ações
                      serão disponibilizados nas próximas etapas de implantação.
                    </p>
                    <EnterpriseButton type="button"
                      className="secondary"
                      onClick={() => navigate("Ordens de serviço")}
                    >
                      <ClipboardList size={16} />
                      Voltar à operação
                    </EnterpriseButton>
                  </div>
                </div>
                <aside>
                  <h3>Origem e continuidade</h3>
                  <p>
                    A ordem de serviço mantém o contexto ao longo da cadeia
                    empresarial.
                  </p>
                  {chain.map((s, i) => (
                    <div className="chain-item" key={s}>
                      <span>{i + 1}</span>
                      <strong>{s}</strong>
                      <small>
                        {i === 0 ? "Cadastro disponível" : "Em preparação"}
                      </small>
                    </div>
                  ))}
                </aside>
              </div>
            </section>
          )}
          {businessContract && (
            <div className="filter-context">
              <span>Ordens do contrato vinculado</span>
              <EnterpriseButton type="button"
                onClick={() => {
                  setBusinessContract("");
                  setPageNumber(1);
                }}
              >
                Remover contexto
              </EnterpriseButton>
            </div>
          )}
          {businessClient && (
            <div className="filter-context">
              <span>Ordens do cliente vinculado</span>
              <EnterpriseButton type="button"
                onClick={() => {
                  setBusinessClient("");
                  setPageNumber(1);
                }}
              >
                Remover contexto
              </EnterpriseButton>
            </div>
          )}
          </EnterpriseModuleWorkspace>
          <footer className="page-footer">
            <span>
              CISNE RONDÔNIA <b>·</b> Gestão empresarial integrada
            </span>
            <span>Operação com contexto e rastreabilidade</span>
          </footer>
        </main>
      </div>
      {receivableContext && (
        <div className="overlay" onClick={() => setReceivableContext(null)}>
          <aside
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label={
              receivableContext.identity.entityKey === "measurements"
                ? "Contexto da medição"
                : receivableContext.identity.entityKey === "invoices"
                  ? "Contexto da cobrança"
                  : "Contexto do título a receber"
            }
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <span className="eyebrow">
                {receivableContext.identity.entityKey === "measurements"
                  ? "MEDIÇÃO"
                  : receivableContext.identity.entityKey === "invoices"
                    ? "FATURAMENTO"
                    : "CONTAS A RECEBER"}
              </span>
              <EnterpriseButton type="button"
                className="icon-button"
                aria-label="Fechar registro"
                autoFocus
                onClick={() => setReceivableContext(null)}
              >
                <X size={21} />
              </EnterpriseButton>
            </header>
            <span className="badge">
              {receivableContext.state?.label ?? "Título registrado"}
            </span>
            <h2>{receivableContext.identity.title}</h2>
            <p className="muted">{receivableContext.identity.subtitle}</p>
            <dl>
              <div>
                <dt>Valor registrado</dt>
                <dd>{moneyScaled(receivableContext.facts.principalScaled)}</dd>
              </div>
              <div>
                <dt>Vencimento</dt>
                <dd>{date(receivableContext.facts.dueDate)}</dd>
              </div>
              {(!receivableContext.identity.entityKey ||
                receivableContext.identity.entityKey === "receivables") && (
                <div>
                  <dt>Saldo / liquidado</dt>
                  <dd>
                    {receivableContext.facts.outstandingScaled === null
                      ? "Indisponível"
                      : moneyScaled(receivableContext.facts.outstandingScaled) +
                        " / " +
                        moneyScaled(receivableContext.facts.settledScaled)}
                  </dd>
                </div>
              )}
            </dl>
            {receivableContext.identity.entityKey === "measurements" && (
              <div className="next-block">
                <span className="eyebrow">PRÓXIMA AÇÃO AUTORIZADA</span>
                <h3>
                  {receivableContext.availableCommands?.[0]?.label ??
                    "Sem comando disponível"}
                </h3>
                <div className="command-buttons">
                  {receivableContext.availableCommands?.map((c) => (
                    <EnterpriseButton type="button"
                      className="primary"
                      key={c.id}
                      onClick={() =>
                        command(c.id, {
                          id: receivableContext.identity.id,
                          title: receivableContext.identity.title,
                          client: receivableContext.identity.subtitle,
                          description:
                            receivableContext.relations.measurementDescription,
                          status: receivableContext.state?.code ?? "",
                          version: receivableContext.state?.rowVersion ?? 0,
                          amountScaled: receivableContext.facts.principalScaled,
                          order_id: receivableContext.relations.orderId,
                          due_date: receivableContext.facts.dueDate ?? "",
                          created_at: receivableContext.facts.createdAt,
                          availableCommands:
                            receivableContext.availableCommands!,
                        })
                      }
                    >
                      {c.label}
                    </EnterpriseButton>
                  ))}
                </div>
              </div>
            )}
            {receivableContext.identity.entityKey === "receivables" && (
              <>
                <div className="command-buttons">
                  {receivableContext.availableCommands?.some(
                    (c) => c.id === "record_receipt",
                  ) && (
                    <EnterpriseButton type="button"
                      className="primary"
                      onClick={() =>
                        setSettlementAction({
                          command: "record_receipt",
                          key: crypto.randomUUID(),
                        })
                      }
                    >
                      Registrar recebimento
                    </EnterpriseButton>
                  )}
                </div>
                <h3>Histórico financeiro</h3>
                {!receivableContext.settlements?.length ? (
                  <p className="muted">Nenhum recebimento registrado.</p>
                ) : (
                  receivableContext.settlements.map((entry) => (
                    <div className="event-row" key={entry.id}>
                      <span>
                        {entry.kind === "receipt" ? "Recebimento" : "Estorno"} ·{" "}
                        {moneyScaled(entry.amountScaled)}
                        <small>
                          {date(entry.effectiveDate)} · {entry.reference}
                        </small>
                      </span>
                      {entry.canReverse === 1 && (
                        <EnterpriseButton type="button"
                          className="text-button"
                          onClick={() =>
                            setSettlementAction({
                              command: "reverse_receipt",
                              key: crypto.randomUUID(),
                              reversesId: entry.id,
                            })
                          }
                        >
                          Estornar
                        </EnterpriseButton>
                      )}
                    </div>
                  ))
                )}
                {receivableContext.settlementsPageInfo && (
                  <footer className="table-footer">
                    <span>
                      {receivableContext.settlementsPageInfo.total} lançamentos
                      · página {receivableContext.settlementsPageInfo.page}
                    </span>
                    <div className="pagination">
                      <EnterpriseButton type="button"
                        disabled={
                          saving ||
                          receivableContext.settlementsPageInfo.page === 1
                        }
                        onClick={() =>
                          void openReceivable(
                            receivableContext.identity.id,
                            "receivables",
                            receivableContext.settlementsPageInfo!.page - 1,
                          )
                        }
                      >
                        Anterior
                      </EnterpriseButton>
                      <EnterpriseButton type="button"
                        disabled={
                          saving ||
                          !receivableContext.settlementsPageInfo.hasMore
                        }
                        onClick={() =>
                          void openReceivable(
                            receivableContext.identity.id,
                            "receivables",
                            receivableContext.settlementsPageInfo!.page + 1,
                          )
                        }
                      >
                        Próxima
                      </EnterpriseButton>
                    </div>
                  </footer>
                )}
              </>
            )}
            {receivableContext.warnings.map((w) => (
              <p className="linked-info" key={w}>
                {w}
              </p>
            ))}
            <h3>Origem da cobrança</h3>
            <p>{receivableContext.relations.measurementDescription}</p>
            {receivableContext.evidencePageInfo && (
              <>
                <h3>Apontamentos vinculados</h3>
                {receivableContext.evidence?.length ? (
                  receivableContext.evidence.map((e) => (
                    <div className="event-row" key={e.id}>
                      <span>
                        {e.reference} · {e.description}
                        <small>
                          {executionQuantity(e.quantityScaled)} {e.unit} ·{" "}
                          {date(e.effectiveDate)}
                        </small>
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="muted">
                    Nenhum apontamento vinculado a esta medição.
                  </p>
                )}
                {receivableContext.evidencePageInfo.total > 50 && (
                  <div className="pagination">
                    <EnterpriseButton type="button"
                      disabled={receivableContext.evidencePageInfo.page === 1}
                      onClick={() =>
                        void openReceivable(
                          receivableContext.identity.id,
                          receivableContext.identity.entityKey ??
                            "measurements",
                          1,
                          receivableContext.evidencePageInfo!.page - 1,
                        )
                      }
                    >
                      Anterior
                    </EnterpriseButton>
                    <span>
                      {receivableContext.evidencePageInfo.total} evidências ·
                      página {receivableContext.evidencePageInfo.page}
                    </span>
                    <EnterpriseButton type="button"
                      disabled={!receivableContext.evidencePageInfo.hasMore}
                      onClick={() =>
                        void openReceivable(
                          receivableContext.identity.id,
                          receivableContext.identity.entityKey ??
                            "measurements",
                          1,
                          receivableContext.evidencePageInfo!.page + 1,
                        )
                      }
                    >
                      Próxima
                    </EnterpriseButton>
                  </div>
                )}
              </>
            )}
            <dl>
              <div>
                <dt>Medição</dt>
                <dd>
                  {receivableContext.relations.measurementId
                    .slice(0, 8)
                    .toUpperCase()}
                </dd>
              </div>
              <div>
                <dt>Cobrança interna</dt>
                <dd>
                  {receivableContext.relations.invoiceId
                    ? receivableContext.relations.invoiceId
                        .slice(0, 8)
                        .toUpperCase()
                    : "Ainda não gerada"}
                </dd>
              </div>
            </dl>
            <EnterpriseButton type="button"
              className="related"
              onClick={() => {
                setReceivableContext(null);
                void openOrigin(receivableContext.relations.orderId);
              }}
            >
              <span>
                <strong>{receivableContext.relations.orderTitle}</strong>
                <small>Consultar ordem de origem</small>
              </span>
              <ChevronRight size={16} />
            </EnterpriseButton>
          </aside>
        </div>
      )}
      {settlementAction && receivableContext && (
        <div className="overlay modal-overlay">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Lançamento financeiro"
          >
            <header>
              <h2>
                {settlementAction.command === "record_receipt"
                  ? "Registrar recebimento"
                  : "Estornar recebimento"}
              </h2>
              <EnterpriseButton type="button"
                className="icon-button"
                onClick={() => setSettlementAction(null)}
                aria-label="Fechar lançamento"
              >
                <X size={20} />
              </EnterpriseButton>
            </header>
            <p className="muted">
              {settlementAction.command === "record_receipt"
                ? "Registro manual: informe o valor efetivamente recebido e uma referência verificável."
                : "O estorno preserva o lançamento original no histórico."}
            </p>
            <form onSubmit={submitSettlement}>
              {settlementAction.command === "record_receipt" && (
                <label>
                  Valor recebido (R$)
                  <EnterpriseInput
                    autoFocus
                    name="amount"
                    inputMode="decimal"
                    pattern="[0-9]+(,[0-9]{1,4})?"
                    required
                  />
                </label>
              )}
              <label>
                Data do fato
                <EnterpriseInput type="date" name="effectiveDate" required />
              </label>
              <label>
                Referência / comprovante
                <EnterpriseInput
                  name="reference"
                  minLength={3}
                  maxLength={160}
                  required
                />
              </label>
              {notice && noticeTone === "error" && (
                <p role="alert" className="form-error">
                  {notice}
                </p>
              )}
              <footer>
                <EnterpriseButton
                  type="button"
                  className="secondary"
                  disabled={saving}
                  onClick={() => setSettlementAction(null)}
                >
                  Cancelar
                </EnterpriseButton>
                <EnterpriseButton type="submit" className="primary" disabled={saving}>
                  {saving ? "Registrando…" : "Confirmar"}
                </EnterpriseButton>
              </footer>
            </form>
          </section>
        </div>
      )}
      {selected && (
        <div
          className={
            "overlay context-overlay " + (docked ? "context-docked" : "")
          }
          onClick={() => {
            if (!docked) setSelected(null);
          }}
        >
          <aside
            className="drawer"
            role="dialog"
            aria-modal={!docked}
            aria-label="Contexto da ordem"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <span className="eyebrow">CONTEXTO DA ORDEM</span>
              <EnterpriseButton type="button"
                className="icon-button"
                aria-label="Fechar contexto"
                autoFocus
                onClick={() => setSelected(null)}
              >
                <X size={21} />
              </EnterpriseButton>
            </header>
            <span className={"badge status-" + selected.status}>
              {statusNames[selected.status]}
            </span>
            <h2>{selected.title}</h2>
            <p className="muted">
              OS · {selected.id.slice(0, 8).toUpperCase()}
            </p>
            <dl>
              <div>
                <dt>
                  {selected.client_id || selected.relations?.clientId
                    ? "Cliente cadastrado"
                    : "Cliente histórico informado"}
                </dt>
                <dd>{selected.client}</dd>
              </div>
              <div>
                <dt>Atividade</dt>
                <dd>{selected.category}</dd>
              </div>
              <div>
                <dt>Data prevista</dt>
                <dd>{date(selected.due_date)}</dd>
              </div>
              <div>
                <dt>Registrada em</dt>
                <dd>{date(selected.created_at)}</dd>
              </div>
            </dl>
            <h3 className="drawer-section-title">Escopo da operação</h3>
            <p className="description drawer-scope">
              {selected.description || "Escopo não informado."}
            </p>
            <div className="next-block">
              <span className="eyebrow">CONTINUIDADE</span>
              <h3>
                {selected.availableCommands?.find((c) => c.primary)?.label ??
                  "Sem próxima ação disponível"}
              </h3>
              <p>
                {selected.availableCommands?.length
                  ? "Execute um comando permitido para avançar esta ordem. Cada transição é validada e registrada pelo servidor."
                  : "Consulte o histórico e os registros relacionados para acompanhar esta ordem."}
              </p>
              <div className="command-buttons">
                {selected.availableCommands?.map((c) => (
                  <EnterpriseButton type="button"
                    className={c.primary ? "primary" : "secondary"}
                    key={c.id}
                    disabled={saving || !!contextError}
                    onClick={() => command(c.id, selected)}
                  >
                    {c.label}
                  </EnterpriseButton>
                ))}
              </div>
            </div>
            {contextError && (
              <p role="alert" className="form-error">
                {contextError}
              </p>
            )}
            <h3 className="drawer-section-title">Origem comercial</h3>
            {(selected.client_id ?? selected.relations?.clientId) && (
              <EnterpriseButton type="button"
                className="related"
                onClick={() =>
                  void openOrderRelation(
                    "clients",
                    (selected.client_id ?? selected.relations?.clientId)!,
                    selected.id,
                  )
                }
              >
                <span>
                  <strong>Cliente · {selected.client}</strong>
                  <small>Consultar cadastro sem sair da OS</small>
                </span>
                <ChevronRight size={16} />
              </EnterpriseButton>
            )}
            {(selected.contract_id ?? selected.relations?.contractId) && (
              <EnterpriseButton type="button"
                className="related"
                onClick={() =>
                  void openOrderRelation(
                    "contracts",
                    (selected.contract_id ?? selected.relations?.contractId)!,
                    selected.id,
                  )
                }
              >
                <span>
                  <strong>Contrato de origem</strong>
                  <small>Consultar termo, proposta e PO vinculados</small>
                </span>
                <ChevronRight size={16} />
              </EnterpriseButton>
            )}
            {!(selected.client_id ?? selected.relations?.clientId) && (
              <p className="muted">
                Registro histórico sem Cliente reconciliado.
              </p>
            )}
            {orderRelation?.orderId === selected.id && (
              <section
                className="order-relation-context"
                aria-label="Contexto relacionado"
              >
                <header>
                  <strong>
                    {orderRelation.kind === "clients"
                      ? "Cliente"
                      : orderRelation.kind === "contracts"
                        ? "Contrato"
                        : orderRelation.kind === "proposals"
                          ? "Proposta"
                          : "PO"}
                  </strong>
                  <EnterpriseButton type="button"
                    className="text-button"
                    onClick={() => setOrderRelation(null)}
                  >
                    Fechar contexto
                  </EnterpriseButton>
                </header>
                {orderRelation.loading ? (
                  <p role="status">Consultando documento…</p>
                ) : orderRelation.error ? (
                  <div role="alert" className="form-error">
                    {orderRelation.error}
                    <EnterpriseButton type="button"
                      className="secondary"
                      onClick={() =>
                        void openOrderRelation(
                          orderRelation.kind as
                            | "clients"
                            | "contracts"
                            | "proposals"
                            | "purchase-orders",
                          orderRelation.id,
                          selected.id,
                        )
                      }
                    >
                      Tentar novamente
                    </EnterpriseButton>
                  </div>
                ) : (
                  orderRelation.projection && (
                    <>
                      <h4>
                        {orderRelation.projection.legalName ??
                          orderRelation.projection.reference ??
                          orderRelation.projection.proposalTitle}
                      </h4>
                      <p>
                        {orderRelation.projection.state?.label ??
                          "Registro persistido"}
                      </p>
                      {orderRelation.projection.scope && (
                        <p>{orderRelation.projection.scope}</p>
                      )}
                      {orderRelation.projection.document && (
                        <p>Documento · {orderRelation.projection.document}</p>
                      )}
                      {orderRelation.projection.email && (
                        <p>{orderRelation.projection.email}</p>
                      )}
                      {orderRelation.projection.proposalId && (
                        <EnterpriseButton type="button"
                          className="related"
                          onClick={() =>
                            void openOrderRelation(
                              "proposals",
                              orderRelation.projection!.proposalId!,
                              selected.id,
                            )
                          }
                        >
                          Consultar proposta de origem
                          <ChevronRight size={16} />
                        </EnterpriseButton>
                      )}
                      {orderRelation.projection.purchaseOrderId && (
                        <EnterpriseButton type="button"
                          className="related"
                          onClick={() =>
                            void openOrderRelation(
                              "purchase-orders",
                              orderRelation.projection!.purchaseOrderId!,
                              selected.id,
                            )
                          }
                        >
                          Consultar PO de origem
                          <ChevronRight size={16} />
                        </EnterpriseButton>
                      )}
                    </>
                  )
                )}
              </section>
            )}
            {(selected.client_id ?? selected.relations?.clientId) && (
              <OrderNextcrmDocuments key={selected.id} orderId={selected.id} />
            )}
            <h3 className="drawer-section-title">Registros relacionados</h3>
            <EnterpriseButton type="button"
              className="related"
              onClick={() => {
                const id = selected.id;
                navigate("Execução");
                setExecutionOrder(id);
              }}
            >
              <span>
                <strong>Apontamentos de execução</strong>
                <small>Consultar produção e recursos declarados</small>
              </span>
            </EnterpriseButton>
            {["Medições", "Faturamento", "Financeiro"].map((n) => (
              <EnterpriseButton type="button"
                key={n}
                className="related"
                onClick={() => navigate(n, selected?.id)}
              >
                <span>
                  <strong>{n}</strong>
                  <small>
                    {contextError
                      ? "Vínculos indisponíveis"
                      : String(
                          selected.relations?.[
                            n === "Medições"
                              ? "measurements"
                              : n === "Faturamento"
                                ? "invoices"
                                : "receivables"
                          ] ?? "—",
                        ) + " registros vinculados"}
                  </small>
                </span>
                <ChevronRight size={16} />
              </EnterpriseButton>
            ))}
            <details className="drawer-history">
              <summary>Histórico operacional recente</summary>
              {contextError ? (
                <p className="muted">Histórico indisponível.</p>
              ) : !selected.sublists ? (
                <p className="muted">Consultando histórico…</p>
              ) : (
                selected.sublists.history.items.map((e) => (
                  <div className="event-row" key={e.id}>
                    <span>{e.label}</span>
                    <small>{date(e.created_at)}</small>
                  </div>
                ))
              )}
            </details>
          </aside>
        </div>
      )}

      {action && !["measure", "invoice"].includes(action.command) && (
        <div className="overlay modal-overlay">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="action-title"
          >
            <header>
              <h2 id="action-title">
                {
                  action.record.availableCommands?.find(
                    (c) => c.id === action.command,
                  )?.label
                }
              </h2>
              <EnterpriseButton type="button"
                className="icon-button"
                aria-label="Fechar comando"
                onClick={() => setAction(null)}
              >
                <X size={22} />
              </EnterpriseButton>
            </header>
            <p className="muted">
              {action.record.title} · {action.record.client}
            </p>
            <form onSubmit={execute}>
              {action.command === "measure" ? (
                <>
                  <label>
                    Descrição da produção
                    <EnterpriseTextarea
                      autoFocus
                      name="description"
                      minLength={3}
                      maxLength={4000}
                      required
                      rows={3}
                    />
                  </label>
                  <label>
                    Valor da medição (R$)
                    <EnterpriseInput
                      name="amount"
                      inputMode="decimal"
                      placeholder="0,0000"
                      pattern="[0-9]+(,[0-9]{1,4})?"
                      required
                    />
                  </label>
                </>
              ) : action.command === "invoice" ? (
                <>
                  <p>
                    A cobrança cria um recebível do mesmo valor e mantém o
                    vínculo com a medição. Não emite documento fiscal.
                  </p>
                  <label>
                    Vencimento
                    <EnterpriseInput autoFocus type="date" name="dueDate" required />
                  </label>
                </>
              ) : (
                <p>
                  Confirme a execução deste comando. A operação será validada
                  pelo servidor e registrada no histórico.
                </p>
              )}
              {notice && (
                <p role="alert" className="form-error">
                  {notice}
                </p>
              )}
              <footer>
                <EnterpriseButton
                  type="button"
                  className="secondary"
                  disabled={saving}
                  onClick={() => setAction(null)}
                >
                  Voltar
                </EnterpriseButton>
                <EnterpriseButton type="submit"
                  autoFocus={
                    action.command !== "measure" && action.command !== "invoice"
                  }
                  className="primary"
                  disabled={saving}
                >
                  {saving ? "Executando…" : "Confirmar comando"}
                </EnterpriseButton>
              </footer>
            </form>
          </section>
        </div>
      )}
      {savingView && (
        <div className="overlay modal-overlay">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="view-title"
          >
            <header>
              <h2 id="view-title">Salvar consulta</h2>
              <EnterpriseButton type="button"
                className="icon-button"
                aria-label="Fechar consulta"
                onClick={() => setSavingView(false)}
              >
                <X size={20} />
              </EnterpriseButton>
            </header>
            <p className="muted">
              {savingViewFor === "serviceOrders.worklist"
                ? "Salve a busca, atividade e filtro atual para reutilizar na fila de ordens."
                : "Salve os filtros, contexto e ordenação desta fila para retomá-los depois."}
            </p>
            <form onSubmit={saveView}>
              <label>
                Nome da consulta
                <EnterpriseInput
                  autoFocus
                  name="name"
                  required
                  minLength={2}
                  maxLength={60}
                  placeholder="Ex.: Locações em execução"
                />
              </label>
              {viewNotice && (
                <p className="form-error" role="alert">
                  {viewNotice}
                </p>
              )}
              <footer>
                <EnterpriseButton
                  type="button"
                  className="secondary"
                  onClick={() => setSavingView(false)}
                >
                  Cancelar
                </EnterpriseButton>
                <EnterpriseButton type="submit" className="primary" disabled={saving}>
                  {saving ? "Salvando…" : "Salvar consulta"}
                </EnterpriseButton>
              </footer>
            </form>
          </section>
        </div>
      )}
      {palette && (
        <div
          className="overlay modal-overlay"
          onClick={() => setPalette(false)}
        >
          <section
            className="palette"
            role="dialog"
            aria-modal="true"
            aria-label="Busca global"
            onClick={(e) => e.stopPropagation()}
          >
            <EnterpriseSearchField label="Buscar ordens, clientes ou áreas" placeholder="Buscar ordens, clientes ou áreas…" value={paletteQuery} disabled={false} onValueChange={value => setPaletteQuery(value)} />
            {paletteQuery.trim().length >= 2 && (
              <div className="palette-orders">
                <p>ORDENS DE SERVIÇO</p>
                {paletteError ? (
                  <div className="palette-state form-error" role="alert">
                    {paletteError}
                  </div>
                ) : paletteLoading ||
                  paletteResult.query !== paletteQuery.trim() ? (
                  <div className="palette-state" role="status">
                    Consultando ordens…
                  </div>
                ) : paletteResult.items.length ? (
                  <>
                    {paletteResult.items.map((o) => (
                      <EnterpriseButton type="button"
                        className="palette-result"
                        key={o.id}
                        onClick={() => {
                          if (!isWork) navigate("Ordens de serviço");
                          setSelected(o);
                          setPalette(false);
                        }}
                      >
                        <ClipboardList size={18} />
                        <span>
                          <strong>{o.title}</strong>
                          <small>
                            {o.client} · OS {o.id.slice(0, 8).toUpperCase()}
                          </small>
                        </span>
                        <span className={"badge status-" + o.status}>
                          {statusNames[o.status]}
                        </span>
                      </EnterpriseButton>
                    ))}
                    <small className="palette-result-count">
                      {paletteResult.total} resultados ·{" "}
                      {paletteResult.items.length} exibidos
                    </small>
                  </>
                ) : (
                  <div className="palette-state">
                    Nenhuma ordem corresponde à busca.
                  </div>
                )}
              </div>
            )}
            {paletteQuery.trim().length>=2&&<div className="palette-business-search">
              <p>CLIENTES, PROPOSTAS E CONTRATOS</p>
              {businessSearchError&&businessSearch.query===paletteQuery.trim()?<div className="palette-state form-error" role="alert">{businessSearchError}</div>:businessSearchLoading||businessSearch.query!==paletteQuery.trim()?<div className="palette-state" role="status">Consultando registros empresariais…</div>:businessSearch.items.length?businessSearch.items.map(item=><EnterpriseButton type="button" className="palette-result" key={item.kind+item.id} onClick={()=>{if(item.kind==='client'){navigate('Clientes e propostas');setClientOrigin(item.id);}else if(item.kind==='proposal'){navigate('Propostas e PO');setCommercialOrigin(item.id);}else{navigate('Contratos');setContractOrigin(item.id);}setPalette(false);}}>
                {item.kind==='client'?<Building2 size={18}/>:item.kind==='proposal'?<FileText size={18}/>:<Receipt size={18}/>}
                <span><strong>{item.title}</strong><small>{item.kind==='client'?'Cliente':item.kind==='proposal'?'Proposta':'Contrato'} · {item.subtitle}</small></span>
                <span className="badge">{item.status}</span>
              </EnterpriseButton>):<div className="palette-state">Nenhum cliente, proposta ou contrato corresponde à busca.</div>}
            </div>}
            <p>ÁREAS DO CISNE</p>
            {modules
              .flatMap((g) => g.items)
              .filter(([n]) =>
                n.toLowerCase().includes(paletteQuery.toLowerCase()),
              )
              .map(([n, Icon]) => (
                <EnterpriseButton type="button" key={n} onClick={() => navigate(n)}>
                  <Icon size={18} />
                  {n}
                  <ChevronRight size={15} />
                </EnterpriseButton>
              ))}
            <footer>
              <span>Busca registros por OS, cliente, proposta e contrato. Resultados limitados aos dados autorizados.</span>
              <kbd>Esc</kbd>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
export default function Home() {
  return <HomeView />;
}
