# RC97 — Vínculo documental real na mesma OS do Field (homologação)

**Escopo:** próxima frente após RC96, sem publicação de domínio, plano novo ou volume adicional. Apenas `staging` do projeto `genuine-renewal`.

A regressão RC91 já comprovou com NextCRM RC84 OCI imutável, Postgres17, MinIO e handlers Field reais o caminho OS → documento → financeiro em ambiente descartável. No Railway, o bucket RC84 foi testado de forma independente (PUT/GET/presigned URL/DELETE com SHA256) e o Field RC89 possui 48 tabelas, sete migrações e readiness 200.

## Alteração de segurança

Este PR, empilhado sobre RC95, habilita mais **uma** rota de mutação sob o mesmo header HMAC temporário e sessão assinada: `POST /api/orders/{UUID}/documents`, exigindo UUID canônico, sem query string. A entrada exige `key` (UUID/idempotência), `nextcrmDocumentId` (3–128 caracteres permitidos), `documentKind`, `version` e `sha256` opcional; não aceita URL privada, tenant, ator ou S3 key do navegador. Os demais endpoints seguem protegidos. O acesso público e produção continuam NO-GO.

## Sequência de UAT (ainda não executada neste PR)

1. Reusar **a mesma OS sintética** gerada pelo RC96, consultando-a por owner sintético e título exato. Recusar se houver zero ou múltiplas OS, se a assinatura RC95 expirou ou se o OS pertence a outro ator.
2. No banco NextCRM PostgreSQL17 isolado RC84, criar usuário, conta e documento sintético com credenciais próprias e objeto PDF privado com hash verificado no bucket já existente. Nunca usar dados reais.
3. No banco Field `cisne_rc89_field`, criar correspondências **verificadas** de identidade/conta com `instance_key=rc84_isolated_hml`, `active=true`, aprovadas por operador/runner autorizado. Rejeitar tenant incorreto e account mismatch.
4. Usar `POST /api/orders/{OS_RC96}/documents` com sessão HMAC e header UAT para persistir somente o vínculo; repetir com a mesma chave e exigir `200` idempotente, sem segundo vínculo.
5. Exigir `GET /api/orders/{OS_RC96}/documents` com exatamente um item permitido; recuperar bytes via `GET /api/orders/{OS_RC96}/documents/{linkId}/file`, confirmar SHA256 e ausência de URL presigned, chaves ou dados de tenant nos objetos da API.
6. Revogar ACL de conta/documento **sintéticos** no NextCRM RC84; exigir que o vínculo deixe de aparecer e que novos downloads pelo Field retornem `404`; revalidação do ticket S3 já emitido limita-se ao TTL de até 60 segundos.
7. Fazer limpeza do documento S3 e das contas sintéticas. Metadados de auditoria imutável do Field devem permanecer; não deletar registros de ledger de negócio. Encerrar janela RC95 e limpar segredos.

**Aprovação de produção:** exige evidências reais do RC96 e RC97 no Railway, recuperação pós-UAT, testes de repetição/ACL e aceite empresarial. Este PR não executa SQL, S3 nem torna o Field gravável sozinho.
