# RC98 — Permissão SQL por requisição, sem liberar o PostgreSQL globalmente

**Motivo comprovado no Railway (17/11/2026):** RC95 recebeu um POST assinado de homologação no Field, mas `POST /api/clients` respondeu 503. Logs da API com `sqlState=25006` demonstraram que `db/raw.ts` mantém `default_transaction_read_only=on` para toda a homologação quando `CISNE_STAGING_READ_ONLY=true`. Esse é um controle independente do HTTP, e não deverá ser retirado.

## Proposta técnica (somente código/CI neste PR)

O `stagingBoundaryError` executa a validação RC95 e grava no `AsyncLocalStorage` da solicitação corrente somente a decisão booleana, ator, caminho, método, instante de emissão e expiração. Um SQL writer separado, de **no máximo uma conexão** (`maxUses=1`), só pode ser escolhido se a capacidade local existir, referenciar exatamente o ator RC95, a janela ainda estiver ativa e o request tiver menos de 10 segundos. Caso contrário, a `Pool` principal mantém `-c default_transaction_read_only=on`; nenhuma flag de ambiente, por si só, muda isso. `db/uat-pool-policy.mjs` concentra a decisão para testes sem DB.

### Isolamento / condições para implantação

1. Projeto, ambiente, serviço, ator sintético e origem privada continuam fixos. HMAC de cookie + HMAC temporário em `x-cisne-rc95-uat`, rotas explicitamente permitidas e `CISNE_STAGING_READ_ONLY=true`.
2. Requisições GET, anônimas, produção, outras rotas, expiradas e sem HMAC devem continuar sempre no SQL read-only. Nenhum domínio público.
3. **Prova de concorrência é obrigatória:** como `AsyncLocalStorage.enterWith` mantém o contexto até a próxima transição async, testes Node não substituem prova de isolamento real no runtime Cloudflare Worker. Proibir promoção sem avaliação de possível propagação de escopo entre fetch events, pooling e trabalho assíncrono. Uma alternativa mais forte seria uma capacidade explícita passada de `requestContext` ao adaptador transacional ou um proxy com autenticação e conexão própria, caso seja detectado vazamento de contexto.
4. Jamais aplicar no projeto de produção. O banco Field HML `cisne_rc89_field` é lógico e compartilha cluster físico com RC75, mas tem usuário sem privilégios administrativos. Recusar ao primeiro 503/25006 ou divergência de ledger.
5. O novo executor RC96 no PR #93 foi compilado com CI 6/6, mas o run real falhou no primeiro POST. Antes de repetir, auditar zero registros do ator de UAT com SELECT, gerar novos IDs sintéticos e abrir uma janela nova de no máximo 10 min.
6. Ao concluir ou falhar, **limpar** as quatro variáveis RC95, restaurar o Function probe e zerar as seis referências RC96, sem deixar exceção ativa. Verificar readiness HTTP 200 e POST anônimo 403; o backup pós-UAT deve ser restaurado em outro servidor com novo ID.

## Restrições

Sem novos volumes ou serviços, sem custo de assinatura, sem acesso a dados reais, sem desligar o readonly global, sem alteração de produção. **Este PR é Draft e NÃO é autorização para UAT escrita:** precisa de CI verde no commit exato, revisão do comportamento do Worker e ensaio negativo primeiro. Não vender sucesso de CI como prova de escrita no Railway.

Incidente: [Issue #95](https://github.com/rphllljust/teste/issues/95). Dependências: [PR #92](https://github.com/rphllljust/teste/pull/92), [PR #93](https://github.com/rphllljust/teste/pull/93), [PR #94](https://github.com/rphllljust/teste/pull/94).
