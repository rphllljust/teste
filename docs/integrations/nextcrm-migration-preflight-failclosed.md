# Pré-verificação da linhagem de migrações PostgreSQL — CISNE + NextCRM

## Falha que motivou a proteção

O staging do CISNE executou uma versão financeira da sequência de migrações sobre uma estrutura cuja primeira implantação de documentos NextCRM usa o ID `0003_nextcrm_document_bridge`. As duas histórias criam as mesmas quatro tabelas sob IDs diferentes, e o deployment financeiro falhou com PostgreSQL `42P07` (tabela `nextcrm_erp_identity_mappings` já existe).

Não é seguro resolver isso apenas com `CREATE TABLE IF NOT EXISTS`. A existência de uma tabela não garante que seus índices, constraints, tipos, gatilhos e funções sejam compatíveis, nem que o ledger represente com precisão o conteúdo já aplicado.

## O que mudou

O driver `scripts/migrate-postgres.mjs` passou a consultar **somente metadados**, ainda na transação existente e após adquirir seu advisory lock:

1. Os três IDs de interesse no ledger `_cisne_schema_migrations`.
2. Os nomes das quatro tabelas NextCRM no schema corrente.
3. Os IDs de migração declarados no manifesto do **próprio commit**.

O helper puro `scripts/nextcrm-migration-preflight.mjs` retorna autorização de prosseguir **somente quando** o manifesto e o histórico registrado são compatíveis, ou quando o banco está realmente sem estrutura NextCRM e há exatamente um caminho definido.

O helper interrompe com `NEXTCRM_MIGRATION_NO_GO_*` em caso de:

- Histórico documental `0003` e manifesto financeiro `0001`/`0002`.
- Histórico financeiro completo `0001`/`0002` e manifesto documental `0003`.
- Ledger misto ou financeiro parcial.
- Tabelas NextCRM existentes sem histórico correspondente.
- Tabelas presentes parcialmente ou faltantes quando o ledger diz que estão aplicadas.
- Manifesto que tenta aplicar os dois caminhos simultaneamente.

Qualquer falha força `ROLLBACK`. Nenhuma migration de negócio, backup ou objeto NextCRM é deletado.

## Evidências e limites

- Testes unitários cobrem banco novo, reexecuções válidas, histórias cruzadas, parcialidade, drift e manifesto misto.
- O ensaio PG16/18 `scripts/rehearse-nextcrm-dual-lineage.mjs` agora verifica tanto a rota permitida de cada história quanto sua rejeição cruzada, tudo em transação descartável.
- Os pipelines executam as verificações antes de migrar.
- O preflight é proteção anti-acidente, **não reconciliador**. Ele não aplica DDL, não marca uma migração diferente como executada e não converte um banco financeiro para documental.

### Próximo passo de operação

O patch financeiro já staged no Railway pertence a outra linha de trabalho e **não deve ser aplicado pelo nosso branch**. O RC integrado precisa:

1. Auditar o ledger no banco ERP em transação `READ ONLY`, via PR #64.
2. Comparar as definições completas dos objetos existentes e confirmar backup/restore independentes.
3. Preparar uma reconciliação **versionada, auditável e não destrutiva**, condicionada ao histórico observado.
4. Provar upgrade finance-first→RC e document-first→RC em bancos descartáveis com dados de vínculos/auditoria sintéticos não apagados.
5. Só então homologar o build combinado no staging desktop/mobile, sem desabilitar gates ou sobrescrever patch da outra IA.

Trabalho vinculado ao [issue #60](https://github.com/rphllljust/teste/issues/60). Este PR deve permanecer Draft e sem deploy automático.
