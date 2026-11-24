"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Plus, RefreshCw, Search, X } from "lucide-react";
import {
  EnterprisePageHeader,
  BusinessStatus,
} from "./components/enterprise/EnterprisePrimitives";
type Asset = {
  id: string;
  code: string;
  name: string;
  kind: string;
  location: string | null;
  responsible: string | null;
  hourlyCost: number | null;
  status: string;
  rowVersion: number;
};
type Context = Asset & {
  history: { command: string; createdAt: string }[];
  availableCommands: { id: string; label: string; expectedVersion: number }[];
};
type Tab = "summary" | "maintenance" | "history";
const labels: Record<string, string> = {
  vehicle: "Veículo",
  equipment: "Equipamento",
  asset: "Ativo",
};
const money = (v: number | null) =>
  v == null
    ? "Não informado"
    : new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(v / 100);
const statusLabel = (v: string) =>
  v === "active" ? "Ativo" : v === "maintenance" ? "Em manutenção" : "Inativo";
export default function AssetsWorkspace() {
  const [items, setItems] = useState<Asset[]>([]),
    [q, setQ] = useState(""),
    [kind, setKind] = useState(""),
    [status, setStatus] = useState(""),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [hasMore, setHasMore] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [context, setContext] = useState<Context | null>(null),
    [tab, setTab] = useState<Tab>("summary"),
    [form, setForm] = useState<Asset | true | false>(false),
    [saving, setSaving] = useState(false),
    [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(
        "/api/assets?" +
          new URLSearchParams({
            q,
            kind,
            status,
            page: String(page),
            pageSize: "25",
          }),
      );
      const d = (await r.json()) as {
        items: Asset[];
        pageInfo?: { total: number; hasMore: boolean };
        error?: string;
      };
      if (!r.ok) throw new Error(d.error);
      setItems(d.items);
      setTotal(d.pageInfo?.total ?? d.items.length);
      setHasMore(Boolean(d.pageInfo?.hasMore));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ativos indisponíveis.");
    } finally {
      setLoading(false);
    }
  }, [q, kind, status, page]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 150);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    const t = setTimeout(() => setPage(1), 0);
    return () => clearTimeout(t);
  }, [q, kind, status]);
  async function open(id: string) {
    try {
      const r = await fetch("/api/assets/" + id);
      const d = (await r.json()) as { asset: Context; error?: string };
      if (!r.ok) throw new Error(d.error);
      setTab("summary");
      setContext(d.asset);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Contexto indisponível.");
    }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    const f = new FormData(e.currentTarget);
    const data = {
      code: String(f.get("code")),
      name: String(f.get("name")),
      kind: String(f.get("kind")),
      location: String(f.get("location") || "").trim() || null,
      responsible: String(f.get("responsible") || "").trim() || null,
      hourlyCost: String(f.get("hourlyCost") || "").trim()
        ? Math.round(
            Number(String(f.get("hourlyCost")).replace(",", ".")) * 100,
          )
        : null,
    };
    try {
      const edit = form && form !== true ? form : null;
      const r = await fetch(
        edit ? "/api/assets/" + edit.id + "/commands" : "/api/assets",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            edit
              ? {
                  key: crypto.randomUUID(),
                  version: edit.rowVersion,
                  command: "revise",
                  data,
                }
              : { id: crypto.randomUUID(), data },
          ),
        },
      );
      const d = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(d.error);
      setForm(false);
      await load();
      if (edit) await open(edit.id);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }
  async function command() {
    if (!context || saving) return;
    const c = context.availableCommands.find(
      (item) =>
        item.id === "start_maintenance" ||
        item.id === "finish_maintenance" ||
        item.id === "activate",
    );
    if (!c) {
      setMessage("Nenhuma transição autorizada para este ativo.");
      return;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/assets/" + context.id + "/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: crypto.randomUUID(),
          version: c.expectedVersion,
          command: c.id,
        }),
      });
      const d = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(d.error);
      await open(context.id);
      await load();
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Não foi possível alterar o estado.",
      );
    } finally {
      setSaving(false);
    }
  }
  const nextCommand = context?.availableCommands.find(
    (item) => item.id !== "revise",
  );
  return (
    <section
      className="worklist business-workspace"
      aria-label="Frota e ativos"
    >
    <EnterprisePageHeader breadcrumb="Recursos e logística / Frota e ativos" eyebrow="LIST REPORT · RECURSOS" title="Frota e ativos" description="Cadastro, disponibilidade, localização e custo operacional dos recursos utilizados pelo Field Service." actions={<><button className="secondary" disabled={loading} onClick={() => void load()}><RefreshCw size={16} />Atualizar</button><button className="primary" onClick={() => setForm(true)}><Plus size={16} />Cadastrar ativo</button></>} />
      <div className="assets-filter-row">
      <div className="filters">
        <label className="search-input">
          <Search size={16} />
          <input
            aria-label="Buscar ativos"
            placeholder="Código, nome, localização ou responsável"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <select
          className="select-filter"
          aria-label="Tipo"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="">Todos os tipos</option>
          <option value="vehicle">Veículos</option>
          <option value="equipment">Equipamentos</option>
          <option value="asset">Ativos</option>
        </select>
        <select
          className="select-filter"
          aria-label="Situação"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Todas as situações</option>
          <option value="active">Ativos</option>
          <option value="maintenance">Em manutenção</option>
          <option value="inactive">Inativos</option>
        </select>
      </div>
 
     {loading ? (
        <div className="empty" role="status">
          Consultando ativos…
        </div>
      ) : error ? (
        <div className="empty" role="alert">
          <p>{error}</p>
          <button className="secondary" onClick={() => void load()}>
            Tentar novamente
          </button>
        </div>
      ) : items.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Ativo</th>
                <th>Tipo</th>
                <th>Localização</th>
                <th>Responsável</th>
                <th>Custo/hora</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id}>
                  <td>
                    <button
                      className="row-link"
                      onClick={() => void open(a.id)}
                    >
                      {a.name}
                    </button>
                    <small>{a.code}</small>
                  </td>
                  <td>{labels[a.kind] ?? a.kind}</td>
                  <td>{a.location ?? "Não informado"}</td>
                  <td>{a.responsible ?? "Não informado"}</td>
                  <td>{money(a.hourlyCost)}</td>
                  <td>
                    <span className="badge">{statusLabel(a.status)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">
          <h3>Nenhum ativo cadastrado</h3>
          <p>
            Cadastre veículos, equipamentos e demais recursos antes de alocá-los
            a uma OS.
          </p>
          <button className="primary" onClick={() => setForm(true)}>
            <Plus size={16} />
            Cadastrar ativo
          </button>
        </div>
      )}
      <footer className="table-footer">
        <span>
          {items.length} de {total} registros · página {page}
        </span>
        <span>Dados persistidos · comandos autorizados no servidor</span>
        <div className="command-buttons">
          <button
            className="secondary"
            disabled={page === 1 || loading}
            onClick={() => setPage((v) => Math.max(1, v - 1))}
          >
            Anterior
          </button>
          <button
            className="secondary"
            disabled={!hasMore || loading}
            onClick={() => setPage((v) => v + 1)}
          >
            Próxima
          </button>
        </div>
      </footer>
      {context && (
        <div className="overlay">
          <aside
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Object Page do ativo"
          >
            <header>
              <span className="eyebrow">
                OBJECT PAGE · {labels[context.kind] ?? "ATIVO"}
              </span>
              <button
                className="icon-button"
                aria-label="Fechar"
                onClick={() => setContext(null)}
              >
                <X size={20} />
              </button>
            </header>
            <BusinessStatus status={context.status === "active" ? "approved" : context.status === "maintenance" ? "warning" : "blocked"} label={statusLabel(context.status)} />
            <h2>{context.name}</h2>
            <p className="muted">Código {context.code}</p>
            <nav className="tabs" aria-label="Seções do ativo">
              {(
                [
                  ["summary", "Resumo"],
                  ["maintenance", "Manutenção"],
                  ["history", "Histórico"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  className={tab === id ? "selected" : ""}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </nav>
            {tab === "summary" && (
              <dl>
                <div>
                  <dt>Localização</dt>
                  <dd>{context.location ?? "Não informado"}</dd>
                </div>
                <div>
                  <dt>Responsável</dt>
                  <dd>{context.responsible ?? "Não informado"}</dd>
                </div>
                <div>
                  <dt>Custo operacional</dt>
                  <dd>{money(context.hourlyCost)}</dd>
                </div>
              </dl>
            )}
            {tab === "maintenance" && (
              <section className="drawer-section">
                <h3>Operação de manutenção</h3>
                <p>
                  {context.status === "maintenance"
                    ? "O ativo está indisponível para novas alocações enquanto a manutenção estiver aberta."
                    : "Nenhuma manutenção aberta registrada."}
                </p>
                <button
                  className="secondary"
                  disabled={saving || !nextCommand}
                  onClick={() => void command()}
                >
                  {nextCommand?.label ?? "Sem ação autorizada"}
                </button>
              </section>
            )}
            {tab === "history" && (
              <section className="drawer-section">
                <h3>Histórico auditável</h3>
                {context.history.length ? (
                  context.history.map((h, i) => (
                    <div className="event-row" key={i}>
                      <span>
                        {h.command === "register"
                          ? "Cadastro registrado"
                          : h.command === "revise"
                            ? "Cadastro atualizado"
                            : h.command === "start_maintenance"
                              ? "Enviado para manutenção"
                              : h.command === "finish_maintenance"
                                ? "Manutenção concluída"
                                : "Ativo ativado"}
                      </span>
                      <small>
                        {new Intl.DateTimeFormat("pt-BR", {
                          dateStyle: "short",
                          timeStyle: "short",
                        }).format(new Date(h.createdAt))}
                      </small>
                    </div>
                  ))
                ) : (
                  <p className="muted">Nenhum evento disponível.</p>
                )}
              </section>
            )}
            <div className="command-buttons">
              <button className="secondary" onClick={() => setForm(context)}>
                Editar cadastro
              </button>
            </div>
            {message && (
              <p className="form-error" role="alert">
                {message}
              </p>
            )}
          </aside>
        </div>
      )}
      {form !== false && (
        <div className="overlay modal-overlay">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Cadastro de ativo"
          >
            <header>
              <h2>{form === true ? "Cadastrar ativo" : "Editar ativo"}</h2>
              <button
                className="icon-button"
                onClick={() => setForm(false)}
                aria-label="Fechar"
              >
                <X size={20} />
              </button>
            </header>
            <form onSubmit={save}>
              <label>
                Código
                <input
                  name="code"
                  required
                  maxLength={60}
                  defaultValue={form !== true ? form.code : ""}
                />
              </label>
              <label>
                Nome / descrição
                <input
                  name="name"
                  required
                  minLength={2}
                  maxLength={160}
                  defaultValue={form !== true ? form.name : ""}
                />
              </label>
              <label>
                Tipo
                <select
                  name="kind"
                  defaultValue={form !== true ? form.kind : "asset"}
                >
                  <option value="vehicle">Veículo</option>
                  <option value="equipment">Equipamento</option>
                  <option value="asset">Ativo</option>
                </select>
              </label>
              <label>
                Localização
                <input
                  name="location"
                  maxLength={160}
                  defaultValue={form !== true ? (form.location ?? "") : ""}
                />
              </label>
              <label>
                Responsável
                <input
                  name="responsible"
                  maxLength={160}
                  defaultValue={form !== true ? (form.responsible ?? "") : ""}
                />
              </label>
              <label>
                Custo/hora (R$)
                <input
                  name="hourlyCost"
                  inputMode="decimal"
                  defaultValue={
                    form !== true && form.hourlyCost != null
                      ? (form.hourlyCost / 100).toFixed(2).replace(".", ",")
                      : ""
                  }
                />
              </label>
              {message && (
                <p className="form-error" role="alert">
                  {message}
                </p>
              )}
              <footer>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setForm(false)}
                >
                  Cancelar
                </button>
                <button className="primary" disabled={saving}>
                  {saving ? "Salvando…" : "Salvar ativo"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
