import type { ReactNode } from "react";

type EnterpriseDataStateProps = {
  kind: "empty" | "error" | "blocked" | "manual" | "not-configured" | "unavailable";
  title: string;
  description: string;
  action?: ReactNode;
};

const labels: Record<EnterpriseDataStateProps["kind"], string> = {
  empty: "SEM REGISTROS",
  error: "ERRO DE CONSULTA",
  blocked: "BLOQUEADO",
  manual: "PROCESSO MANUAL",
  "not-configured": "NÃO CONFIGURADO",
  unavailable: "INDISPONÍVEL",
};

export function EnterpriseDataState({ kind, title, description, action }: EnterpriseDataStateProps) {
  return (
    <section className={`enterprise-data-state enterprise-data-state-${kind}`} role={kind === "error" ? "alert" : "status"} aria-label={labels[kind]}>
      <span className="enterprise-data-state-label">{labels[kind]}</span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </section>
  );
}
