# Evidência operacional — PostgreSQL REAL em Railway staging — 15/11/2026

## Identidade e escopo

- Repositório ERP: `rphllljust/teste`.
- Projeto Railway: `genuine-renewal`.
- Ambiente auditado: `staging` (`c241a855-68b7-4d75-a722-b6a42c8581e9`).
- Serviço PostgreSQL: `Postgres` (`97a0bf53-ddb8-4bc4-8503-a6e531c90a27`); versão de imagem configurada: PostgreSQL 18.
- Serviço auditor temporário: `cisne-pg-readonly-audit` (`08a9d225-cdee-454b-9196-f1fd0a974c1d`).
- Deploy do auditor: `451766bc-7b83-4ad3-9403-cbd1b794ca79`, status `SUCCESS`.
- Script versionado e aprovado em CI: [`scripts/audit-postgres-staging-readonly.sql`](../../scripts/audit-postgres-staging-readonly.sql), commit `3a1bb38a452da852c37a3a18fa28f68e60457931`.
- Execução autorizada pelo usuário para staging somente. Sem domínio público, sem proxy TCP, sem volumes do auditor; sem acesso a production.

## Resultado real, confirmado em logs do PostgreSQL staging

A consulta foi executada por `psql` no container de auditoria efêmero, com `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY` e `PGOPTIONS` somente de leitura.

```text
READ_ONLY|session|on
TABLES_PRESENT|public|36
MIGRATIONS_TABLE|public|PRESENT
FOREIGN_KEYS|public|36
```

**As 36 tabelas de domínio previstas retornaram `COUNT(*) = 0`:**

| Domínio | Tabelas | Registros |
|---|---|---:|
| Bancário e contabilidade | bank_reconciliation_events, bank_statement_lines, bank_statements, chart_accounts, journal_entries, journal_lines | 0 |
| Pessoas e vínculos | clients, contracts, suppliers | 0 |
| OS e execução | service_orders, order_events, execution_entries, measurements | 0 |
| Estoque | inventory_items, inventory_movements | 0 |
| Faturamento e financeiro | invoices, payables, payable_payments, receivables, receivable_settlements | 0 |
| Compras e propostas | procurement_commands, procurement_receipts, procurement_receipt_lines, proposals, proposal_lines, purchase_orders, supplier_purchase_orders, supplier_purchase_order_lines | 0 |
| Planejamento e fechamento | mrp_runs, mrp_events, mrp_recommendations, period_close_runs, period_close_check_results | 0 |
| Comandos e personalização | business_commands, saved_view_commands, saved_views | 0 |

A auditoria contou **36 tabelas, 36 chaves estrangeiras e nenhum registro de domínio**. A tabela de controle de migração está presente, mas esta consulta não leu seus registros internos. Portanto, *estrutura existente* não significa migração de dados executada.

**Limite da evidência:** a auditoria cobre as 36 tabelas `public` esperadas pelo esquema PostgreSQL. Não é uma varredura de outras bases, schemas, bancos Cloudflare ou sistemas externos. Não permite concluir que esses outros sistemas não possuem dados.

## Isolamento e limpeza

- A execução retornou `COMMIT` em transação somente de leitura; nenhum `INSERT/UPDATE/DELETE`/DDL foi executado pelo auditor.
- O serviço auditor foi **excluído** após coleta das evidências, com `detachedVolumes=[]`.
- Verificação posterior: staging contém somente os serviços originais `Postgres` e `cisne-web-staging`; ambos com deployment `SUCCESS`, volume `postgres-volume` preservado.
- Verificação posterior: `genuine-renewal/production` mantém serviço `teste` na branch `main`, com deployment `SUCCESS`, sem alterações pendentes.
- Não foi criado proxy público para o PostgreSQL, não foram exportadas linhas de usuários/empresas e nenhuma credencial aparece neste documento.

## Veredito da engenharia

**PASSOU:** PostgreSQL staging está acessível pela rede interna, possui as 36 tabelas esperadas, 36 constraints FK, tabela de migrações e permite auditoria SQL somente leitura. O procedimento passou em CI e foi confirmado no ambiente real.

**NÃO PASSOU / NÃO VERIFICADO:** migração de dados empresariais. Todas as tabelas empresariais auditadas estão vazias. **Não há comprovação de carga de clientes, contratos, OS, estoque ou financeiro.**

**NO-GO:** excluir banco D1 original, desativar fonte de dados antiga, cortar produção, fazer merge que implique deploy não autorizado ou declarar paridade dos dados.

## Próximos passos com acesso disponível

1. Determinar uma origem *autorizada* dos dados empresariais: export D1 feito por responsável da conta, backup, arquivos estruturados ou outro banco comprovado. O usuário informou que não tem acesso à Cloudflare; não requerer sua senha.
2. Se não houver fonte de dados, distinguir *implantação nova/vazia* de *migração histórica*; não criar dados artificiais em ambiente operacional para encobrir ausência.
3. Fazer importação com transformações SQLite→PostgreSQL, transações, versionamento, consistência, ensaio em staging e autorização específica.
4. Repetir auditoria de contagens e fingerprints com dados reais e executar UAT empresarial autenticado antes do cutover.

**Este relatório não constitui autorização de migração/escrita em staging nem de exclusão do D1.**
