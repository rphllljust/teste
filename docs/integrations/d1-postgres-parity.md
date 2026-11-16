# Migração D1 → PostgreSQL: auditoria de integridade (sem exclusão)

**Objetivo:** evitar desligar/apagar D1 com dados faltando ou incompatíveis no PostgreSQL. PR #17 está encadeado ao PR #15 e NÃO altera nenhum banco ativo.

## 1. Fonte do dado e congelamento de escrita
- Identificar pelo painel Cloudflare o **nome e UUID do D1 que atende à produção** e o projeto/Worker associado. Não confundir com o placeholder em `.openai/hosting.json`.
- Exportar pela ferramenta oficial somente após planejar janela de manutenção e congelamento de escrita; uma exportação remota pode bloquear consultas enquanto é gerada. <https://developers.cloudflare.com/d1/wrangler-commands/>
- Exemplo (substituir `D1_REAL` pelo nome confirmado e controlar o caminho seguro):
  ```bash
  pnpm exec wrangler d1 export D1_REAL --remote --output /secure-backups/cisne-d1-export.sql
  ```
- **Não rodar** `wrangler d1 delete` neste processo. Backup deve ser criptografado, com acesso restrito, testado por restauração e guardado fora do Git/GitHub Actions.
- Nenhum conector Cloudflare D1 está disponível nesta execução para verificar banco real/produzir export. Não presumir D1 vazio nem origem correta.

## 2. Inventário e comparação exata de linhas
- O dump SQL D1 é **SQLite SQL**, não uma migração PostgreSQL. Não executar `psql -f` com esse arquivo; usar migração ETL com mapeamento de colunas/tipos/IDs e transação controlada em banco exclusivo.
- Após export/restore local, executar somente em estação/runner de confiança:
  ```bash
  python3 scripts/d1-export-fingerprint.py --sql /secure-backups/cisne-d1-export.sql --output /secure-backups/d1-manifest.json
  DATABASE_URL='<postgres-readonly-connection>' node scripts/verify-postgres-cutover.mjs --source /secure-backups/d1-manifest.json
  ```
- Os scripts verificam as **36 tabelas do esquema ERP atual**, mesmas colunas, contagem de linhas e SHA-256 do conteúdo canônico de cada linha em ordem de chave `id`; não publicam dados. Não substituem teste de relacionamentos e semântica empresarial.
- O comparador PostgreSQL usa transação `REPEATABLE READ READ ONLY` e só lê linhas/metadados. Ele não cria tabelas, não copia dados e não executa migrações.
- Manifest e dump são confidenciais e **não devem ser commitados**, enviados a serviços externos ou anexados ao PR.
- Divergência de colunas/contagem/hash = **NO-GO**, mesmo que CI e deploy estejam verdes.

## 3. Carregamento e prova funcional
1. Validar schema de origem e destino; migrar cada tabela em dependência referencial correta, mantendo identificadores, histórico, timestamps, valores monetários, versão e atores.
2. Comprovar idempotência da importação, commits/rollback e reconciliar relatórios gerenciais/saldos/bancos, além de ligação OS↔cliente/contrato.
3. Congelar escritas enquanto calcula export, carrega dados e produz manifest de destino; se houver dual-write/CDC, validar todos os eventos até o checkpoint final.
4. Executar E2E autenticado em HML contra PostgreSQL, inclusive casos negativos de cross-tenant, anexos e relatórios.
5. Testar restauração de backup PostgreSQL, replicação/rollback, estratégia de DNS/variáveis e janela operacional.
6. Somente **depois** autorizar cutover de leitura/gravação para PostgreSQL em produção. O D1 permanece intocado em retenção por janela definida.

## 4. Exclusão física do D1 — independente do cutover
A exclusão do recurso Cloudflare D1 é **irreversível e NÃO autorizada nesta etapa**. Exige aprovação específica, prova de export/restauração, contagem e hashes, observabilidade pós-cutover e período de retenção acordado. A remoção do binding no código não destrói o banco.

## 5. Evidência esperada por ambiente
| Gate | Como comprovar | Estado |
|---|---|---|
| Schema PostgreSQL e handlers no CI | Checks do PR #17 | Passou no SHA `87a528a7...`; revalidar novos SHAs |
| D1 real identificado | Cloudflare DB ID + Worker/namespace | Não verificado |
| Export e backup D1 | Artefato privado + restauração | Não executado |
| Dados PostgreSQL carregados | Manifest D1 e PG com hash igual | Não verificado |
| UAT autenticado da produção | Cenários OS/cliente/financeiro/contrato | Não executado |
| Cutover da produção | SHA/digest + smoke + rollback | Não autorizado |
