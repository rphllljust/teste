"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
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
import EnterpriseDossierWorkspace from "./EnterpriseDossierWorkspace";
import CRMWorkspace from "./CRMWorkspace";
import MRPWorkspace from "./MRPWorkspace";
import ProfessionalsWorkspace from "./ProfessionalsWorkspace";
import AssetsWorkspace from "./AssetsWorkspace";
import ServiceOperationsAgenda from "./ServiceOperationsAgenda";
import FieldServiceCockpit from "./FieldServiceCockpit";
import ResourcePlanningBoard from "./ResourcePlanningBoard";
import { EnterpriseObjectSectionNavigation, EnterpriseObjectSummary, EnterprisePageHeader } from "./components/enterprise/EnterprisePrimitives";
import type { LucideIcon } from "lucide-react";
import { moduleGroups, isModuleLabel, moduleHash, type ModuleNavItem } from "../lib/navigation/catalog";
import { objectHash, parseObjectHash } from "../lib/navigation/object-routes";

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
const iconByKey = { activity: Activity, dashboard: LayoutDashboard, orders: ClipboardList, people: Users, assets: Truck, finance: Wallet, billing: Receipt, accounting: BookOpen, inventory: Package, file: FileText, procurement: Package, field: HardHat, calendar: CalendarDays } as const;
function normalizeEnterpriseSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
}
const modules: { group: string; items: [string, LucideIcon][] }[] = moduleGroups.map((group) => ({
  group: group.label,
  items: group.items.map((item: ModuleNavItem) => [item.label, iconByKey[item.icon]] as [string, LucideIcon]),
}));
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
    [executionOrder, setExecutionOrder] = useState("");
  const [density, setDensity] = useState<"compact" | "comfortable">("compact");
  const [navigationCollapsed, setNavigationCollapsed] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  useEffect(() => {
    // Restore after hydration; no synchronous setState in effects or SSR/localStorage mismatch.
    const timer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem("cisne:workspace-density");
        if (saved === "compact" || saved === "comfortable") setDensity(saved);
        if (window.localStorage.getItem("cisne:workbench-navigation") === "collapsed") setNavigationCollapsed(true);
      } catch {
        // Managed browsers may deny localStorage; session density still works.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  function toggleNavigation() {
    setNavigationCollapsed(value => {
      const next = !value;
      try { window.localStorage.setItem("cisne:workbench-navigation", next ? "collapsed" : "expanded"); }
      catch { /* Layout preference remains available for the session. */ }
      return next;
    });
  }
  function toggleDensity() {
    const next = density === "compact" ? "comfortable" : "compact";
    setDensity(next);
    try { window.localStorage.setItem("cisne:workspace-density", next); }
    catch { /* Browser restrictions must not interrupt the workspace. */ }
  }
  const defaultsApplied = useRef(false);
  const operationGeneration = useRef(0);
  const requestGeneration = useRef(0);
  const chainViewport = useRef<HTMLDivElement>(null);
  const [chainEdges, setChainEdges] = useState({ before: false, after: false });
  const currentGroup =
    modules.find((group) => group.items.some(([name]) => name === page))?.group ??
    "INÍCIO E OPERAÇÃO";
  const paletteModuleResults = modules.flatMap((group) => group.items)
    .filter(([name]) => normalizeEnterpriseSearch(name).includes(normalizeEnterpriseSearch(paletteQuery)));
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
      if (generation !== requestGeneration.current) return;
      setOrders(d.orders);
      setTotal(d.total);
      setSummary(d.summary);
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
  function handlePaletteKey(event: React.KeyboardEvent<HTMLElement>) {
    const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(
      'button[data-palette-option="true"]',
    ));
    const target = event.target as HTMLElement;
    const isSearch = target instanceof HTMLInputElement;
    if (event.key === "Enter" && isSearch && options.length) {
      event.preventDefault();
      options[0].click();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || !options.length) return;
    if (isSearch && (event.key === "Home" || event.key === "End")) return;
    const current = options.indexOf(target as HTMLButtonElement);
    const last = options.length - 1;
    let next = current;
    if (event.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % options.length;
    else if (event.key === "ArrowUp") next = current < 0 ? last : (current - 1 + options.length) % options.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    event.preventDefault();
    options[next]?.focus();
  }
  function navigate(name: string, orderId = "") {
    setBusinessClient("");
    setBusinessContract("");
    setCommercialOrigin("");
    setDrillFilters({});
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
    window.history.pushState(null, "", objectHash(name, orderId || undefined));
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
      const parsed = parseObjectHash(window.location.hash);
      const name = parsed.module;
      if (modules.some((g) => g.items.some(([n]) => n === name))) {
        setPage(name);
        if (parsed.objectId && name === "Ordens de serviço") void openOrigin(parsed.objectId);
      } else if (!window.location.hash) {
        window.history.replaceState(null, "", objectHash(name));
      }
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
    <div className="app" data-density={density} data-navigation={navigationCollapsed ? "collapsed" : "expanded"}>
      {sidebar && (
        <button
          className="sidebar-scrim"
          aria-label="Fechar navegação"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside className={"sidebar " + (sidebar ? "mobile-open" : "")}>
        <Link prefetch={false} className="brand" href="/" aria-label="Cisne início" title="CISNE Rondônia">
          <span className="brand-mark">
            <Layers size={24} />
          </span>
          <span>
            CISNE<small>RONDÔNIA</small>
          </span>
        </Link>
        <div className="company">
          <Building2 size={18} />
          <span>
            Gestão empresarial<small>Dados sob controle de acesso</small>
          </span>
        </div>
        <nav aria-label="Módulos empresariais">
          {modules.map((g) => (
            <div className="nav-group" key={g.group}>
              <p>{g.group}</p>
              {g.items.map(([name, Icon]) => (
                <button
                  key={name}
                  onClick={() => navigate(name)}
                  className={page === name ? "active" : ""}
                  title={name}
                  aria-label={name}
                  aria-current={page === name ? "page" : undefined}
                >
                  <Icon size={18} />
                  <span>{name}</span>
                  {name === "Ordens de serviço" && (
                    <span className="nav-count">
                      {loading || error ? "—" : summary.total}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Link prefetch={false} href="/enterprise" className="enterprise-structure-link" style={{display:"flex",alignItems:"center",gap:8,padding:"10px 12px"}}><Building2 size={17}/> Gestão de empresas</Link>
          <span className="version">
            <span />
            Cisne · Plataforma empresarial
          </span>
          <button
            onClick={() => {
              setPaletteQuery("");
              setPalette(true);
            }}
          >
            <Command size={17} /> Navegação rápida <kbd>Ctrl K</kbd>
          </button>
        </div>
      </aside>
      <div className={"main " + (selected && docked ? "with-context" : "")}>
        <header className="topbar">
          <div className="crumb">
            <button
              type="button"
              className="enterprise-nav-collapse icon-button"
              aria-label={navigationCollapsed ? "Expandir navegação lateral" : "Recolher navegação lateral"}
              aria-pressed={navigationCollapsed}
              onClick={toggleNavigation}
              title={navigationCollapsed ? "Expandir menu" : "Recolher menu"}
            ><PanelLeft size={19}/></button>
            <button
              className="mobile-toggle icon-button"
              aria-label={sidebar ? "Fechar menu" : "Abrir menu"}
              aria-expanded={sidebar}
              onClick={() => setSidebar(!sidebar)}
            >
              <PanelLeft size={20} />
            </button>
            <span>CISNE</span>
            <span className="crumb-divider">/</span>
            <span>{currentGroup}</span>
            <ChevronRight size={14} />
            <strong>{page}</strong>
          </div>
          <div className="top-actions">
            <button type="button" className="enterprise-shortcut-trigger secondary"
              aria-expanded={shortcutsOpen} aria-controls="cisne-workbench-shortcuts"
              onClick={() => setShortcutsOpen(previous => !previous)}>
              <LayoutDashboard size={16}/> Atalhos <ChevronRight size={14}/>
            </button>
            <button
              className="global-search"
              aria-label="Buscar no Cisne — Ctrl ou Command K"
              aria-keyshortcuts="Control+k Meta+k"
              onClick={() => {
                setPaletteQuery("");
                setPalette(true);
              }}
            >
              <Search size={16} />
              Buscar no Cisne<kbd>Ctrl K</kbd>
            </button>
            <button
              type="button"
              className="enterprise-density-control"
              aria-label={density === "compact" ? "Ativar visualização confortável" : "Ativar visualização compacta"}
              aria-pressed={density === "compact"}
              onClick={toggleDensity}
              title="Alternar densidade de tabelas e formulários"
            >
              <SlidersHorizontal size={16} />
              <span>{density === "compact" ? "Compacta" : "Confortável"}</span>
            </button>
          </div>
          {shortcutsOpen && <nav id="cisne-workbench-shortcuts" className="enterprise-quick-access" aria-label="Atalhos de trabalho">
            <span>Acesso rápido aos módulos</span>
            {["Visão operacional", "Dossiês empresariais", "CRM e Vendas", "Contratos", "Compras", "Contas a pagar", "Contabilidade"].map((module) => (
              <button
                type="button"
                key={module}
                aria-current={page === module ? "page" : undefined}
                onClick={() => { setShortcutsOpen(false); navigate(module); }}
              >
                {module}
              </button>
            ))}
          </nav>}
        </header>
        <main
          className={isWork ? "operational-workspace" : "business-workspace"}
        >
          {!creating &&
            !["measure", "invoice"].includes(action?.command ?? "") &&
            ![
              "Compras",
              "Estoque e compras",
              "Visão financeira",
              "Fluxo de caixa",
              "CRM e Vendas",
              "Clientes e propostas",
              "Propostas e PO",
              "Contratos",
              "Execução",
              "Visão financeira",
              "Fluxo de caixa",
              "Tesouraria",
              "Contas a pagar",
              "Caixa e conciliação",
              "Razão contábil",
              "Contabilidade",
              "Fiscal e tributos",
              "Fechamentos",
              "Compras",
              "Estoque e compras",
              "Field Service Cockpit",
              "Resource Planning Board",
              "Dossiês empresariais",
              "Visão operacional",
            ].includes(page) && (
              <>
              <EnterprisePageHeader
                breadcrumb={`CISNE / ${currentGroup} / ${page}`}
                eyebrow={`${currentGroup} · CISNE RONDÔNIA`}
                title={page}
                description={isWork
                  ? "Acompanhe as ordens e execute o próximo passo na fila."
                  : moduleDescription[page]}
                actions={isWork ? <button className="primary" onClick={newOrder}>
                  <Plus size={18} />
                  Nova ordem de serviço
                </button> : undefined}
              />
              {viewNotice && !savingView && (
                <p role="alert" className="form-error">
                  {viewNotice}
                </p>
              )}
              </>
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
              <button aria-label="Fechar aviso" onClick={() => setNotice("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {[
            "Ordens de serviço",
            "Execução",
            "Medições",
            "Faturamento",
            "Financeiro",
            "Fiscal e tributos",
            "Contabilidade",
          ].includes(page) && (
            <section className="process-strip" aria-label="Cadeia operacional">
              <div className="process-label">
                <Layers size={17} />
                <span>CADEIA INTEGRADA</span>
              </div>
              <div
                className={
                  "chain-scroll " +
                  (chainEdges.before ? "has-before " : "") +
                  (chainEdges.after ? "has-after" : "")
                }
              >
                <button
                  className="chain-navigation chain-previous"
                  aria-label="Ver etapas anteriores"
                  hidden={!chainEdges.before}
                  onClick={() => scrollChain(-1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <div
                  className="chain-viewport"
                  ref={chainViewport}
                  tabIndex={0}
                  aria-label="Etapas da cadeia; use as setas para navegar"
                  onScroll={updateChainEdges}
                  onKeyDown={handleChainKey}
                >
                  <div className="process-stages">
                    {chain.map((s, i) => {
                      const stageClass =
                        i === currentStage
                          ? "current"
                          : i > currentStage
                            ? "subsequent"
                            : "";
                      return i < 5 ? (
                        <button
                          key={s}
                          data-stage-index={i}
                          className={stageClass}
                          aria-current={
                            i === currentStage ? "location" : undefined
                          }
                          onClick={() => {
                            navigate(
                              [
                                "Ordens de serviço",
                                "Ordens de serviço",
                                "Medições",
                                "Faturamento",
                                "Financeiro",
                              ][i],
                            );
                            if (i === 0 || i === 1)
                              applyView(
                                i === 1 ? "Em execução" : "Todas as ordens",
                              );
                          }}
                        >
                          <span className="step-number">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          {s}
                          <ChevronRight className="stage-divider" size={13} />
                        </button>
                      ) : (
                        <span
                          key={s}
                          className={"stage-unavailable " + stageClass}
                          aria-disabled="true"
                          title="Área em preparação"
                        >
                          <span className="step-number">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          {s}
                          {i < 6 && (
                            <ChevronRight className="stage-divider" size={13} />
                          )}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <button
                  className="chain-navigation chain-next"
                  aria-label="Ver próximas etapas"
                  hidden={!chainEdges.after}
                  onClick={() => scrollChain(1)}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </section>
          )}
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
          ) : page === "Profissionais" ? (
            <ProfessionalsWorkspace />
          ) : page === "Frota e ativos" ? (
            <AssetsWorkspace />
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
              onNavigate={navigate}
              onOpenOrder={(id) => {
                navigate("Ordens de serviço");
                void openOrigin(id);
              }}
            />
          ) : page === "Visão operacional" ? (
            <EnterpriseCommandCenter
              summary={summary}
              navigate={navigate}
              onCreate={newOrder}
              onOpenOrder={(id) => {
                navigate("Ordens de serviço");
                void openOrigin(id);
              }}
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
                <button
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
                </button>
                <button
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
                </button>
                <button
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
                </button>
                <button
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
                </button>
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
                              <button
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
                              </button>
                              <button
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
                              </button>
                            </div>
                          ))}
                          <button
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
                          </button>
                        </div>
                      </details>
                      <button
                        className="icon-button"
                        disabled={loading}
                        onClick={() => void load()}
                        aria-label="Atualizar ordens"
                      >
                        <RefreshCw
                          size={17}
                          className={loading ? "spin" : ""}
                        />
                      </button>
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
                      <button
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
                      </button>
                    ))}
                  </div>
                  <div className="filters">
                    <label className="search-input">
                      <Search size={17} />
                      <input
                        placeholder="Buscar OS ou cliente"
                        aria-label="Buscar OS ou cliente"
                        value={query}
                        onChange={(e) => {
                          setPageNumber(1);
                          setQuery(e.target.value);
                        }}
                      />
                    </label>
                    <label className="select-filter">
                      <Filter size={15} />
                      <select
                        aria-label="Filtrar atividade"
                        value={category}
                        onChange={(e) => {
                          setPageNumber(1);
                          setCategory(e.target.value);
                        }}
                      >
                        {categories.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
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
                          <select
                            aria-label="Ordenar ordens"
                            value={sort}
                            onChange={(e) => {
                              setSort(e.target.value);
                              setPageNumber(1);
                            }}
                          >
                            <option value="createdAt.desc">
                              Mais recentes
                            </option>
                            <option value="createdAt.asc">Mais antigas</option>
                            <option value="title.asc">Título</option>
                            <option value="dueDate.asc">Data prevista</option>
                          </select>
                        </label>
                        <label className="select-filter">
                          Por página
                          <select
                            aria-label="Ordens por página"
                            value={pageSize}
                            onChange={(e) => {
                              setPageSize(Number(e.target.value));
                              setPageNumber(1);
                            }}
                          >
                            {[10, 25, 50, 100].map((n) => (
                              <option key={n}>{n}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </details>
                    {(query || category !== categories[0]) && (
                      <button
                        onClick={() => {
                          setPageNumber(1);
                          setQuery("");
                          setCategory(categories[0]);
                        }}
                        className="text-button"
                      >
                        Limpar
                      </button>
                    )}
                  </div>
                  {(query || category !== categories[0]) && (
                    <div className="filter-context">
                      <span>Filtros ativos</span>
                      {query && (
                        <button
                          onClick={() => {
                            setPageNumber(1);
                            setQuery("");
                          }}
                          aria-label="Remover busca"
                        >
                          Busca: {query}
                          <X size={12} />
                        </button>
                      )}
                      {category !== categories[0] && (
                        <button
                          onClick={() => {
                            setPageNumber(1);
                            setCategory(categories[0]);
                          }}
                          aria-label="Remover filtro de atividade"
                        >
                          {category}
                          <X size={12} />
                        </button>
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
                                    <button
                                      className="row-link"
                                      onClick={() => setSelected(o)}
                                    >
                                      {o.title}
                                    </button>
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
                                      <button
                                        className="row-command"
                                        disabled={saving}
                                        onClick={() => command(next.name, o)}
                                      >
                                        {next.label}
                                      </button>
                                    ) : (
                                      <span className="cell-secondary">
                                        Sem ação nesta etapa
                                      </span>
                                    )}
                                  </td>
                                  <td>
                                    <button
                                      className="icon-button row-context"
                                      onClick={() => setSelected(o)}
                                      aria-label={
                                        "Abrir contexto da OS " + o.title
                                      }
                                    >
                                      <ChevronRight size={17} />
                                    </button>
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
                        <button
                          className="secondary"
                          onClick={() => void load()}
                        >
                          <RefreshCw size={15} />
                          Tentar novamente
                        </button>
                      ) : summary.total ? (
                        <button
                          className="secondary"
                          onClick={() => applyView("Todas as ordens")}
                        >
                          Limpar filtros
                        </button>
                      ) : (
                        <button className="secondary" onClick={newOrder}>
                          <Plus size={16} />
                          Registrar primeira ordem
                        </button>
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
                      <button
                        disabled={loading || !!error || pageNumber === 1}
                        onClick={() => setPageNumber((n) => n - 1)}
                      >
                        Anterior
                      </button>
                      <button
                        disabled={
                          loading || !!error || pageNumber * pageSize >= total
                        }
                        onClick={() => setPageNumber((n) => n + 1)}
                      >
                        Próxima
                      </button>
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
                          <button
                            disabled={!v.compatible || !v.definition}
                            onClick={() => {
                              if (v.definition) applyLinkedView(v.definition);
                            }}
                          >
                            {v.name}
                            {v.isDefault ? " · padrão" : ""}
                            {!v.compatible ? " · incompatível" : ""}
                          </button>
                          <button
                            disabled={!v.compatible || !v.rowVersion}
                            aria-label={
                              (v.isDefault
                                ? "Remover padrão: "
                                : "Definir padrão: ") + v.name
                            }
                            onClick={() => void defaultView(v, true)}
                          >
                            {v.isDefault ? "Remover padrão" : "Definir padrão"}
                          </button>
                        </div>
                      ))}
                      <button
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
                      </button>
                    </div>
                  </details>
                  <button
                    className="icon-button"
                    onClick={() => void loadOperation()}
                    aria-label="Atualizar registros"
                  >
                    <RefreshCw size={17} />
                  </button>
                </div>
              </div>
              <div className="filters linked-filters">
                <label className="search-input">
                  <Search size={17} />
                  <input
                    aria-label="Buscar registros por OS, cliente ou identificador"
                    placeholder="Buscar OS, cliente ou identificador"
                    value={linkedQuery}
                    onChange={(e) =>
                      changeLinked(() => setLinkedQuery(e.target.value))
                    }
                  />
                </label>
                <label className="select-filter">
                  Ordenação
                  <select
                    aria-label="Ordenar registros"
                    value={linkedSort}
                    onChange={(e) =>
                      changeLinked(() => setLinkedSort(e.target.value))
                    }
                  >
                    <option value="createdAt.desc">Mais recentes</option>
                    <option value="createdAt.asc">Mais antigos</option>
                    <option value="title.asc">Título da OS</option>
                    <option value="dueDate.asc">
                      {page === "Medições" ? "Data prevista" : "Vencimento"}
                    </option>
                  </select>
                </label>
                <label className="select-filter">
                  Por página
                  <select
                    aria-label="Registros por página"
                    value={linkedSize}
                    onChange={(e) =>
                      changeLinked(() => setLinkedSize(Number(e.target.value)))
                    }
                  >
                    {[10, 25, 50, 100].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </label>
                {page === "Financeiro" && (
                  <label className="select-filter">
                    Liquidação
                    <select
                      aria-label="Filtrar situação da liquidação"
                      value={settlementState}
                      onChange={(e) =>
                        changeLinked(() => setSettlementState(e.target.value))
                      }
                    >
                      <option value="">Todas</option>
                      <option value="outstanding">Com saldo</option>
                      <option value="open">Em aberto</option>
                      <option value="partial">Parciais</option>
                      <option value="settled">Liquidadas</option>
                    </select>
                  </label>
                )}
                {page === "Medições" && (
                  <label className="select-filter">
                    Situação
                    <select
                      aria-label="Situação da medição"
                      value={linkedStatus}
                      onChange={(e) =>
                        changeLinked(() => setLinkedStatus(e.target.value))
                      }
                    >
                      <option value="">Todas</option>
                      <option value="draft">Rascunho</option>
                      <option value="approved">Aprovada</option>
                      <option value="billed">Faturada</option>
                    </select>
                  </label>
                )}
                <label className="select-filter">
                  {page === "Medições" ? "Previsão de" : "Vencimento de"}
                  <input
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
                  <input
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
                  <button className="text-button" onClick={clearLinkedFilters}>
                    Limpar filtros
                  </button>
                )}
              </div>
              <section
                className="metrics linked-metrics"
                aria-label="Totais dos registros filtrados"
              >
                {linkedMetrics.map((metric) => (
                  <button
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
                  </button>
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
                  <button
                    onClick={() => {
                      setBusinessOrder("");
                      setLinkedNumber(1);
                    }}
                  >
                    Remover contexto
                    <X size={12} />
                  </button>
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
                  <button
                    className="secondary"
                    onClick={() => void loadOperation()}
                  >
                    Tentar novamente
                  </button>
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
                            <button
                              className="row-link"
                              onClick={() => {
                                void openOrigin(r.order_id);
                              }}
                            >
                              {r.title}
                            </button>
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
                              <button
                                className="secondary"
                                disabled={saving}
                                onClick={() => command(nextCommand(r)!.name, r)}
                              >
                                {nextCommand(r)!.label}
                              </button>
                            ) : (
                              <button
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
                              </button>
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
                    <button className="secondary" onClick={clearLinkedFilters}>
                      Retomar registros
                    </button>
                  ) : (
                    <button
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
                    </button>
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
                  <button
                    disabled={
                      linkedLoading || !!operationError || linkedNumber === 1
                    }
                    onClick={() => setLinkedNumber((n) => n - 1)}
                  >
                    Anterior
                  </button>
                  <button
                    disabled={
                      linkedLoading || !!operationError || !linkedInfo?.hasMore
                    }
                    onClick={() => setLinkedNumber((n) => n + 1)}
                  >
                    Próxima
                  </button>
                </div>
                <span>
                  {linkedGeneratedAt && !linkedLoading && !operationError
                    ? `Atualizado às ${new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(linkedGeneratedAt))} · BRL`
                    : "Valores registrados · BRL"}
                </span>
              </footer>
            </section>
          ) : page === "Dossiês empresariais" ? (
            <EnterpriseDossierWorkspace navigate={navigate} onOpenOrder={id=>{navigate("Ordens de serviço");void openOrigin(id);}} />
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
            <ProposalsWorkspace initialId={commercialOrigin} />
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
            <PayablesWorkspace initialFilters={drillFilters} />
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
                <button
                  role="tab"
                  id="tab-inventory"
                  aria-controls="panel-supply"
                  aria-selected={supplyView === "inventory"}
                  className={supplyView === "inventory" ? "active" : ""}
                  onClick={() => setSupplyView("inventory")}
                >
                  Estoque e materiais
                </button>
                <button
                  role="tab"
                  id="tab-mrp"
                  aria-controls="panel-supply"
                  aria-selected={supplyView === "mrp"}
                  className={supplyView === "mrp" ? "active" : ""}
                  onClick={() => setSupplyView("mrp")}
                >
                  Planejamento MRP
                </button>
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
                    <button
                      className="secondary"
                      onClick={() => navigate("Ordens de serviço")}
                    >
                      <ClipboardList size={16} />
                      Voltar à operação
                    </button>
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
              <button
                onClick={() => {
                  setBusinessContract("");
                  setPageNumber(1);
                }}
              >
                Remover contexto
              </button>
            </div>
          )}
          {businessClient && (
            <div className="filter-context">
              <span>Ordens do cliente vinculado</span>
              <button
                onClick={() => {
                  setBusinessClient("");
                  setPageNumber(1);
                }}
              >
                Remover contexto
              </button>
            </div>
          )}
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
              <button
                className="icon-button"
                aria-label="Fechar registro"
                autoFocus
                onClick={() => setReceivableContext(null)}
              >
                <X size={21} />
              </button>
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
                    <button
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
                    </button>
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
                    <button
                      className="primary"
                      onClick={() =>
                        setSettlementAction({
                          command: "record_receipt",
                          key: crypto.randomUUID(),
                        })
                      }
                    >
                      Registrar recebimento
                    </button>
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
                        <button
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
                        </button>
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
                      <button
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
                      </button>
                      <button
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
                      </button>
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
                    <button
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
                    </button>
                    <span>
                      {receivableContext.evidencePageInfo.total} evidências ·
                      página {receivableContext.evidencePageInfo.page}
                    </span>
                    <button
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
                    </button>
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
            <button
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
            </button>
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
              <button
                className="icon-button"
                onClick={() => setSettlementAction(null)}
                aria-label="Fechar lançamento"
              >
                <X size={20} />
              </button>
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
                  <input
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
                <input type="date" name="effectiveDate" required />
              </label>
              <label>
                Referência / comprovante
                <input
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
                <button
                  type="button"
                  className="secondary"
                  disabled={saving}
                  onClick={() => setSettlementAction(null)}
                >
                  Cancelar
                </button>
                <button className="primary" disabled={saving}>
                  {saving ? "Registrando…" : "Confirmar"}
                </button>
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
              <button
                className="icon-button"
                aria-label="Fechar contexto"
                autoFocus
                onClick={() => setSelected(null)}
              >
                <X size={21} />
              </button>
            </header>
            <EnterpriseObjectSummary
               type="Ordem de serviço" reference={selected.id.slice(0,8).toUpperCase()}
               title={selected.title} status={statusNames[selected.status]}
               subtitle={selected.client+" · "+selected.category}
               facts={[
                 {label:selected.client_id||selected.relations?.clientId?"Cliente cadastrado":"Cliente histórico informado",
                   value:selected.client},
                 {label:"Atividade",value:selected.category},
                 {label:"Data prevista",value:date(selected.due_date)},
                 {label:"Registrada em",value:date(selected.created_at)},
               ]}/>
             <EnterpriseObjectSectionNavigation label="Seções da ordem de serviço"
               sections={[
                 {id:"order-scope",label:"Escopo"},
                 {id:"order-next",label:"Comandos"},
                 {id:"order-commercial",label:"Origem comercial"},
                 {id:"order-related",label:"Registros relacionados"},
                 {id:"order-history",label:"Histórico"},
               ]}/>
             <h3 id="order-scope" className="drawer-section-title">Escopo da operação</h3>
            <p className="description drawer-scope">
              {selected.description || "Escopo não informado."}
            </p>
            <div id="order-next" className="next-block">
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
                  <button
                    className={c.primary ? "primary" : "secondary"}
                    key={c.id}
                    disabled={saving || !!contextError}
                    onClick={() => command(c.id, selected)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            {contextError && (
              <p role="alert" className="form-error">
                {contextError}
              </p>
            )}
            <h3 id="order-commercial" className="drawer-section-title">Origem comercial</h3>
            {(selected.client_id ?? selected.relations?.clientId) && (
              <button
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
              </button>
            )}
            {(selected.contract_id ?? selected.relations?.contractId) && (
              <button
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
              </button>
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
                  <button
                    className="text-button"
                    onClick={() => setOrderRelation(null)}
                  >
                    Fechar contexto
                  </button>
                </header>
                {orderRelation.loading ? (
                  <p role="status">Consultando documento…</p>
                ) : orderRelation.error ? (
                  <div role="alert" className="form-error">
                    {orderRelation.error}
                    <button
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
                    </button>
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
                        <button
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
                        </button>
                      )}
                      {orderRelation.projection.purchaseOrderId && (
                        <button
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
                        </button>
                      )}
                    </>
                  )
                )}
              </section>
            )}
            {(selected.client_id ?? selected.relations?.clientId) && (
              <OrderNextcrmDocuments key={selected.id} orderId={selected.id} />
            )}
            <h3 id="order-related" className="drawer-section-title">Registros relacionados</h3>
            <button
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
            </button>
            {["Medições", "Faturamento", "Financeiro"].map((n) => (
              <button
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
              </button>
            ))}
            <details id="order-history" className="drawer-history">
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
              <button
                className="icon-button"
                aria-label="Fechar comando"
                onClick={() => setAction(null)}
              >
                <X size={22} />
              </button>
            </header>
            <p className="muted">
              {action.record.title} · {action.record.client}
            </p>
            <form onSubmit={execute}>
              {action.command === "measure" ? (
                <>
                  <label>
                    Descrição da produção
                    <textarea
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
                    <input
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
                    <input autoFocus type="date" name="dueDate" required />
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
                <button
                  type="button"
                  className="secondary"
                  disabled={saving}
                  onClick={() => setAction(null)}
                >
                  Voltar
                </button>
                <button
                  autoFocus={
                    action.command !== "measure" && action.command !== "invoice"
                  }
                  className="primary"
                  disabled={saving}
                >
                  {saving ? "Executando…" : "Confirmar comando"}
                </button>
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
              <button
                className="icon-button"
                aria-label="Fechar consulta"
                onClick={() => setSavingView(false)}
              >
                <X size={20} />
              </button>
            </header>
            <p className="muted">
              {savingViewFor === "serviceOrders.worklist"
                ? "Salve a busca, atividade e filtro atual para reutilizar na fila de ordens."
                : "Salve os filtros, contexto e ordenação desta fila para retomá-los depois."}
            </p>
            <form onSubmit={saveView}>
              <label>
                Nome da consulta
                <input
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
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setSavingView(false)}
                >
                  Cancelar
                </button>
                <button className="primary" disabled={saving}>
                  {saving ? "Salvando…" : "Salvar consulta"}
                </button>
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
            aria-describedby="cisne-palette-help"
            onKeyDown={handlePaletteKey}
            onClick={(e) => e.stopPropagation()}
          >
            <label className="search-input">
              <Search size={20} />
              <input
                autoFocus
                aria-label="Buscar ordens, clientes ou áreas"
                placeholder="Buscar ordens, clientes ou áreas…"
                value={paletteQuery}
                onChange={(e) => setPaletteQuery(e.target.value)}
              />
              <button
                className="icon-button"
                aria-label="Fechar busca"
                onClick={() => setPalette(false)}
              >
                <X size={18} />
              </button>
            </label>
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
                      <button
                        className="palette-result"
                        data-palette-option="true"
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
                      </button>
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
            <p>ÁREAS DO CISNE</p>
            {paletteModuleResults.map(([name, Icon]) => (
              <button type="button" data-palette-option="true" key={name} onClick={() => navigate(name)} aria-label={"Abrir módulo " + name}>
                <Icon size={18} aria-hidden="true" />
                {name}
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            ))}
            {paletteModuleResults.length === 0 && (
              <div className="palette-state" role="status">Nenhum módulo corresponde à busca.</div>
            )}
            <footer id="cisne-palette-help">
              <span>Setas para escolher · Enter para abrir · Esc para fechar. Busca por título da OS e cliente informado.</span>
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
