# Railway staging — acesso seguro ao CRM nativo do Field (piloto)

## Contexto e objetivo
O Field publicado no Railway tem um guard deliberado: APIs em staging
rejeitam headers públicos de identidade com HTTP 403. Não é seguro afrouxar
esta proteção para demonstrar o CRM nativo.

Este piloto introduz um único **operador técnico de homologação**, não um
sistema completo de identidade de produção. ERP e CRM nativo compartilham
o mesmo cookie HTTP-only verificado pelo servidor e o mesmo contexto de
proprietário, de forma que o usuário usa apenas a interface do CISNE.

## Credenciais exclusivamente no Railway staging
Definir no serviço `cisne-web-staging`, ambiente `staging`:
- `CISNE_STAGING_PUBLIC_ORIGIN=https://cisne-web-staging-staging.up.railway.app`
- `CISNE_STAGING_ACTOR_ID`: identificador estável não sensível do operador,
  usado apenas para filtrar seus registros do ERP/CRM.
- `CISNE_STAGING_LOGIN_HASH`: SHA-256 hex de uma senha **aleatória de pelo
  menos 32 caracteres e alta entropia**; nunca usar senha humana curta.
- `CISNE_STAGING_SESSION_SECRET`: segredo HMAC aleatório e independente de
  pelo menos 32 bytes; nunca compartilhá-lo com o usuário.

Não definir estas variáveis no ambiente de produção nem gravá-las no GitHub.
O acesso somente é disponibilizado quando
`RAILWAY_ENVIRONMENT_NAME=staging` e a origem pública HTTPS exata bate.

## Propriedades verificáveis
1. Cookie `__Host-cisne_staging`: Secure, HttpOnly, SameSite=Lax, Path=/,
   Max-Age 8 horas e sem atributo Domain.
2. Payload assinado via HMAC-SHA256, nonce aleatório, expiração, iat e
   identificador do operador. Assinaturas comparadas em tempo constante.
3. O guard do staging apenas permite chamadas com cookie validado; headers
   forjados `oai-authenticated-user-id` e `x-cisne-dispatch-secret`
   permanecem ignorados em staging.
4. Login aceita exclusivamente POST da origem HTTPS fixa, valida JSON,
   aplica limite de tamanho, exige chave de alta entropia, não imprime o
   segredo nem registra tentativas com dados pessoais.
5. O cookie é emitido após comparação do SHA-256 da chave com o hash
   configurado, em tempo constante; o segredo HMAC nunca chega ao cliente.
6. A sessão é escopada a um ator fixo do staging e não substitui RBAC ou
   autenticação individual de produção.

## Advertências e próximas exigências
- Este é um **acesso HML de operador único** para homologar o CRM nativo,
  não SSO com NextCRM e não um login de produção.
- O login não incorpora rate limit distribuído, revogação individual,
  auditoria de login por usuário ou MFA. Não usar em produção. Fazer
  rotação periódica de HMAC/credencial e restringir acesso no Railway.
- A interface só confirma o CRM após requisições GET/POST reais com cookie;
  não fabricar dados quando o backend recusa autenticação.
- Antes de ativar no Railway, exigir build e testes de assinatura, replay,
  origem maliciosa, identidade forjada e isolamento de proprietário com
  PostgreSQL real; staging apenas, SHA exato e rollback disponível.
- Para escala real, implementar provedor OIDC/SSO com isolamento por tenant,
  RBAC e trilha de auditoria. O NextCRM legado permanece separado até
  migração de dados revisada por operador.
