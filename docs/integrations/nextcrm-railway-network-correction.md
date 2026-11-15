# CISNE + NextCRM — correção do isolamento de rede Railway (15/11/2026)

## Causa técnica verificada

Railway Private Networking permite que `<service>.railway.internal` seja resolvido **somente** entre serviços no **mesmo projeto e ambiente**. Fontes: documentação oficial Railway, `https://docs.railway.com/networking/private-networking` e `https://docs.railway.com/networking/private-networking/how-it-works`.

Antes, ERP e NextCRM estavam preparados em **projetos diferentes**:
- ERP `genuine-renewal/staging`;
- NextCRM `nextcrm-hml-isolado/staging` (patch `cdfec4e5-1e02-4005-a8e5-5cfd46eef466`).

Essa separação inviabilizava a ponte baseada em `http://nextcrm-web.railway.internal:3000`. O HMAC autentica pedidos, mas não cria rotas entre redes isoladas.

## Correção efetivamente preparada

No projeto existente do ERP, **`genuine-renewal/staging`**, foram criados **somente como staged-create** cinco novos serviços NextCRM (web, postgres, minio, jobs e gateway) e quatro volumes privados persistentes (web data, postgres data, MinIO e Inngest). Os nomes, IDs, mounts e escopo constam em [`config/nextcrm-staging-topology.json`](../../config/nextcrm-staging-topology.json). **Patch:** `bea8daee-e9af-47f2-ba65-afbda8505afd`.

O patch tem **13 alterações, nenhuma destrutiva**; os cinco serviços permanecem **sem fonte/imagem**, nenhum container foi inicializado, nenhum volume foi provisionado, não há DNS público ou migrations. Em especial, o serviço `nextcrm-web` **não** aponta para a imagem original sem a extensão HMAC. **NÃO executar `accept-deploy`** nessa configuração incompleta.

Os serviços preexistentes `Postgres` (banco ERP) e `cisne-web-staging` foram preservados. A `production` do ERP fica na branch `main` original sem modificação.

O PostgreSQL do NextCRM continua **separado** do PostgreSQL do ERP, embora ambos estejam no mesmo projeto/ambiente para permitir networking privado. Não compartilhar DATABASE_URL, schema, volume nem migrações entre os dois bancos.

## Patch anterior — NÃO aplicar

O projeto `nextcrm-hml-isolado` ainda tem o patch antigo somente em `STAGED`, com serviços, volumes e um bucket S3 `nextcrm-documents` redundante. A ferramenta Railway disponível não conseguiu remover esse bucket ainda não provisionado. **O patch antigo não foi implantado nem excluído neste procedimento.** Ele deve ser descartado pelo controle de staged changes da plataforma quando esse recurso estiver disponível; até lá, mantenha-o sem aplicar.

## Sequência obrigatória para concluir preparação

1. Publicar imagem **customizada** do NextCRM com rota privada compilada, sob tag imutável/digest, com aprovação explícita. O CI do PR #18 hoje apenas compila imagem **efêmera** e não publica. Confirmar disponibilidade da imagem no registro.
2. Configurar fontes/image tags aprovadas e variáveis privadas **separadas por serviço** no novo projeto/ambiente; jamais copiar as credenciais do banco ERP para o banco NextCRM.
3. Confirmar backups testados e restore dos dois PostgreSQL e do volume de arquivos MinIO; verificar migrações do NextCRM em um ensaio descartável antes de entrar no staging.
4. Preparar URL de login e envio de OTP real, `BETTER_AUTH_SECRET`, `EMAIL_ENCRYPTION_KEY`, `MINIO_PUBLIC_ENDPOINT`, DNS/TLS e integração Inngest. O frontend precisa ser acessível por usuário; o endpoint documental HMAC deve continuar privado.
5. Fixar imagem/digest e configuração, dar autorização específica para aceitar o patch de staging (pode criar custos). Testar NextCRM real com usuário ativo, conta com `external_ref` correspondente ao ERP e documento vinculado.
6. Conferir que `cisne-web-staging` mantém 403 de forma segura para ingress não autenticado. Integrar somente por contexto de identidade confiável; nunca liberar APIs empresariais aceitando header `oai-authenticated-user-id` do cliente.
7. Não executar merge/deploy em produção até reconciliar dados, aprovar UAT, desabilitar deploy automático da main e ensaiar rollback.

## Gate de integridade do inventário

O script `node scripts/verify-nextcrm-staging-topology.mjs` verifica que a topologia versionada mantém ERP e NextCRM no mesmo projeto/ambiente, nomes privados, volumes independentes e patch antigo bloqueado. O teste `scripts/verify-nextcrm-staging-topology.test.mjs` contém negativos de regressão. **É um gate de configuração versionada, não substitui a consulta Railway em tempo real**.

## Gate público separado do aplicativo interno

A aplicação `nextcrm-web` deve permanecer **sem domínio público**, aceitando a rede Railway privada para chamadas ERP e reverse proxy. O único serviço previsto com domínio público é `nextcrm-gateway`; sua imagem Caddy customizada é definida em `integrations/nextcrm-public-gateway/`.

O gateway responde `404` a `/api/internal` e `/api/internal/*` sem consultar o backend. As demais rotas são encaminhadas para `nextcrm-web.railway.internal:3000`. Ele também remove os cabeçalhos `X-Cisne-Bridge-*` em chamadas públicas. Esse bloqueio de caminho é **defesa em profundidade**: o endpoint protegido continua a exigir assinatura HMAC válida e autorização documental no próprio NextCRM.

Apenas preparar a fonte/imagem e **testar a topologia após deploy** autoriza usar essa rota. Não atribuir domínio público diretamente ao `nextcrm-web` e não ativar o gateway sem verificação de TLS, X-Forwarded-Proto, sessões/OTP, limites e bloqueios de API privada.

## Gateway readiness independente

O Caddy responde `GET /__gateway-health` com HTTP 200 e corpo `ready` **sem encaminhar requisições ao NextCRM**. No Railway, configurar `healthcheckPath=/__gateway-health` para o serviço `nextcrm-gateway`. Isso comprova somente que o proxy está ativo, **não** que NextCRM, banco, OTP ou a ponte estejam funcionais. Um segundo healthcheck/UAT deve testar o fluxo via proxy com o NextCRM ligado.
