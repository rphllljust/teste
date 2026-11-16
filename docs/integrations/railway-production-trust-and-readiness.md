# Gate de produção — identidade confiável e prontidão real

Atualização: 2026-11-16. Este documento descreve o candidato de hardening
empilhado sobre PR #76. Nenhuma alteração automática de produção é autorizada.

## Falha observada na auditoria

O serviço público Railway `genuine-renewal/production/teste` estava online no
commit `4d8ea2b`, mas sem `DATABASE_URL`; chamadas empresariais sem identidade
retornaram 401 e `GET /` retornou 200. O adaptador PostgreSQL exige
`DATABASE_URL` para executar qualquer consulta.

Além disso, o contrato histórico de identidade aceita o header
`oai-authenticated-user-id` quando não está em staging/teste. No ambiente
Sites esse header é responsabilidade de uma camada de despacho confiável;
num domínio Railway diretamente acessível **o cliente pode forjá-lo**.
A inexistência de conexão com o banco não mitiga essa classe de falha.

## Decisão de segurança enquanto login/SSO está fora do escopo

- Toda API empresarial em Railway **não staging** retorna HTTP 503
  `RAILWAY_TRUSTED_IDENTITY_REQUIRED`; não aceita header público como prova.
- Staging continua exigindo cookie firmado e identidade validada pelo servidor.
  Preview read-only continua negando mutações no HTTP e no PostgreSQL.
- Testes de CI usam identidade sintética vinculada à instância Request e
  PostgreSQL descartável; isso **não autoriza login anônimo de produção**.
- A integração documental NextCRM continua HMAC privada, sem URLs S3 no browser.
- A futura integração de um provedor real deve substituir o fail-closed por
  verificação criptográfica do ator/tenant no edge, com auditoria e autorização
  por recurso; o header do navegador jamais será aceito sem prova.

## Readiness distinta de liveness

`GET /api/health/ready` responde:
- `503 NOT_READY` se DATABASE_URL não existe ou confiança de identidade
  Railway não staging está ausente.
- `503 SCHEMA_NOT_READY` se objetos centrais de OS, recebíveis, baixas,
  fechamento ou documento ERP não constam no catálogo PostgreSQL.
- `503 DATABASE_UNAVAILABLE` para conexão/consulta indisponível.
- `200 READY` só após consulta real, sem retornar credenciais ou dados.

Este gate **não** substitui UAT, auditoria de migrações, avaliação de ACL
NextCRM, backup-restauração, testes de execução, Playwright ou aceite comercial.
A rota faz leitura do catálogo; não executa DDL, migração ou seed.

## Ordem de promoção

1. Verificar HEAD exato do PR #76 e deste candidato; CI TypeScript,
   segurança, PostgreSQL 16/18, restore e handlers completos.
2. Validar o endpoint em staging isolado, confrontando status e logs no SHA
   implantado. Registrar read-only e deny de identidade forjada.
3. Em produção, **não** apenas ligar DATABASE_URL: exige provedor de
   identidade realmente confiável ou manter operação negada.
4. Depois de arquitetura de identidade aprovada, fazer backup/restore,
   configurar origem/banco corretos e validar readiness + testes operacionais.
5. Só trocar a configuração de healthcheck do Railway para
   `/api/health/ready` quando a instância tiver a política de identidade
   e as dependências apropriadas. Até lá o deployment não é um GO.
6. Confirmar SHA de commit, frontend e APIs, métricas de serviço, ações
   financeiras, anexos e possibilidade de rollback sem escrever no banco
   de origem durante ensaios.
