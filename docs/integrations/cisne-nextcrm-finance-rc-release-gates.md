# RC CISNE + NextCRM + Financeiro — sequência segura de homologação

**Escopo:** um único produto CISNE com os módulos de CRM nativo, Financeiro, Field/OS e documentação NextCRM. Para homologação, usar exclusivamente **dados fictícios**.

## Baseline observado em 16/11/2026

- Repositório ativo de staging: `rphllljust/teste`; serviço `cisne-web-staging`.
- Último deployment funcional verificado: `b7bac117b873bf2a322e745291d99138c997557d` (ficha e download documental).
- Tentativas da branch financeira `feature/finance-core-20261116` falharam em migração PostgreSQL com `42P07`; o commit financeiro `c3d86287814dc7ca9f8f7e4374a1b6ec022eb49b` permanece apenas **STAGED** no Railway.
- O trabalho de UI integrada e segurança foi empilhado e testado nos PRs #59, #61, #62, #63, #64 e #65. O PR #66 adiciona ensaio integral de upgrade documental→financeiro **contra o migrador real**, com fatos sintéticos preservados.
- Há backup PostgreSQL 18 restaurado em cluster independente, mas **a restauração não certifica a versão financeira unificada nem substitui um backup novo antes de qualquer DDL**.

## Invariantes de release — NO-GO imediato

1. Não aplicar patch `c3d862...` apenas para resolver pendência: sua linhagem SQL não foi reconciliada com a documental.
2. Não executar scripts que troquem os IDs do ledger automaticamente ou criem tabelas já existentes em caminho alternativo. O preflight #65 falha de forma explícita.
3. Não modificar, remover ou truncar `clients`, `service_orders`, `nextcrm_erp_*`, `nextcrm_order_document_*`, trilhas de auditoria, volumes Postgres ou objetos MinIO.
4. Não expor `nextcrm_document_id`, URLs de arquivo, bridge secret nem mapeamentos privados ao navegador.
5. Não usar `IF NOT EXISTS` como substituto para validação estrutural de colunas, constraints, índices, funções e triggers.
6. Não promover para produção sem revalidar o digest/commit, migrar no staging comprovadamente e executar UAT completo.

## Portão A — auditar o staging sem escrever

Executar `node scripts/audit-nextcrm-migration-ledger-readonly.mjs` (PR #64) **no PostgreSQL ERP**, utilizando conexão restrita, `BEGIN REPEATABLE READ READ ONLY` e sem imprimir `DATABASE_URL`, segredos ou IDs de clientes.

A expectativa, **a confirmar por evidência atual**, é `DOCUMENT_FIRST` (migração `0003_nextcrm_document_bridge`). Se ocorrer `FINANCE_FIRST`, `MIXED_OR_PARTIAL_HISTORY` ou ausência de objeto essencial, bloquear implantação até reconciliar o histórico em outro PR.

## Portão B — ensaio e rastreabilidade de migração

- CI dos PRs empilhados deve estar verde no HEAD exato.
- Execução de migrações repetidas em PostgreSQL 16 e 18.
- Ensaio do PR #66 deve começar com `0000` + `0001_native_crm` + `0002_crm_proposal_origin` + `0003_nextcrm_document_bridge`, cliente e OS fictícios, mapeamentos inativos, documento vinculado e evento imutável.
- O fixture de schema isolado normaliza somente referências históricas explícitas a `"public"` para o namespace descartável, pois o SQL Drizzle base contém FKs com schema fixo; **o migrador real da aplicação permanece inalterado**.
- Após o **migrador real**, ledger deve conter `0003_finance_audit`, `0004_cash_transfers`, `0005_finance_period_closes` exatamente uma vez, sem mudar o histórico documental nem os dados fictícios anteriores.
- Comprovar restore de backup independente e reversão de versão de aplicativo sem apagar novos dados; rollback SQL deve ser modelado, não presumido.

## Portão C — release candidate único

Após Portões A e B, fixar uma única branch/commit e comparar com os PRs base antes do merge serializado. O RC deve conter a UI de Fluxo de Caixa e a ficha documental NextCRM simultaneamente, além de rotas para contexto da OS, pagamentos, recebimentos, caixa, tesouraria e fechos.

Qualquer alteração automática no Railway só deve ocorrer **depois** de resolver o patch STAGED preexistente, revisar diffs do serviço e ter um plano de rollback para o deployment anterior.

## Portão D — UAT com dados fictícios

Cenários E2E obrigatórios:
- CRM → cliente → proposta → pedido/contrato → OS, validando owner scope e controle de versões.
- OS → anexo NextCRM → download privado → SHA-256, revogação de acesso e restauração de permissão em desktop e celular.
- Faturamento → título a receber → liquidação/reversão → fluxo de caixa e tesouraria; contabilidade e fechamento de período.
- Duplicidade de comando: `idempotency_key` repetida com mesmo corpo e corpo diferente, respectivamente replay sem duplicação e HTTP 409.
- Limites negativos: sessão expirada, owner diferente, documentos revogados, SHA incorreto, pagamento fora de período e conta inexistente.
- Confirmar que a saída pública documental não expõe ID upstream ou URL privada.

## Declaração de conclusão

Somente declarar **Financeiro + NextCRM + CISNE integrados** quando houver:
**(a)** commit exato, **(b)** deployment Railway SUCCESS no RC,
**(c)** migrações/ledger verificados no staging,
**(d)** backup-restauração válido,
**(e)** Playwright desktop/mobile concluído,
**(f)** integridade dos dados sintéticos e
**(g)** assinatura dos cenários financeiros ponta a ponta.

Sem qualquer item, informar o estado preciso: implementado, testado em CI, implantado ou homologado — nunca equipará-los.
