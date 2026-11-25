# CISNE — Arquitetura-alvo ERP Tier 1 vertical (ADR-001)
Data de referência: 2026-11-25
Status: PROPOSTA IMPLEMENTÁVEL. Documento normativo de engenharia; não equivale a homologação ou alteração em produção.
Código-base de partida: `rphllljust/teste`, commit `ce152986ae6808b1c90456f582e52e0a2a58c255`.

## 1. Invariantes obrigatórias

1. O ERP nativo é a fonte da verdade para empresas, clientes, propostas, contratos, OS, medições, compras, estoque, faturamento, contas, contabilização e fiscal manual; integrações externas nunca são pré-requisito silencioso para comandos internos.
2. Toda mutação empresarial preserva `tenant_id`, empresa/filial, ator autenticado, `idempotency_key`, `correlation_id`, origem, versão otimista, registro temporal e evento de auditoria imutável. Não aceitar `tenant_id` informado livremente no corpo HTTP.
3. API, banco e políticas de UI aplicam a mesma autorização; exibir menos botões não substitui autorização na API. Negar por padrão; usuários de outra empresa recebem resposta sem revelar existência de registros.
4. Valores monetários usam inteiro de escala documentada (ou decimal PostgreSQL explícito), nunca `float`; partidas contábeis têm soma de débitos igual à soma de créditos e nenhuma linha é simultaneamente débito/crédito.
5. Não permitir contabilização, baixa, estorno ou mutação retroativa em competência fechada sem processo de reabertura autorizado e auditável.
6. Nenhum pipeline publica em produção sem prova do commit/digest exato, testes de PostgreSQL, restauração, autorização empresarial, UAT autenticado e rollback ensaiado.
7. Fiscal permanece **interno/manual**, sem declaração de autorização SEFAZ, transmissão ou emissão externa. OFBiz não é requisito para compras nativas.

## 2. Contextos delimitados

| Contexto | Dono dos dados e operações | Contratos síncronos | Eventos de integração internos |
|---|---|---|---|
| Identidade e organização | grupo, tenant, empresa, filial, membros, RBAC/ABAC, delegação | contextos e permissões | membership.changed |
| Comercial | lead, oportunidade, cliente, proposta e revisão | proposta aprovada | proposal.approved |
| Contratos e ordens | contrato, versões, OS, cronograma e aceite | OS autorizada | order.authorized, order.completed |
| Execução e medições | recursos, evidências, medições, submissão e aprovação | medição aprovada | measurement.approved, measurement.cancelled |
| Compras e suprimentos | fornecedor, solicitação, pedido, recebimento, estoque, MRP | recebimento valorizado | purchase.received, stock.moved |
| Financeiro | títulos, recebimentos, pagamentos, bancos, tesouraria e períodos | baixa/estorno com lock | receivable.settled, payable.paid |
| Contabilidade | plano de contas, regra de lançamento, diário, razão, conciliação | publicação atômica | journal.posted, journal.reversed |
| Fiscal manual | documento declarado, competência, origem e histórico | registro/cancelamento manual | fiscal.recorded |
| Frotas e locações | frota, disponibilidade, reservas, manutenção, viagens, contratos de locação | alocação/consumo | asset.allocated, transport.completed |
| Auditoria e relatórios | eventos e projeções reconciliáveis, trilhas de segurança | projeções e exportações | projection.updated |

Arquitetura inicial: **monólito modular bem delimitado**, PostgreSQL como fonte transacional, APIs tipadas e módulos de domínio com dependência dirigida. Não decompor em microserviços antes de medir contenção, latência, segurança, equipes e custo de operação. Separar módulos por domínio de negócio, não por tela ou por controller.

## 3. Multiempresa — migração expand/contract

### Etapa A: identificação de organização (sem trocar comportamento existente)
Criar `tenants`, `legal_entities`, `establishments`, `users`, `memberships`, `roles`, `permissions`, `role_grants` e `permission_audit_events`, com chaves e índices únicos contextuais. Disponibilizar `RequestContext` autenticado de `actorId`, `tenantId`, `legalEntityId`, `roles`, `permissions` e `correlationId`; identidade e tenant derivam de sessão verificada, nunca de header arbitrário. Implementar negação por padrão inclusive em jobs.

### Etapa B: dados legados, sem perda
Preservar `owner_id` e acrescentar colunas opcionais `tenant_id` e `legal_entity_id` às tabelas transacionais em migrações *aditivas*. Determinar a associação única e verificada de cada registro, registrar registros órfãos e divergentes em inventário privado. Backfill idempotente em lotes com checkpoints; dados sem vínculo inequívoco permanecem congelados para revisão, não atribuídos a empresa fictícia.

### Etapa C: isolamento comprovado
Exigir associação de empresa em cada query de negócio; complementar com PostgreSQL Row-Level Security testado em sessões de banco distintas. Testar bypass por ID, vínculo cruzado de FK, anexos, relatórios e filas. Executar testes A/B com usuários diferentes e permissões diferentes, além de tentativas concorrentes.

### Etapa D: fechamento de contrato
Com backups/restauração e paridade comprovados, tornar `tenant_id` NOT NULL, criar índices compostos/constraints de integridade contextual, remover consultas legadas que dependam só de `owner_id` e aposentar somente depois o caminho anterior. A ordem é expandir → preencher → observar → reforçar, nunca migrar em um único deploy destrutivo.

## 4. Ledger contábil e vínculos transacionais

Criar contrato explícito `source_type` + `source_id` + `source_version` + `tenant_id` + `accounting_rule_version` + `journal_id` + `posting_status`, com unicidade por tipo/versão/operação e FK validada quando possível. O texto `source_reference` existente continua apenas informativo, não é um relacionamento empresarial. Eventos de origem ficam em outbox transacional para as projeções assíncronas; lançamento contábil somente é marcado publicado ao completar uma operação auditável e idempotente.

Impedir dupla apropriação por retry, concorrência, replay e reversão duplicada. Para cada cadeia `OS→medição→fatura→recebível→baixa→contabilização`, conciliar quantidade, valor, competência, empresa, ator, versões e saldo; usar compensação contábil em vez de apagar lançamentos. Separar evento de origem, regra de lançamento, diário e projeção de razão. A implementação deverá considerar competência, contas de contrapartida, impostos internos e diferenças de classificação.

## 5. Segurança, resiliência e operação

- Permissões de menor privilégio por entidade/estado/comando, dupla aprovação em decisões sensíveis, política SoD declarativa e trilha de quem solicitou/aprovou.
- Cada comando mutável executado em transação PostgreSQL com travas necessárias, controle de versão, chave idempotente e receipt durável. Tarefa externa usar padrão outbox/inbox e `at least once` com consumidores idempotentes.
- Backups automáticos e restauráveis, ensaio de restore com dados sintéticos e evidência privada para base real, RPO/RTO aprovados pelo negócio, procedimento de rollback, migração testada em PostgreSQL 16/18.
- Observabilidade por `correlationId` em API, filas e navegador; métricas P95/P99, taxa de erros, locks, deadlocks, saturação do pool, jobs, fila/outbox, deploys e tentativas negadas. Alertas direcionados ao plantão.
- Segredos somente no gestor do Railway; impedir logs e URLs de arquivo expostos; endurecer autenticação de staging/produção, TLS, cookies, limites de requisição e exportações de dados.
- Testes de acessibilidade WCAG e responsividade reais em 390/768/1024/1440px usando Playwright autenticado: criação, navegação profunda, operações, telas com dados vazios e grandes, teclado, foco e feedback.

## 6. Deployment e gates

| Gate | Prova exigida | NO-GO |
|---|---|---|
| G0 origem | HEAD `main`/PR, migrations, dependency pin, lockfile | SHA distinto ou drift |
| G1 código | TypeScript, ESLint, Knip classificado, build, unit/contract | regressão ou exclusão de código em uso |
| G2 persistência | PostgreSQL 16/18, migrations repetidas, handlers reais e ownership | erro, divergência ou fixture não restaurável |
| G3 processos | CRM→contrato→OS→medição→fatura→recebível→razão e compras→estoque→pagar | vínculo/valores inconsistentes |
| G4 navegador | Playwright autenticado no Railway staging e 3 form factors | falha ou cenário crítico não testado |
| G5 recuperação | backup atual, restore real de prova, verificação ledger e rollback | sem evidência |
| G6 produção | digest exato, health, smoke, observabilidade, aceite e rollback | versão diferente ou UAT ausente |

No Railway `genuine-renewal`, o serviço `cisne-web-staging` acompanha `main`, enquanto `teste` em production estava fixado no SHA antigo `4d8ea2b...` em 25/11/2026. Não interpretar `SUCCESS` de build como UAT; não ligar produção automaticamente à branch móvel enquanto os gates G3–G6 forem pendentes. A presença de um container PostgreSQL em staging não certifica migração de dados históricos D1 nem backup de produção.

## 7. Plano de execução paralela com independência por arquivo

- **Frente A: isolamento financeiro:** corrigir liquidações/estornos para exigir dono por JOIN e cobertura de ator adversário no PostgreSQL (sem nova migration).
- **Frente B: integridade contábil:** aceitar linha com uma só natureza contábil; bloquear lançamentos e estornos em competência fechada; testes reais (sem nova migration).
- **Frente C: gates de release:** habilitar PostgreSQL-only e fullstack na `main`; não permitir produção pelo mero merge.
- **Frente D: fundação tenant + ledger:** iniciar a partir desta ADR, em próximas PRs com migrations expand/contract e contratos testados antes de telas.
- **Frente E: Field/recursos e browser:** jornada OS/medição/estoque/custos; Playwright autenticado e evidência no staging.

Após cada PR: validar no HEAD exato, resolver conflito, merge serializado, verificar o deploy automático de staging e sua correspondência de SHA; registrar implementado, testado, integrado, implantado e homologado como estados distintos. Nenhuma PR isolada autoriza declarar ERP Tier 1 concluído.
