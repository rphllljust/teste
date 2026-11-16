# Auditoria somente leitura — histórico Financeiro × NextCRM

## Objetivo

Determinar, sem alterar uma única linha empresarial ou da tabela de migrações, se o PostgreSQL do **ERP CISNE** já possui a estrutura documental NextCRM e qual dos dois históricos conhecidos foi aplicado.

Executar com o serviço **ERP** apontando para seu próprio PostgreSQL. Nunca utilizar a URL do banco separado do NextCRM.

## Execução controlada

O script é `scripts/audit-nextcrm-migration-ledger-readonly.mjs`.

1. Validar o alvo do `DATABASE_URL` por meio da configuração autorizada do Railway, sem imprimir o valor.
2. Preferir sessão ou job restrito de leitura, já com acesso à instância correta, e somente após ter um backup testado disponível.
3. Executar `node scripts/audit-nextcrm-migration-ledger-readonly.mjs`.
4. Recolher exclusivamente a linha `NEXTCRM_MIGRATION_READONLY_AUDIT` com estado e contagem de estruturas. Nunca divulgar segredo, URL, usuário do banco, dados de clientes ou arquivo.
5. O script abre explicitamente `BEGIN ... READ ONLY`, consulta catálogo, ledger e não emite SQL de INSERT/UPDATE/DELETE/DDL. Não faz reconciliação, não registra migrações e não faz backup/restauração.

## Estados possíveis

| Estado | Interpretação |
| --- | --- |
| `CATALOG_REVIEW_REQUIRED` + `DOCUMENT_FIRST` | A migração consolidada `0003_nextcrm_document_bridge` consta do ledger e os objetos essenciais estão presentes. Ainda exige conferência detalhada das definições e rollback. |
| `RECONCILIATION_REQUIRED` + `FINANCE_FIRST` | Os IDs financeiros `0001_nextcrm_order_document_links` e `0002_nextcrm_verified_mappings` constam do ledger, mas a migração consolidada não; pode faltar o índice de cliente/proprietário. Precisa de reconciliação aditiva versionada após backup. |
| `NO_GO` + `MIXED_OR_PARTIAL_HISTORY` | O ledger é parcial ou mistura ambos os caminhos. Não executar migrations automaticamente. |
| `NO_GO` + `NO_BRIDGE_MIGRATION` | Nenhum caminho foi registrado; investigar esquema e migrações antes de agir. |
| `NO_GO` + `missing` não vazio | Tabelas, colunas, índices, constraints, funções ou triggers essenciais ausentes. Não aplicar correção especulativa. |

O código **não** valida equivalência completa das expressões SQL, definições de índices/constraints nem integridade de dados. O status `CATALOG_REVIEW_REQUIRED` **não é GO de produção**.

## Critérios adicionais antes de reconciliar

- Confirmar identidade do banco ERP e revisar o ledger integral com acesso restrito, sem expor dados pessoais.
- Comparar definições efetivas de índices, checks, FKs e triggers e sua compatibilidade com o RC.
- Reproduzir ambos os caminhos em PostgreSQL descartável e provar rollback/restore.
- Fixar commit e digest do deploy que receberá o RC e verificar que o patch Railway de outra IA terminou, sem sobrescrevê-lo.
- Obter autorização de operação para qualquer DDL no staging; produção continua NO-GO.
- Testar de novo download NextCRM, idempotência, pagamentos, recebimentos e interface desktop/mobile após o RC completo.

## Histórico da execução

- PR #62: ensaio de duas histórias em schemas descartáveis, `ROLLBACK` completo.
- PR #63: Fluxo de Caixa e documentos NextCRM no mesmo CISNE.
- Este PR: diagnóstico somente leitura de ledger e estrutura, sem aplicar mudanças.
- Issue #60: decisão central de release e evidências.

**Não apagar dados fictícios, tabelas de links, histórico de auditoria ou volumes durante a reconciliação.**
