# NextCRM — evidência de staging e decisão técnica (15/11/2026)

**Estado:** preparação de infraestrutura **STAGED**, sem aceitação do patch Railway. A existência dos serviços na tela de alterações pendentes **NÃO** significa que estão implantados.

## Escopo e proveniência

- ERP: `rphllljust/teste`, PR #16 em `DRAFT/NO-GO`.
- NextCRM upstream: `pdovhomilja/nextcrm-app`, SHA `d3bead9b44efe2cf94d0dfc2948af0f2c9270deb`, release `v0.41.0` e licença MIT.
- Infraestrutura Railway exclusiva: projeto privado `nextcrm-hml-isolado`, ambiente `staging`, patch `cdfec4e5-1e02-4005-a8e5-5cfd46eef466`.
- Revisão do patch: `STAGED`, 61 mudanças pendentes e nenhuma alteração marcada como destrutiva. **Ainda não foi aplicado.**
- Produção ERP `genuine-renewal/production` não foi alterada.

## Recursos preparados em Railway — NÃO ATIVOS

| Recurso | Configuração preparada | Observação |
|---|---|---|
| nextcrm-web | `ghcr.io/pdovhomilja/nextcrm-app:v0.41.0` | Imagem na release original; digest de execução ainda não verificado |
| nextcrm-postgres | `pgvector/pgvector:pg17` | Volume `nextcrm-postgres-data` em `/var/lib/postgresql/data` |
| nextcrm-minio | `pgsty/minio:RELEASE.2026-08-04T00-00-00Z` | Volume `nextcrm-minio-data` em `/data`; comando MinIO preparado |
| nextcrm-jobs | `inngest/inngest:v1.53.0` | Volume `nextcrm-jobs-data` em `/var/lib/inngest`; comando do servidor Inngest preparado |
| nextcrm-documents | Bucket Railway S3 **LEGADO, STAGED e NÃO PROVISIONADO** | Não está referenciado pelo web service. **Remover de alterações pendentes antes de qualquer apply**, senão provisionaria recurso duplicado. O conector disponível recusa excluir bucket ainda não provisionado. |

**Nota:** não foi criada nenhuma URL pública; não há serviços live nem banco inicializado.

## Variáveis e secrets em staging

- Senhas do Postgres e MinIO, segredo de sessão Better Auth, chave de criptografia de e-mail e chaves Inngest foram gerados com CSPRNG e enviados apenas às variáveis de serviço do Railway.
- Aplicação usa referências aos serviços para PostgreSQL, MinIO e Inngest. Não foram inseridos valores de credenciais no Git.
- `NEXT_PUBLIC_APP_URL`, `BETTER_AUTH_URL`, `MINIO_PUBLIC_ENDPOINT`, `TEST_USER_EMAIL` e `MINIO_API_CORS_ALLOW_ORIGIN` são **placeholders em domínios reservados .invalid**. **Obrigatório substituí-los por endereços reais protegidos antes de qualquer deploy.**
- `RESEND_API_KEY`/`EMAIL_FROM` não foram configurados, portanto não existe comprovação de login por OTP.
- Nenhum `ADMIN_EMAIL` real foi autorizado. Não usar o default do upstream como conta empresarial de produção.
- A aplicação NextCRM original roda `prisma migrate deploy` e pode rodar `prisma db seed` no **ENTRYPOINT**. Jamais iniciá-la apontando para o banco do ERP ou uma base compartilhada.

## Compatibilidade S3: decisão tomada e evidência

- Railway Storage Buckets novos são `virtual-hosted-style`; upstream NextCRM `lib/minio.ts` exige `forcePathStyle: true` e `region: 'us-east-1'`. Portanto, **não usar diretamente o bucket Railway sem adaptação auditada**.
- O staging adota MinIO exclusivo, conforme o `docker-compose-coolify.yml` original, conservando a API atual.
- O workflow `.github/workflows/nextcrm-minio-signed-upload-smoke.yml` iniciou um MinIO descartável em GitHub Actions e confirmou `presignPut` + `presignGet` reais, tamanho/tipo, igualdade do conteúdo e exclusão de arquivo de teste.
- **Atenção:** o teste no CI não comprova URL pública, CORS real, TLS, restrições do domínio ou integração Railway; estes são gates separados.
- O upstream define políticas de objetos documentais privados; depois de ativar, validar bloqueio de URLs anônimas a `documents/`, `images/` e `uploads/` (ver `docs/deployment/private-document-files.md` do NextCRM). Apenas `avatars/` pode ter leitura anônima no padrão.

## Evidências CI / homologação de container

No commit `604607d03413639833a1811894bf54c0f3341a6d`, as 8 verificações passaram:

1. Build do ERP.
2. Quality / types / lint.
3. Invariantes de domínio ERP.
4. Integridade do submodule NextCRM e SHA.
5. Contrato e helpers de documento.
6. Suíte Jest original de documentos/autorização do NextCRM (banco inacessível por design).
7. MinIO efêmero com PUT/GET assinados de documento real de teste.
8. Boot de **container oficial NextCRM v0.41.0** com PostgreSQL pgvector e MinIO temporários, execução de migrações **SOMENTE no banco efêmero**, resposta HTTP e bloqueio **401** de download anônimo de documento. Contêineres e rede eliminados ao final.

**Não provados:** acesso por navegador autenticado com e-mail real, compatibilidade em Railway, persistência entre deploys, HA/backup, CORS público, tenants, autorização cruzada ERP↔NextCRM, assinatura eletrônica e E2E de OS.

## Gates para próxima aprovação de deploy STAGING — ainda NÃO satisfeitos

1. Cancelar o bucket S3 Railway `nextcrm-documents` da lista `STAGED` para evitar um componente não utilizado e cobrança.
2. Verificar digests/assinaturas dos quatro container images para deployment reprodutível; usar tags de versão apenas como referência inicial.
3. Registrar domínio privado/protegido para NextCRM, endpoint HTTPS de MinIO apropriado para presigned URLs e origem CORS exata; substituir todos os `.invalid`.
4. Configurar identidade administrativa de HML e serviço de envio OTP autorizado, sem dados reais e sem credenciais padrão.
5. Configurar healthchecks, TLS, egress, rotas e DNS interno; confirmar o app só usa DB/bucket exclusivos. Restringir o console MinIO à rede privada.
6. Comprovar backups/restore dos três volumes e política de retenção. Avaliar versão mantida do MinIO/SILO antes da produção.
7. Validar patch final do Railway no ambiente exclusivo, sem alterações destrutivas, e obter **aprovação explícita de implantação**. Não aplicar `accept-deploy` automaticamente.
8. Testar login, CRUD, upload/download, permissão por tenant, falhas de rede, auditoria e integração OS↔documentos **no staging real**.
9. Manter PR #16 como DRAFT/NO-GO para merge até cumprir gates e revisar seus efeitos de deploy automático.

## Reversão

Até aqui não existem dados NextCRM remotos nem deploys no Railway. Cancelar o patch staged e reverter o PR remove preparação de código e recursos; os testes GitHub Actions usam bancos e armazenamento descartáveis.
