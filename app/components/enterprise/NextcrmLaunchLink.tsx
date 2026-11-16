"use client";

import { ExternalLink, Handshake } from "lucide-react";

type Props = {
  href: string;
  location: "sidebar" | "toolbar" | "commercial";
};

/**
 * Deliberately a cross-application navigation, not SSO or data exchange.
 * The caller receives an allowlisted, server-selected URL.
 */
export default function NextcrmLaunchLink({ href, location }: Props) {
  const classes = {
    sidebar: "crm-launch crm-launch-sidebar",
    toolbar: "crm-launch crm-launch-toolbar",
    commercial: "crm-launch crm-launch-commercial",
  };
  return (
    <a
      className={classes[location]}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Abrir CRM comercial em nova aba"
      title="Abre o NextCRM em outra aba; o acesso utiliza login separado"
    >
      <Handshake aria-hidden="true" size={17} />
      <span>CRM comercial</span>
      <ExternalLink aria-hidden="true" size={14} />
    </a>
  );
}
