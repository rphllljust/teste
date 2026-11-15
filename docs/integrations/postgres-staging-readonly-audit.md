# CISNE — auditoria PostgreSQL real, somente leitura

## O que já está confirmado
- Banco PostgreSQL 18 existe e está ativo em `genuine-renewal/staging` no Railway, serviço `Postgres`.
- Serviço `cisne-web-staging` possui `DATABASE_URL`, mas a conexão OAuth Railway **não disponibiliza os valores da variável nem execução SQL**.
- O banco está protegido pela rede privada Railway, sem proxy público. Isso é desejável.
- Não há acesso à instância Cloudflare D1; não há exportação comprovada. **Não é possível declarar migração completa, paridade real ou autorizar exclusão do D1.**

## SQL somente leitura
Arquivo: `scripts/audit-postgres-staging-readonly.sql`.

- Usa `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`, `statement_timeout` e `lock_timeout`.
- Recolhe apenas: `transaction_read_only=on`, quantidade das 36 tabelas do domínio, presença de tabela de migrações, quantidade de constraints FK e **COUNT(*) por tabela**.
- **Não imprime dados de clientes, OS, funcionários, documentos, IDs ou credenciais**.
- A contagem de registros não certifica migração do D1 nem integridade financeira; valida apenas a presença da estrutura e quantidades atuais.
- Se tabela estiver ausente ou qualquer SELECT falhar, retorna erro e mantém NO-GO.

## Execução segura dentro do Railway
- Usar `postgres:18` numa tarefa temporária **privada e de execução única** em `genuine-renewal/staging`, sem domínio público, TCP proxy ou volume, sem restart automático.
- Referências de `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` devem apontar **apenas para `Postgres` de staging**. Não usar banco de produção.
- Definir adicionalmente `PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=12000`.
- O container deve executar somente este SQL versionado; não conectar `main` nem rodar `db:migrate`, seed ou `CREATE ROLE`.
- **Nunca abrir a porta 5432 publicamente** ou incluir secrets em GitHub Actions, logs ou mensagens.
- Como o container `postgres:18` não inclui automaticamente o repositório, a preparação Railway deve usar comando psql inline derivado exatamente do arquivo auditado ou imagem verificável que o inclua. Conferir SHA do SQL e do comando antes de aplicar.
- Recomenda-se conta PostgreSQL exclusiva com permissões `SELECT` (sem `INSERT/UPDATE/DELETE/DDL`) antes de ativar o auditor. Se usar temporariamente a conta da aplicação, o servidor deve forçar uma transação/sessão `READ ONLY` e a atividade precisa de revisão mais rigorosa.
- Depois de executar, coletar somente contagens, verificar presença do schema e eliminar o serviço auditor.

## Validação em CI
O PR #17 adiciona teste do mesmo SQL contra um PostgreSQL 18 descartável, **após migrations**, executando psql num container read-only. Exige `READ_ONLY|session|on`, `TABLES_PRESENT|public|36` e 36 contagens retornadas. CI verde não implica dados reais lidos.

## Condições para cortar D1
Sem export Cloudflare D1 e comparação real de hashes/contagens, o corte definitivo continua **NO-GO**. Podemos avançar no inventário e na homologação PostgreSQL de staging, mas não inventar dados históricos nem considerar o destino migrado.
