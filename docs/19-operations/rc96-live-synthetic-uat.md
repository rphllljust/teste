# RC95–RC96 — Janela sintética de escrita real no Railway, sem volumes novos

**Projeto:** `genuine-renewal` · **Ambiente:** `staging` · **Alvo:** `cisne-rc85-ephemeral-erp` e banco lógico `cisne_rc89_field` no PostgreSQL 18 já persistente.

## Ativos existentes e plano de mudança

O RC94 comprovou backup de **48 tabelas, 7 migrações** e restauração em outro serviço PG18, mantendo SHA-256 e registro sintético. O Field tem readiness HTTP 200, APIs de leitura autenticadas e isolamento de produção. Não criar outro volume/serviço nem alterar os bancos legados e NextCRM RC84.

Usar **PR #92** antes de executar a função revisada neste PR. O modo `CISNE_STAGING_READ_ONLY=true` permanece sempre ligado. Somente POSTs assinados duas vezes, com HMAC de sessão + segredo RC95 independente e expiração curta, têm exceção. Iniciadores e mudanças de permissão devem ser auditáveis; não desligar globalmente o readonly. O source de execução está em `ops/railway-functions/rc96-synthetic-finance-uat.mjs`, com CI **compile-only**, que nunca executa requests em CI.

### Guardrails antes de iniciar

1. Validar **HEAD exato** e CI do PR #92 (testes negativos do gate HMAC), e revisão deste PR do runner.
2. Verificar Railway staging sem patches e status `SUCCESS` de Field, PostgreSQL18, NextCRM RC84 e runner de backup; produção `teste` deve estar no deployment aprovado. Field sem domínio público.
3. Confirmar fonte RC95 já implantada no Field, com `CISNE_STAGING_READ_ONLY=true`, e **quatro variáveis temporárias** `CISNE_RC95_UAT_ENABLED`, `CISNE_RC95_UAT_ACTOR_ID`, `CISNE_RC95_UAT_SIGNING_KEY`, `CISNE_RC95_UAT_UNTIL_MS`. Duas credenciais distintas, sem registrar os valores. Expiração programada em até 10 minutos.
4. Runner reutiliza **somente** `rc86-erp-private-readonly-health-probe` (sem volume), apontando exclusivamente para `cisne_rc89_field` pelo segredo `RC96_FIELD_DATABASE_URL`. As variáveis `RC96_ACTOR_ID`, `RC96_SESSION_SECRET` e `RC96_WRITE_SIGNING_KEY` são referências ao serviço Field e RC95, não strings nos logs.
5. Exigir **zero clientes e zero ordens da identidade sintética** antes da primeira escrita, sete migrations e lock advisory. Um rerun sobre dados existentes deve falhar sem duplicar registros.
6. Enviar requisições apenas à origem **privada** `cisne-rc85-ephemeral-erp.railway.internal:8080`; autenticação por cookie HMAC mais assinatura HMAC com método, rota, nonce e timestamp. Nunca divulgar cookies, DSN, payloads ou chaves.

### Trilha empresarial de uma mesma OS

O runner exercita, na aplicação do Railway, cadastro de cliente sintético, abertura de OS, autorização, início, conclusão, medição de 12 unidades, aprovação, faturamento (valor escalado 120000), criação de recebível, baixa parcial de 25000, replay idempotente, estorno e confirmação de saldo 120000. O runner grava somente no novo banco Field de homologação. Não usa cliente real, e não executa fechamento global do período financeiro para não bloquear futuras homologações.

**Falta propositalmente** o elo real de documento NextCRM/S3 na mesma OS, que requer fixture independente RC97 com ACL e rollback/limpeza de objetos. O CI de regressão RC91 prova esse fluxo de documento em PostgreSQL e MinIO descartáveis, mas não substitui o Railway.

### Reversão e evidências

- O runner é *one-shot*. Qualquer falha deixa o modo readonly global ativo e imprime um código de etapa, sem segredos. Evidência de sucesso: `RC96_LIVE_SAME_OS_SYNTHETIC_FINANCE_PASS`.
- Remover RC95 UAT mode, expiração, assinaturas e credenciais do probe imediatamente após a execução; restaurar o probe HTTP não autenticado original.
- Reimplantar Field com pré-deploy padrão RC86/RC89, verificar HTTP 200 e 403 anônimo e POST normal.
- Preservar no volume de backup existente cópias de recuperação com novos IDs após o ensaio; não sobrescrever RC94.
- **Nenhum merge de produção** enquanto UAT dos documentos reais e aceite empresarial estiverem pendentes.

Este protocolo prevê custo adicional de **zero volumes e zero serviços**; consumo de recursos durante as execuções continua sujeito à tarifação normal Railway. Executar apenas com infraestrutura já existente.
