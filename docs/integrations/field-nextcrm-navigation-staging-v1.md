# Field ↔ NextCRM — navegação integrada v1 (Railway staging)

## Objetivo entregue nesta fase
O Field permanece aplicação principal e fonte de verdade para clientes contratuais,
propostas/PO, ordens de serviço, execução e lançamentos empresariais.
O NextCRM mantém o módulo de relacionamento (leads, oportunidades e contatos).

A navegação adiciona:
- Field: acesso ao CRM na barra lateral, barra superior e contexto "Clientes e propostas"
- NextCRM: acesso de retorno ao Field pelo cabeçalho (previsto no PR da imagem NextCRM)
- Ambos: HTTPS externo do Railway, sempre em nova aba, sem porta 3000

**Não se trata de SSO, replicação/sincronização de registros ou unificação de banco.**
Cada app mantém autenticação, RBAC, proprietário e dados independentes.
O usuário poderá ter que entrar novamente no NextCRM, mesmo tendo aberto o ERP.

## Contrato de habilitação sem risco de produção
O endpoint do Field `GET /api/integrations/nextcrm/navigation` só expõe
`{enabled:true,href:"https://nextcrm-gateway-staging.up.railway.app/en"}`
quando **ambas** as condições de runtime forem verdadeiras:
- `RAILWAY_ENVIRONMENT_NAME=staging` (fornecido pelo Railway)
- `CISNE_NEXTCRM_PUBLIC_URL=https://nextcrm-gateway-staging.up.railway.app`

Qualquer ausência, porta 3000, URL privada, query, sufixo, credencial embutida,
ou ambiente de produção devolve `enabled:false,href:null`.
Não há endpoints de proxy, CORS, redirecionamento arbitrário ou passagem de tokens.
O menu só é mostrado quando o endpoint retorna a URL exata permitida.
Respostas `no-store` e falhas do CRM nunca impedem a operação do Field.

## Deploy e testes
1. Executar CI da branch derivada do SHA exato do Field em staging
   `c4777a755b0b7d4ec6b25707b0fd037c1ddea3e1`.
2. Confirmar o PR altera apenas UI, rota de leitura, testes, CSS e documentação.
3. No Railway **staging somente**, adicionar `CISNE_NEXTCRM_PUBLIC_URL` exato.
4. Trocar a origem de `cisne-web-staging` para o commit aprovado, fixando o SHA,
   somente com autorização de deploy de staging. A production `teste/main` fica intacta.
5. Confirmar que o menu só aparece no staging e abre o CRM na URL HTTPS externa;
   confirmar que o Field funciona mesmo quando o CRM está offline.
6. No NextCRM, após publicar a imagem corrigida pelo SHA revisado, confirmar
   que o link "Field · ERP" aparece para usuários autenticados apenas no staging.
7. Validar manualmente os dois logins. Sem identidade compartilhada nesta fase.

## Para integração de dados (fase seguinte)
Antes de vincular leads/oportunidades a clientes e ordens, é obrigatório
validar mapeamento estável ERP client ID ↔ NextCRM account ID por tenant,
principal autenticado nas duas pontas, autorização negativa entre tenants,
contrato idempotente, persistência e backup. Não usar email ou título da OS
como identificador de vínculo. Não acessar diretamente DB ou cookies de outro app.
A ponte documental HMAC existente é objeto de PR separado; não é pública.
