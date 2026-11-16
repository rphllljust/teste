# CISNE ERP + NextCRM — vínculo documental persistente (proposta de implantação)

## Estado e escopo

**PR #18, draft.** A alteração existe no código e foi testada contra bancos PostgreSQL descartáveis do GitHub Actions, mas não foi aplicada ao PostgreSQL real do Railway.

- Banco ERP: PostgreSQL 18 em `genuine-renewal/staging`; auditoria anterior confirmou 36 tabelas empresariais vazias e migração inicial presente.
- Banco NextCRM: **separado**, em outro projeto Railway ainda STAGED.
- Migração `0001_nextcrm_order_document_links.sql`: adiciona duas tabelas de metadados no **ERP** e triggers imutáveis, sem acessar banco do NextCRM e sem armazenar arquivos binários, URLs assinadas ou credenciais.
- `scripts/migrate-postgres.mjs`: usa `_cisne_schema_migrations` e lock consultivo transacional para impedir execuções concorrentes.
- `lib/integrations/nextcrm/postgres-document-link.ts`: faz preflight, revalida OS e cliente ativo com lock no banco, persiste vínculo + evento `linked` em uma única transação; retry com mesmo idempotency key retorna mesmo vínculo.
- `test/integration/nextcrm-document-link.test.ts`: teste real PostgreSQL com proprietário legítimo, usuário externo, OS sem owner, cliente inativo, replay idempotente, conflitos, concorrência e imutabilidade.

## Modelagem

- `nextcrm_order_document_links`: UUID, OS/owner/ERP client, tenant/account/documento do NextCRM, espécie, versão, hash opcional, chave idempotente, request hash, actor e correlation ID.
- `nextcrm_order_document_events`: evento `linked` imutável, hash, actor/correlation ID.
- As tabelas possuem FK para OS/cliente do ERP; unicidade por `(owner_id,idempotency_key)` e `(service_order_id,owner_id,document_id,version)`.
- Não criar registros sem evidência de autorização do NextCRM; test doubles são usados *somente* em CI.
- A autorização de visualização/download deverá ser novamente verificada no NextCRM. Ter um vínculo no ERP não concede acesso ao documento.

## Sequência de migração **quando autorizada** em staging

1. Fotografar estado/digest da aplicação e fazer backup testado do PostgreSQL ERP. Confirmar que o destino é o serviço `genuine-renewal/staging/Postgres`, jamais o NextCRM Postgres e jamais produção.
2. Bloquear eventual deploy automático com migração antes do backup; revisar `preDeployCommand` do serviço Railway.
3. Executar `pnpm db:migrate` usando secrets do próprio ambiente, somente após autorização de escrita. A migração `0000` já registrada será pulada, e a `0001` será aplicada uma única vez.
4. Verificar presença e constraints das duas novas tabelas, triggers de imutabilidade, ID `0001_nextcrm_order_document_links` na tabela de migrações, e manutenção intacta das 36 tabelas anteriores.
5. Executar UAT autenticado do vínculo com documentos fictícios e provar que nenhum ID de proprietário/tenant veio de payload público.
6. Comprovar restart e recuperação do PostgreSQL, logs sem dados sensíveis e plano de reversão.
7. Validar acesso interno do NextCRM, RBAC por tenant e autorizações de documento reais **antes** de habilitar qualquer API ou interface pública.

## Reversão e bloqueios

A migração é **aditiva**, mas não deve ser revertida com `DROP TABLE` nem apagando eventos auditados. Em falha, desligar a nova funcionalidade, manter os registros intactos e reverter o código para revisão controlada. Se necessário, restaurar backup previamente ensaiado.

**NO-GO de produção:** dados históricos não reconciliados (36 tabelas reais vazias em staging), NextCRM Railway não executado, ausência de servidor-servidor autenticado e controle da branch `main` de deploy. Não executar merge direto na `main`.
