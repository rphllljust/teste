# NextCRM — plano executável de homologação isolada (NO-GO de produção)

Atualizado em 2026-11-15. Este documento é apenas um runbook técnico. A existência dele não implica instalação, deploy, integração nem homologação.

## 1. Baseline e cadeia de fornecimento

- ERP: `rphllljust/teste`, PR #16, branch `integration/nextcrm-isolated-20261115`.
- NextCRM: Git submodule `integrations/nextcrm-upstream`, SHA imutável `d3bead9b44efe2cf94d0dfc2948af0f2c9270deb`.
- Fonte original: https://github.com/pdovhomilja/nextcrm-app (MIT; manter LICENSE/copyright).
- Não substituir a referência de versão por `main`, `latest` ou outro artefato mutável sem revisão.
- Clone íntegro: `git clone --recurse-submodules --branch integration/nextcrm-isolated-20261115 https://github.com/rphllljust/teste.git`.
- Para testar: trabalhar diretamente no submodule, em container ou workspace isolado; nunca compilar o NextCRM como parte do `pnpm build` do ERP.

## 2. Estado observado no Railway e salvaguardas

- Projeto: `genuine-renewal`; ambientes `production` e `staging`.
- Serviço `teste` em `production` segue a branch `main`, cuja alteração pode acionar deploy automático.
- Staging atual contém `cisne-web-staging` e um Postgres separado para o ERP; **não reutilizar este Postgres para NextCRM**.
- Criar NextCRM em projeto/ambiente isolado (preferencialmente projeto Railway exclusivo) e **sem ligação ao banco, rede pública ou storage do ERP**.
- Nenhum comando de migração ou seed será executado em `production`; nenhum novo serviço deve ser criado sem explicitamente fixar o ambiente.
- Recursos staged de um ambiente podem ser aplicados por outras ações: não deixar patches pendentes na mesma área de trabalho empresarial.

## 3. Requisitos reais do upstream

A versão fixada usa Next.js 16, React 19, TypeScript, Prisma 7 e PostgreSQL; o `docker-compose-coolify.yml` original utiliza:

- Postgres com `pgvector/pgvector:pg17` (verificar compatibilidade de versões e extensões em homologação).
- MinIO/S3 próprio para arquivos, inclusive endpoint público restrito para upload via URLs assinadas.
- Inngest isolado para tarefas e processamento assíncrono.
- Aplicação NextCRM e seus segredos próprios.

A configuração Docker upstream exige `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`, `BETTER_AUTH_SECRET` e `EMAIL_ENCRYPTION_KEY`; instalar com segredo gerado aleatoriamente no gestor de segredos, nunca commitar valores.

Também revisar `APP_URL`/`BETTER_AUTH_URL`, `MINIO_PUBLIC_URL`, `MINIO_BUCKET`, `RESEND_API_KEY`, `EMAIL_FROM` e `ADMIN_EMAIL`. A documentação informa autenticação por código enviado por e-mail. Não utilizar `admin@example.com` nem credenciais `changeme` em serviço exposto.

**Risco especial:** o `package.json` do NextCRM executa `prisma migrate deploy` durante `pnpm build`. Portanto, um build com `DATABASE_URL` apontando para base errada altera o esquema. Bloquear builds/migrations até confirmar por URL, serviço e ambiente o banco de testes exclusivo.

## 4. Ordem de implantação — não executada

1. Confirmar CI verde no HEAD exato do PR #16. CI do ERP não prova funcionamento NextCRM.
2. Validar assinatura/commit do submodule, dependências e licença de todos os componentes.
3. Criar infraestrutura dedicada e privada em staging NextCRM: banco vazio, storage vazio, Inngest e serviço web. Não emitir domínio público antes de autenticá-lo e protegê-lo.
4. Definir secrets de staging em Railway (sem registrá-los no Git, logs ou relatórios). Validar endpoints e DNS internos.
5. Executar migrations do NextCRM **somente** no banco isolado; não rodar seed de dados reais nem usar conta administrativa padrão.
6. Executar typecheck, lint, testes, build e E2E na revisão fixada; registrar artefatos e evidências.
7. Testar login, CRUD de contatos, anexos, upload/download, versões, isolamento por empresa, falhas negativas (403/404), limites e recuperação.
8. Construir adaptador API server-to-server **separadamente**; never compartilhar cookies/chaves. Mapear `ERP client.id` e `service_orders.id` para documentos do NextCRM usando identidade autorizada.
9. Validar contrato e backup/restore, com testes de falha (NextCRM indisponível não altera OS).
10. Só depois propor PR funcional pequeno e homologação. Merge e produção precisam de aprovação específica e verificação de auto-deploy.

## 5. Gates de aceite da integração OS + Documentos

- ERP é a fonte de verdade para OS e clientes.
- Documento pertence a um escopo de empresa/usuário e a uma versão; vínculo não depende de título, nome ou CPF/CNPJ como chave.
- Fluxos: anexar arquivo à OS, listar, visualizar com autorização, baixar por URL assinada de curta duração, criar nova versão e consultar auditoria.
- Falhas: usuário de outro tenant não vê nem arquivo nem metadados; upload rejeita tipo/tamanho impróprio; repetição idempotente não duplica vínculo; indisponibilidade do storage não corrompe a OS.
- Backups comprovados para registros e blobs, e política de retenção adequada a LGPD.
- Não assumir que as Server Actions do NextCRM são APIs externas: criar endpoints próprios versionados ou adaptador que usa APIs efetivamente suportadas.

## 6. Situação nesta revisão

**Concluído:** referência do código completo via submodule, commit fixado, PR #16 draft, mapa de entidades e este plano.

**Pendente:** deploy NextCRM, provisionamento de banco e storage próprios, builds NextCRM, testes reais, criação de APIs de integração, interface integrada, validação de segurança e aprovação de produção.

**Rollback:** reverter PR #16; sem efeito sobre dados porque nenhuma migração ou serviço NextCRM foi aplicado.
