# RC89 — Field no volume PostgreSQL 18 já existente (sem novos volumes)

**Data:** 17/11/2026. **Projeto:** `genuine-renewal` (`0835d357-6037-42e6-a534-6456422e1cf3`), ambiente `staging` (`c241a855-68b7-4d75-a722-b6a42c8581e9`). **Sem promoção para produção.**

## Decisão arquitetural

Em vez de aumentar a cota ou excluir volumes antigos, reutilizar **o mesmo cluster persistente** `cisne-rc75-postgres-uat` (imagem `postgres:18.6`, região `us-west2`, volume existente `cisne-rc75-postgres-uat-data` de 5000 MB, ID `4afe76b8-3e22-46a9-9015-42c2f949c547`, montado no caminho **já ativo** `/var/lib/postgresql/data`).

**Criado dentro desse cluster**: banco lógico `cisne_rc89_field`, cujo proprietário/login é somente `cisne_rc89_field_app`; credencial com 64 caracteres hex gerada criptograficamente e armazenada como segredo Railway, usando verificador SCRAM-SHA-256 no PostgreSQL. O novo login é `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT`. Nenhuma tabela/cadastro/role existente foi alterada. PUBLIC não recebeu permissões no banco novo.

**Evidência real** — deploy de provisionamento `b5980969-6d5f-497e-859a-deebc8220504`:
```
RC89_EXISTING_VOLUME_DATABASE_PROVISION_EVIDENCE {
  "newDatabase":"cisne_rc89_field",
  "newRole":"cisne_rc89_field_app",
  "volumeReused":true,
  "postgres18":true,
  "independentLoginVerified":true,
  "newDatabaseEmpty":true,
  "legacyPublicTablesReadableByNewRole":0,
  "existingDatabasesAltered":false,
  "volumeCountChanged":false
}
```

Auditoria anterior `5a15f090-1fe6-481c-8c0b-f5f7b7bacff2` verificou `volumeDirectoryUsed=true`, `serverVersion18=true`, `primary=true`, `privilegedAdmin=true`, 2 DBs não-template antes da criação, nenhum conflito com `cisne_rc89_field` ou role. Uso de disco (última leitura Railway) ~134 MB, capacidade reservada 5000 MB (não confundir espaço livre efetivo com métricas de serviço).

**Atenção à segregação:** banco e role separados *não* equivalem a isolamento físico: o serviço PostgreSQL, o volume, a CPU, o backup de instância e o superusuário são compartilhados com RC75 UAT. Se o banco físico cair, ambos os ambientes poderão ser afetados. A aceitação dessa topologia deve ficar explícita na homologação e no plano de disaster recovery; jamais descrevê-la como bancos fisicamente isolados.

## Gates obrigatórios

1. **CI RC89 e predeploy antes de trocar a conexão:** `scripts/rc86-isolated-erp-preflight.mjs` valida projeto+ambiente+serviço, `CISNE_STAGING_READ_ONLY=true`, origem privada NextCRM e `DATABASE_URL` **exatamente** `cisne_rc89_field_app@cisne-rc75-postgres-uat.railway.internal:5432/cisne_rc89_field`. Proíbe credenciais do superusuário e o PostgreSQL temporário antigo.
2. `scripts/rc89-field-database-predeploy.mjs` executa **somente SELECT** com `default_transaction_read_only=on`, validando o banco, usuário, ownership, PostgreSQL 18 primário e ausência de privilégios administrativos. Nenhum dado de credencial, DSN, SQL retornado ou erro bruto vai aos logs.
3. Executar os testes de segurança, handlers PostgreSQL 16/18, restore e build no HEAD exato. Staging e produção permanecem separados.
4. **Prova de persistência do banco novo**: o volume do cluster já existe, mas é obrigatório demonstrar que o banco/role do Field sobrevivem a um redeploy/restart controlado do PostgreSQL, sem causar indisponibilidade indevida ao RC75 UAT. Planejar janela operacional e verificar consumidores ativos antes de reiniciar serviço. Não reiniciar automaticamente por este PR.
5. **Backup/restore real:** obter backup do volume/cluster ou export lógico real para um destino recuperável independente. Restaurar e verificar em DB separado (sem sobrescrever RC75 UAT). Registrar timestamp, ID e verificador, SHA exato do SQL `0002_crm_proposal_origin` e `0003_nextcrm_document_bridge`. `scripts/migrate-postgres.mjs` recusará migração sem essas atestações, e elas não podem ser fabricadas.
6. **DDL e schema ERP:** só após prova do passo 5, executar migrações em `cisne_rc89_field`, sem alterar nenhuma outra DB; o endpoint `/api/health/ready` deve sair de 503 para 200 após as tabelas canônicas serem criadas.
7. **UAT**: Fluxo real sobre Railway na **mesma OS**, com identidade sintética validada: contrato, documento S3, aceite/ACL, medição, fatura, baixa, estorno, fechamento e integridade. `CISNE_STAGING_READ_ONLY=true` só poderá ser reavaliado mediante novo gate explícito, nunca como ajuste de emergência.
8. **Release produtivo:** NO-GO até passar em HML, backups, isolamento, UAT e aprovação empresarial; nenhuma alteração foi feita em produção.

## Política operacional

- **Zero novo volume:** manter o contador de volumes inalterado. Não apagar nem desmontar backups.
- **Segredos**: jamais expor URL completa, senha SCRAM, papel root, conteúdo de backups ou credenciais nos logs/PR. Usar variáveis secretas Railway.
- **Desativação do PG RC85 temporário:** só após validar que ERP, probes e testes apontam ao novo DB e que seu inventário de usuário permanece vazio. Excluir serviço é uma ação diferente de excluir volume. Não eliminar sem prova de ausência de dependências.
- **Custo**: reaproveitar volume evita custo de **um volume adicional**, mas não implica custo operacional total invariável; a utilização de CPU/RAM/IO e a cobrança Railway continuam a depender do consumo real e plano contratado.
- **Se o novo banco não estiver pronto**, retornar HTTP 503 e manter NO-GO, mesmo com deployment SUCCESS. Código verde não é aceite empresarial.
