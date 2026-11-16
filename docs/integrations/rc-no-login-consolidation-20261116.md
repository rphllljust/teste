# RC integrado Field + NextCRM + Financeiro — sem login novo

## Origem e composição (SHA imutável)

- Base: PR #76 `db19590158e979bda93e063e886f8c1e4e51abf7` — possui ownership estrito, UAT transacional, linha documental do NextCRM e guard de ambiente.
- Portabilidade controlada: dez arquivos alterados no PR #77 `e6c3651a2aabdf9c8c8fcda859480a92d78f2231` — verificação de prontidão PostgreSQL, identidade pública fail-closed e respectivos testes.
- Não haverá merge de PRs #73/#74/#75/#76/#77 durante esta validação. O branch candidato é descartável e separado dos PRs originais.
- Complemento: ampliação da suíte de integração do NextCRM já existente para exercitar handlers financeiros reais (recebimento parcial, replay idempotente, reversão, período fechado e negativas por ator), **na mesma OS com vínculo documental privado HMAC**.

## Limites de escopo

Nenhum novo login, cadastro de usuário, SSO, OIDC, senha, sessão empresarial, onboarding ou permissão anônima será criado nesta onda. Os testes usam `setTestIdentity` (WeakMap vinculado ao Request dentro de `NODE_ENV=test`) e PostgreSQL 16/18 descartável em CI. A política de produção continua sem confiar em `oai-authenticated-user-id` de um request público.

O Frontend CISNE e a UI documental NextCRM permanecem em sua integração atual, não são substituídos por um NextCRM independente. O CRM de origem retém sua própria persistência; o Field conserva OS, ledger e vínculos privados.

## Aceite técnico

1. `quality`, `Full application source and build`, `Domain invariants`, PostgreSQL 16, PostgreSQL 18 e PostgreSQL-only todos SUCCESS no **HEAD exato** deste candidato.
2. Nova prova de cadeia em uma mesma OS com cliente e documento mapeados, HMAC verificado, sem URL de storage nem segredo no JSON público; fatura e recebível reais; mudança e restauração de saldo por baixa/estorno; período fechado bloqueando retroatividade.
3. Atores distintos e `owner_id IS NULL` não veem OS nem valores; nenhum comando negado gera baixa, estorno ou evento indevido. Registros legados ficam fisicamente preservados.
4. Próximo gate, ainda **não demonstrado** por este PR: deploy em staging isolado exatamente neste SHA, verificação independente de origem HTTPS e banco correto, smoke HTTP/API, Playwright desktop/mobile, vínculo documental privado e restore de dados/MinIO.
5. Não mexer nas variáveis ou nos volumes do Railway agora. Produção continua NO-GO: sem `DATABASE_URL` confirmada no serviço `teste` e sem provedor de identidade empresarial verificado. Nunca liberar escrita anônima como solução provisória.

## Critério para promoção futura

Somente consolidar em release após branch atualizado com a main real, CI verde, Railway staging no mesmo SHA/digest, catálogo e ledger sem drift, teste real navegador/backend e evidência de backup/restore. Não considerar sucesso de build ou healthcheck `/` como aceite operacional.

## Railway RC78: diagnóstico interno de prontidão

A inspeção do primeiro candidato em staging confirmou `/api/health/ready=503` antes do aceite. O PR adiciona apenas **categoria sanitizada de falha nos logs privados** (`MIGRATIONS_INCOMPLETE`, `TABLES_INCOMPLETE`, `DB_QUERY_FAILED`, ou SQLSTATE de uma lista fechada), limitada a uma vez por minuto por instância. A resposta pública continua somente `ready` ou `unavailable`. Não aplicar migrações no UAT nem trocar o banco antes de classificar o bloqueio.
