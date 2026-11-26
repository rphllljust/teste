# CISNE ERP Tier 1 — Homologação em navegador real e gate de produção

**Escopo:** testar a aplicação já publicada em Railway `staging`, sem criar outro serviço, banco ou volume. O navegador roda apenas no executor GitHub Actions. O teste é **somente leitura**, exceto a criação de uma sessão de homologação pelo endpoint de login; não registra dados de clientes, pedidos, faturamento ou contabilidade.

## Execução automática no PR

Workflow: `.github/workflows/cisne-hml-live-acceptance.yml`.

Quando o script ou workflow mudarem, o GitHub Actions instala uma versão fixa do Chromium e percorre o novo módulo `Dossiês empresariais` em **1440×900, 768×1024 e 390×844**. Faz requisições HTTP reais ao Staging e valida:

- Carregamento da aplicação e da página de Dossiês empresariais.
- `GET /api/enterprise/journeys` sem sessão retorna HTTP **403**, sem registros.
- Tentativa de identidade por headers públicos forjados continua retornando **403**.
- `GET /api/enterprise/journeys/:id` sem sessão retorna **403**.
- Captura imagens **somente antes de autenticar**; nenhuma informação empresarial autenticada é salva em screenshot ou logs.

**Este teste público NÃO significa homologação funcional.** O resultado `HML_AUTHENTICATED_NOT_EXECUTED` e o veredito `PARTIAL_PUBLIC_ONLY_OR_NO_DATABASE_FIXTURE` são classificados como **NO-GO para produção**, ainda que a job tenha sucesso.

## Execução autenticada por operador autorizado

O mesmo workflow aceita acionamento manual (`workflow_dispatch`), com `require_authenticated=true` por padrão. Para executar sem expor a credencial:

1. Um operador autorizado deve provisionar **somente** a passphrase de homologação em um mecanismo de segredo criptografado e controlado pelo executor, denominado `CISNE_HML_LOGIN_PASSPHRASE`, observando a política de segredos da organização.
2. Não copiar para GitHub código, artefatos, logs ou inputs de workflow os segredos `CISNE_STAGING_LOGIN_HASH`, `CISNE_STAGING_SESSION_SECRET`, `CISNE_STAGING_ACTOR_ID`, o `DATABASE_URL` nem cookies.
3. Executar o workflow manual exigindo `require_authenticated=true`; ausência ou falha de credencial causa **FAIL**, e nunca é convertida em sucesso silencioso.
4. Com sessão válida, o Chromium verifica a resposta PostgreSQL autenticada, a paginação, o modelo documental e, se houver uma OS autorizada, recupera um dossiê e confronta o ID e as **14 etapas** e a origem de valores.
5. Se não houver OS de teste cadastrada para o ator HML, a execução pode validar a lista vazia, mas o fluxo documental real permanece **não comprovado** e o veredito de homologação completa continua NO-GO.

A passphrase jamais deve ser enviada em URL, parâmetros de workflow ou mensagem de commit. Recomenda-se rotacionar a credencial após qualquer concessão temporária ao executor. O login de homologação de operador único não equivale a RBAC multiempresa de produção.

## Gate de promoção

- **G0/G1:** commit exato, TypeScript, ESLint, Knip auditado e build.
- **G2/G3:** PostgreSQL 16/18, migração repetida, teste integrado do processo comercial ao razão e restauração.
- **G4:** navegação real autenticada em desktop/tablet/mobile e isolamento entre atores; as imagens públicas sozinhas não satisfazem G4.
- **G5:** backup de produção com restauração verificada, correspondência da conexão PostgreSQL e plano de rollback.
- **G6:** revisão explícita das mudanças staged do Railway Production, deploy controlado, digest/commit idêntico e smoke pós-deploy.

Em 26/11/2026, o Railway Production tem **nove alterações pré-existentes não aplicadas**, incluindo a adição de `DATABASE_URL`, alteração do comando de startup, migration e healthcheck. É proibido aceitar esse patch sem validar previamente a conexão, o backup e o destino dos dados. O merge da PR #311 na `main` e o deploy bem-sucedido no Staging **não** satisfazem, por si, esses gates.
