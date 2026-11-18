# NextCRM — staging Railway isolation and runtime guards

Documentado em 2026-11-15; recursos preparados mas NÃO implantados.

## Recursos preparados

- Projeto independente Railway: `nextcrm-hml-isolado`, ambiente único `staging`, privado, deploys automáticos de PR desabilitados.
- Recursos STAGED, ainda não provisionados: `nextcrm-web` (sem source), `nextcrm-jobs` (sem source), `nextcrm-postgres` (imagem `pgvector/pgvector:pg17`) e bucket `nextcrm-documents`.
- Volume STAGED `nextcrm-postgres-data`, montado em `/var/lib/postgresql/data`.
- O patch **não deve ser aplicado** enquanto as configurações necessárias, segredos, persistência, políticas de rede e imagens não estiverem revisados.
- Banco original do ERP staging (`genuine-renewal/Postgres`) e produção (`genuine-renewal/teste`) não estão envolvidos.

## Riscos observados diretamente no NextCRM v0.41.0

- O `docker-entrypoint.sh` do NextCRM roda `prisma migrate deploy` na inicialização e também `prisma db seed` quando não encontra usuários. Portanto, iniciar o container equivale a migrar/seedar o banco configurado.
- O `package.json` do NextCRM também executa `prisma migrate deploy` no script `build`.
- Não conectar qualquer source ao web service antes de confirmar que `DATABASE_URL` aponta EXCLUSIVAMENTE para o banco de homologação do NextCRM.
- O upstream usa MinIO/S3, URLs assinadas e componentes Inngest. Compatibilidade exata do bucket Railway com o cliente e os URLs de upload browser ainda NÃO foi comprovada.
- O Dockerfile.release da tag `v0.41.0` usa imagem GHCR associada à release, mas o digest da imagem ainda precisa ser verificado/pinado antes de um deploy.
- Revisar configurações de login via código de email e a conta administrativa para não habilitar credenciais padrão.
- Não habilitar exposição pública da aplicação antes de testar autenticação e política de perímetro.

## Primeiros testes reais a realizar após revisão

1. Verificar segredo de staging com fonte confiável e persistência; nunca guardar secrets em Git.
2. Verificar container image + digest e configuração de volume para PostgreSQL.
3. Provisionar banco isolado, criar conta e credenciais próprias, testar migrações sem acesso ao ERP.
4. Validar object storage com arquivos de teste sem dados sensíveis e URLs assinadas.
5. Executar inicialização NextCRM com escopo e backup comprovados; revisar seed e administrar usuário de teste.
6. Homologar OS + documentos, autenticação e isolamento por empresa.

**Estado:** neste PR há apenas um contrato puro para validar intenção de vínculo OS/documento, sem APIs, permissões, persistência ou integração ativa. Autorizar arquivo é etapa separada do parser de payload.
