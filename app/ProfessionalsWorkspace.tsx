"use client";
import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw, Search, X } from "lucide-react";
import {
  EnterprisePageHeader,
  BusinessStatus,
} from "./components/enterprise/EnterprisePrimitives";
type Professional = {
  id: string;
  name: string;
  registration: string;
  specialty: string;
  department: string;
  phone: string | null;
  hourlyCost: number | null;
  status: "active" | "inactive";
  rowVersion: number;
};
type Context = Professional & {
  history: { command: string; createdAt: string }[];
  availableCommands: { id: string; label: string; expectedVersion: number }[];
};
const money = (c: number | null) =>
  c == null
    ? "Não informado"
    : new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(c / 100);
export default function ProfessionalsWorkspace() {
  const [items, setItems] = useState<Professional[]>([]),
    [q, setQ] = useState(""),
    [status, setStatus] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [context, setContext] = useState<Context | null>(null),
    [form, setForm] = useState<Professional | true | false>(false),
    [saving, setSaving] = useState(false),
    [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch(
        "/api/professionals?" +
          new URLSearchParams({ q, status, page: "1", pageSize: "50" }),
      );
      const d = (await r.json()) as { items: Professional[]; error?: string };
      if (!r.ok) throw new Error(d.error);
      setItems(d.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Profissionais indisponíveis.");
    } finally {
      setLoading(false);
    }
  }, [q, status]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 150);
    return () => clearTimeout(t);
  }, [load]);
  async function open(id: string) {
    try {
      const r = await fetch("/api/professionals/" + id);
      const d = (await r.json()) as { professional: Context; error?: string };
      if (!r.ok) throw new Error(d.error);
      setContext(d.professional);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Contexto indisponível.");
    }
  }
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setMessage("");
    const f = new FormData(e.currentTarget);
    const data = {
      name: String(f.get("name")),
      registration: String(f.get("registration")),
      specialty: String(f.get("specialty")),
      department: String(f.get("department")),
      phone: String(f.get("phone") || "").trim() || null,
      hourlyCost: String(f.get("hourlyCost") || "").trim()
        ? Math.round(
            Number(String(f.get("hourlyCost")).replace(",", ".")) * 100,
          )
        : null,
    };
    try {
      const editing = form && form !== true ? form : null;
      const r = await fetch(
        editing
          ? "/api/professionals/" + editing.id + "/commands"
          : "/api/professionals",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            editing
              ? {
                  key: crypto.randomUUID(),
                  version: editing.rowVersion,
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
      if (editing) await open(editing.id);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }
  async function toggle() {
    if (!context || saving) return;
    setSaving(true);
    setMessage("");
    const c = context.availableCommands[0];
    try {
      const r = await fetch("/api/professionals/" + context.id + "/commands", {
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
  return (
    <section className="worklist business-workspace" aria-label="Profissionais">
    <header className="list-title">
        <div>
          <span className="eyebrow">RECURSOS · CADASTRO MESTRE</span>
          <h2>Profissionais</h2>
          <p>
            Pessoas autorizadas para alocação e apontamentos de execução. Cada
            registro pertence ao contexto empresarial atual.
          </p>
        </div>
        <div className="command-buttons">
          <button
            className="secondary"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw size={16} />
            Atualizar
          </button>
          <button className="primary" onClick={() => setForm(true)}>
            <Plus size={16} />
            Cadastrar profissional
          </button>
        </div>
      </header>
      <div className="filters">
        <label className="search-input">
          <Search size={16} />
          <input
            aria-label="Buscar profissionais"
            placeholder="Nome, matrícula, especialidade ou departamento"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <select
          className="select-filter"
          aria-label="Situação"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Todas as situações</option>
          <option value="active">Ativos</option>
          <option value="inactive">Inativos</option>
        </select>
      </div>
      {loading ? (
        <div className="empty" role="status">
          Consultando profissionais…
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
                <th>Profissional</th>
                <th>Matrícula</th>
                <th>Especialidade</th>
                <th>Departamento</th>
                <th>Custo/hora</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <button
                      className="row-link"
                      onClick={() => void open(p.id)}
                    >
                      {p.name}
                    </button>
                    <small>{p.phone ?? "Telefone não informado"}</small>
                  </td>
                  <td>{p.registration}</td>
                  <td>{p.specialty}</td>
                  <td>{p.department}</td>
                  <td>{money(p.hourlyCost)}</td>
                  <td>
                    <span className={"badge status-" + p.status}>
                      {p.status === "active" ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">
          <h3>Nenhum profissional cadastrado</h3>
          <p>Cadastre a primeira pessoa autorizada para execução.</p>
          <button className="primary" onClick={() => setForm(true)}>
            <Plus size={16} />
            Cadastrar profissional
          </button>
        </div>
      )}
      <footer className="table-footer">
        <span>{items.length} profissionais na consulta</span>
        <span>Dados persistidos · controle por empresa</span>
      </footer>
      {context && (
        <div className="overlay">
          <aside
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Object Page do profissional"
          >
            <header>
              <span className="eyebrow">OBJECT PAGE · PROFISSIONAL</span>
              <button
                className="icon-button"
                aria-label="Fechar"
                onClick={() => setContext(null)}
              >
                <X size={20} />
              </button>
            </header>
            <BusinessStatus status={context.status === "active" ? "approved" : "blocked"} label={context.status === "active" ? "Ativo" : "Inativo"} />
            <h2>{context.name}</h2>
            <p className="muted">Matrícula {context.registration}</p>
            <nav className="tabs" aria-label="Seções do profissional">
              <button className="selected">Resumo</button>
              <button>Alocações</button>
              <button>Histórico</button>
            </nav>
            <dl>
              <div>
                <dt>Especialidade</dt>
                <dd>{context.specialty}</dd>
              </div>
              <div>
                <dt>Departamento</dt>
                <dd>{context.department}</dd>
              </div>
              <div>
                <dt>Telefone</dt>
                <dd>{context.phone ?? "Não informado"}</dd>
              </div>
              <div>
                <dt>Custo operacional</dt>
                <dd>{money(context.hourlyCost)}</dd>
              </div>
            </dl>
            <div className="command-buttons">
              <button
                className="secondary"
                disabled={saving}
                onClick={() => setForm(context)}
              >
                Editar cadastro
              </button>
              <button
                className="secondary"
                disabled={saving}
                onClick={() => void toggle()}
              >
                {context.availableCommands[0]?.label}
              </button>
            </div>
            <h3 className="drawer-section-title">Histórico auditável</h3>
            {context.history.length ? (
              context.history.map((h, i) => (
                <div className="event-row" key={i}>
                  <span>
                    {h.command === "register"
                      ? "Cadastro registrado"
                      : h.command === "revise"
                        ? "Cadastro atualizado"
                        : h.command === "activate"
                          ? "Profissional ativado"
                          : "Profissional desativado"}
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
          </aside>
        </div>
      )}
      {form !== false && (
        <div className="overlay modal-overlay">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Cadastro de profissional"
          >
            <header>
              <h2>
                {form === true
                  ? "Cadastrar profissional"
                  : "Editar profissional"}
              </h2>
              <button
                className="icon-button"
                disabled={saving}
                aria-label="Fechar"
                onClick={() => setForm(false)}
              >
                <X size={20} />
              </button>
            </header>
            <form onSubmit={save}>
              <label>
                Nome completo
                <input
                  name="name"
                  required
                  minLength={2}
                  maxLength={160}
                  defaultValue={form !== true ? form.name : ""}
                />
              </label>
              <label>
                Matrícula
                <input
                  name="registration"
                  required
                  maxLength={80}
                  defaultValue={form !== true ? form.registration : ""}
                />
              </label>
              <label>
                Especialidade
                <input
                  name="specialty"
                  required
                  minLength={2}
                  maxLength={120}
                  defaultValue={form !== true ? form.specialty : ""}
                />
              </label>
              <label>
                Departamento
                <input
                  name="department"
                  required
                  minLength={2}
                  maxLength={120}
                  defaultValue={form !== true ? form.department : ""}
                />
              </label>
              <label>
                Telefone
                <input
                  name="phone"
                  maxLength={40}
                  defaultValue={form !== true ? (form.phone ?? "") : ""}
                />
              </label>
              <label>
                Custo/hora (R$)
                <input
                  name="hourlyCost"
                  inputMode="decimal"
                  placeholder="Opcional"
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
                  disabled={saving}
                  onClick={() => setForm(false)}
                >
                  Cancelar
                </button>
                <button className="primary" disabled={saving}>
                  {saving ? "Salvando…" : "Salvar profissional"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
