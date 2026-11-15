# Registro de configuração de homologação — NextCRM (15/11/2026)

## Situação REAL: somente STAGED, não provisionado

- Projeto Railway **privado**: `nextcrm-hml-isolado`, ambiente `staging` exclusivo.
- Railway patch de alterações pendentes: `cdfec4e5-1e02-4005-a8e5-5cfd46eef466`.
- Verificado pelo inventário Railway: `STAGED`, sem deploys, sem mudanças destrutivas.
- Serviços: `nextcrm-postgres` (`pgvector/pgvector:pg17`), `nextcrm-web` (vazio, sem imagem/source), `nextcrm-jobs` (vazio, sem imagem/source).
- Volumes persistentes preparados: `nextcrm-postgres-data` em `/var/lib/postgresql/data` e `nextcrm-jobs-data` em `/var/lib/inngest`.
- Bucket `nextcrm-documents` preparado mas NÃO provisionado; sua conexão S3 ainda NÃO pôde ser obtida.
- Nenhum recurso NextCRM está ativo; NÃO foram aplicadas migrações, seeds nem testes de storage.
- Produção do ERP (`genuine-renewal/production`, serviço `teste`) permanece fora do escopo.

## Variáveis Railway preparadas (NOMES SOMENTE, sem valores)

**DB:** `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD`, `PGDATA`, `POSTGRES_INITDB_ARGS`.

**Web:** `DATABASE_URL` por referência ao serviço DB, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `BETTER_AUTH_SECRET`, `EMAIL_ENCRYPTION_KEY`, `MINIO_ENDPOINT`, `MINIO_PUBLIC_ENDPOINT`, `MINIO_BUCKET`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY`, `INNGEST_BASE_URL`, `INNGEST_DEV`, `NEXT_PUBLIC_APP_NAME`, `NODE_ENV`, `SEED_DEMO_DATA`.

**Jobs:** `INNGEST_SIGNING_KEY` e `INNGEST_EVENT_KEY`. Os mesmos segredos são referenciados pela aplicação; não foram duplicados como valores em dois serviços.

Os valores secretos foram gerados aleatoriamente e enviados apenas às variáveis do Railway. **A configuração staged ainda é mutável e não está selada.** Recomenda-se selar os segredos na UI antes de habilitar a aplicação, se o Railway permitir.

## Ponto bloqueante: Railway Bucket vs cliente MinIO do NextCRM

Observação direta no upstream NextCRM `lib/minio.ts` no SHA fixado `d3bead9...`: `new S3Client()` está hardcoded com `forcePathStyle: true` e `region: 'us-east-1'`. O navegador utiliza URLs assinadas emitidas por esse cliente.

A documentação oficial Railway informa que cada bucket tem `urlStyle` (`path` ou `virtual-host`), região do endpoint e credenciais por referências. A compatibilidade do NextCRM NÃO pode ser assumida até ler os detalhes da instância provisionada e fazer upload/download teste com CORS:
- https://docs.railway.com/storage-buckets
- https://docs.railway.com/storage-buckets/uploading-serving
- https://docs.railway.com/variables/reference

**Condição:** se Railway declarar `urlStyle=virtual-host`, o NextCRM atual com `forcePathStyle=true` exige adaptação auditada ou MinIO dedicado. Verificar assinatura e região, nunca alterar apenas hostname de URL presignada. Mesmo com estilo `path`, fazer testes reais do SDK e do browser.

**Nota de isolamento:** os buckets são privados por ACL, mas o endpoint S3 trafega pela rede pública do provedor; 'isolado' aqui significa credenciais/bucket exclusivos e autorização, não transporte pelo private networking.

## Gate de ativação (NÃO SATISFEITO)

1. Revisar o patch exato antes de qualquer `accept-deploy` e obter autorização explícita para implantar staging.
2. Pin de **digest** de imagens PG/NextCRM/Inngest; não usar tags mutáveis como única garantia de reprodutibilidade.
3. Definir `APP_URL`, `BETTER_AUTH_URL`, remetente e provedor de e-mail real para autenticação, além de identidade administrativa de teste autorizada; não usar endereço padrão.
4. Proteger perímetro antes de expor a aplicação: sem URLs públicas até concluir proteção.
5. Garantir que banco de dados é exclusivamente NextCRM e não tem conexão com o ERP; verificar extensões e backup/restore.
6. Resolver compatibilidade de storage S3 (estilo, região, CORS, URLs temporárias, upload e download) ou usar MinIO compatível.
7. Definir e testar a imagem/comando do processador Inngest, porta/healthcheck e persistência.
8. Só então autorizar o entrypoint: ele executa automaticamente `prisma migrate deploy` e pode executar `prisma db seed` na primeira inicialização.
9. Validar RBAC/tenant e documentos de pessoas/OS com arquivos fictícios, sem dados sensíveis.

## Estado CI e risco de merge

- Os cinco checks do PR #16 foram confirmados verdes no commit `72de9902f63964bf3166b1910a7958367b6c8c1b`.
- Qualquer novo commit **invalida** esse status; revalidar o HEAD exato antes de merge.
- O PR deve permanecer **DRAFT/NO-GO**: ainda não existe deployment NextCRM, integração funcional, migração real ou teste E2E.

**Rollback do staging não implantado:** abandonar/reverter o patch staged no projeto NextCRM (sem tocar no ERP); não há dados a recuperar porque os serviços não foram provisionados.