# RC87 — liberação controlada do PostgreSQL 18 ERP no Railway

**17 de novembro de 2026** · Status: **NO-GO para migrações/UAT empresarial e produção** · Incidente [#87](https://github.com/rphllljust/teste/issues/87).

## Escopo e evidências

- Projeto: `genuine-renewal` (`0835d357-6037-42e6-a534-6456422e1cf3`).
- Ambiente: `staging` (`c241a855-68b7-4d75-a722-b6a42c8581e9`).
- Serviço PostgreSQL ERP exclusivo: `cisne-rc85-ephemeral-pg` (`7202c8eb-4a9e-4cb9-9329-0988e5033263`), imagem `postgres:18`, região `us-west2`, DB `cisne_rc85`.
- ERP privado: `cisne-rc85-ephemeral-erp` (`fed95ca7-f373-4e6a-983f-2f591f26672e`), RC86 SHA `e832ebf9cb7d1fd0006f988454e9eae2b14747a5`, deployment `ad4c8c49-929c-49f4-8803-87805b64e009` SUCCESS.
- Predeploy RC86 PASS, `CISNE_STAGING_READ_ONLY=true`, sem domínio público, `GET/POST /api/orders` anônimos bloqueados (403).
- HTTP `GET /api/health/ready` retorna 503; PG log `42P01`. Auditoria read-only: DB correto e PostgreSQL18, **nenhuma tabela de usuário/ledger**.
- Inventário Railway tem **11 volumes anexados** no projeto/ambiente. Criar volume RC87 isolado falhou: `You can only have 10 volumes per project`. **Não apagar ou mover volumes para liberar espaço.**

## Ordem de execução (condicional)

1. **Cota**: obter capacidade de volume adicional por suporte Railway sem deletar volumes existentes e sem alterar plano/custo sem consentimento específico. Não presumir que outro projeto compartilhe DNS privado.
2. **Volume**: criar `rc87-erp-pg18-isolated-data` com **1024 MB**, região `us-west2`, montado **exclusivamente** em `cisne-rc85-ephemeral-pg`, no caminho `/var/lib/postgresql` (layout PostgreSQL 18). Revisar `get_staged_changes` antes de aplicar. O volume montado pode ocultar o diretório antes presente no contêiner: **somente aplicar se a auditoria confirmar o banco RC85 descartável e sem dados de usuário**. Não alterar NextCRM nem Postgres compartilhado.
3. **Gate de controle Railway, sem segredos**: obter o JSON COMPLETO retornado por `Railway.describe_environment` do projeto + ambiente acima e salvá-lo localmente em um arquivo protegido fora do repositório. Conferir manualmente o ID do volume recém-criado. Executar:
   ```bash
   node --test scripts/rc87-erp-persistence-gate.test.mjs
   RC87_APPROVED_VOLUME_ID="<ID_REAL_DO_NOVO_VOLUME>" node scripts/rc87-erp-persistence-gate.mjs /caminho/seguro/railway-staging-inventory.json
   ```
   Ausência de snapshot, ID de volume não aprovado, banco errado, volume em staging, mount incorreto ou duplicado: `RC87_PERSISTENCE_NO_GO`. **Este gate confirma metadados de montagem, não durabilidade em disco nem backup.**
4. **Prova de persistência real**: inserir uma marca sintética aleatória no banco RC85, verificar leitura e checksum, reiniciar o serviço PostgreSQL no Railway e verificar novamente a mesma marca; repetir após redeploy, preservando o volume. Não usar dados empresariais, nem segredos nos logs. Registrar IDs de deployment, volume, timestamp e hash no ticket #87. Isolar o ensaio dos serviços legacy.
5. **Backup e restore independente**: executar backup lógico do banco ERP isolado e restauração em **outro banco** com checksum e comparação do ledger/objetos. Guardar evidência verificável de backup ID, banco de restauração, verificador e horário UTC. Registrar estado da conexão e restauração, incluindo teste negativo. **Não** gerar atestações fictícias.
6. **Migrações protegidas**: `scripts/migrate-postgres.mjs` contém migrações imutáveis, preflight NextCRM e lock PostgreSQL. O migrador exige `CISNE_DB_RESTORE_ATTESTATION` para SQL `0002_crm_proposal_origin` e `CISNE_DB_RESTORE_ATTESTATION_0003` para `0003_nextcrm_document_bridge`, com digests do SQL **exato** e evidência recente. Usar apenas operador e runner autorizados apontando para `cisne_rc85`; nunca apontar para `nextcrm-rc84-isolated-pg`, banco legado, produção ou variáveis de migração fabricadas.
7. **Prontidão e UAT**: somente após as migrações, `GET /api/health/ready` deve retornar 200 `{"status":"ready"}`, validando ledger + tabelas. Em fase separada, permitir UAT sintética sob autorização específica, com proteção de identidade, matrículas/ACL e processo ponta a ponta **mesma OS → documento S3 → medição → fatura → baixa → estorno → fechamento**, integridade de ambas as bases, reversões, auditoria e Playwright. O modo read-only não deve ser desligado implicitamente.
8. **GO produtivo**: exige revisão empresarial, aprovação dos gates do HEAD exato, evidência de persistência/restauração, UAT e procedimento de release/rollback. **Sem** merge ou alteração de produção a partir do RC87.

## Política de segurança

O validador `scripts/rc87-erp-persistence-gate.mjs` é deliberadamente **read-only**. Consome somente metadados do controle Railway; nunca acessa `DATABASE_URL`, AWS/S3 keys, banco de dados, APIs de mutação ou domínio público. Ele recusa a topologia atual por falta de volume. Não é uma autorização para migrar: atestação de backup/restauração, persistência observada, prontidão e aceite empresarial são **gates independentes**.

**Proibido:** remover volumes históricos por baixa utilização de CPU, alterar plano comercial sem permissão, montar armazenamento legado no RC85, fabricar evidência de backup, criar domínio público ou liberar escrita para “fazer passar”.
