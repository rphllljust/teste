# Remoção segura do Cloudflare D1 — migração exclusiva para PostgreSQL

## Escopo do PR
- Branch de origem: `codex/staging-private-workspace-guard-20261115` (PR #15, ainda não mesclado).
- Esta mudança é um **PR encadeado** e não deve ser mesclada à `main` antes de validar/conciliar o PR #15.
- O `db/raw.ts` usa `pg`, transações PostgreSQL e `DATABASE_URL`; `db/index.ts` usa `drizzle-orm/node-postgres`.
- A configuração de build não cria `d1_databases`; `cloudflare-env.d.ts` não declara `D1Database`; `.openai/hosting.json` deixa de vincular `DB` ao D1.
- `db/schema.ts` utiliza `pgTable`; `drizzle.config.ts` já seleciona `postgresql`.
- Os arquivos históricos SQL em `drizzle/` não são executados pelo migrador PostgreSQL; conservados apenas para rastreabilidade. O caminho ativo é `drizzle-pg/`.
- O adaptador compatibiliza algumas consultas SQL antigas com PostgreSQL. Essa camada de compatibilidade não é um banco D1.
- **O plugin de build Cloudflare pode continuar presente para outros componentes da aplicação. Remover D1 não equivale a retirar Cloudflare Workers ou toda a hospedagem.**

## Critérios antes de alterar produção
1. Executar gate automático de ausência de D1 e testes com PostgreSQL **descartável** em GitHub Actions.
2. Testar migrations, handlers reais, controle de proprietário, concorrência e integridade; não aceitar CI de outro SHA.
3. Revisar paridade da `main`/PR #15 e confirmar migrações de dados existentes, não apenas criação de tabelas vazias.
4. Tirar **backup de D1 e PostgreSQL**, comparar contagens, chaves, somatórios, referências cruzadas e trilhas de auditoria; ensaiar restauração e rollback.
5. Validar conexão PostgreSQL e rede de produção com secrets no Railway; nunca commitar `DATABASE_URL`.
6. Verificar deploy, logs, ações empresariais reais e endpoints com autenticação legítima antes de marcar a migração funcional.

## Retirada física do D1
**NÃO EXECUTADA neste PR.** Apagar a instância Cloudflare D1 pode destruir dados e exige inventário de dados, migração auditável, backup restaurável e autorização explícita para a exclusão irreversível.

## Rollback
Reverter o PR restaura os arquivos de código. **Não** fazer rollback do banco sem procedimento testado de reconciliação de dados. O workflow de integração só escreve no Postgres descartável do próprio job.
