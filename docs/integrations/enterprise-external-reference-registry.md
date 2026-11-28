# Registro e revisão de referências empresariais externas

Esta frente cria uma âncora auditável para referências externas ligadas a tenants e entidades legais. A referência nunca é tratada como comprovante validado apenas porque uma URL foi informada.

## Registro e revisão

- `POST /api/enterprise/tenants/:tenantId/external-references` registra uma referência com CNPJ de 14 dígitos, fonte e identificador externo.
- O estado inicial é `pending_review`.
- `POST /api/enterprise/tenants/:tenantId/external-references/:referenceId/commands` aceita `verify` ou `reject`, com versão esperada, command key, autor e nota opcional.
- Somente owner, admin ou auditor ativo no tenant pode revisar.
- Revisão é transacional, versionada, idempotente e registrada em eventos imutáveis de auditoria.
- Referências de objetos transacionais exigem uma entidade legal ativa do mesmo tenant.

## Cadastro fornecido

O usuário informou a referência `11897171000181`, o nome `Abrahim Jabour Junior` e a URL do CNPJ.biz. Esses dados devem ser registrados em `pending_review` e conferidos por um membro autorizado. Não se presume que o responsável seja a própria pessoa que opera o ERP nem que a empresa pertença ao tenant atual.

## Limites do escopo

Esta etapa fornece a revisão administrativa e a âncora externa. As transações de CRM, contratos, OS, faturamento e contabilidade seguem seus comandos nativos com permissões próprias. O fiscal continua sem transmissão automática.
