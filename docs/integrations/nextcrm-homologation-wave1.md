# NextCRM ↔ Field — homologação operacional da onda 1

Esta onda adiciona um endpoint autenticado de prontidão para separar três estados
que não podem ser confundidos:

1. infraestrutura online;
2. integração habilitada no staging;
3. integração homologável, com migração aplicada e mapeamentos aprovados.

Endpoint: `GET /api/integrations/nextcrm/readiness`.

A resposta nunca contém segredo, UUID de usuário/conta, cookie, URL privada ou
conteúdo documental. Ela expõe somente flags, contagens e bloqueadores técnicos.
Em produção e fora do ambiente `staging`, a integração permanece desabilitada.

O endpoint não declara UAT concluído. Para chegar a `ready:true`, ainda é
necessário executar o ciclo real autorizado:

`cliente → oportunidade → proposta → ordem de serviço → documento NextCRM → medição → faturamento`.

Critério desta onda:

- `enabled:true` somente com URL HTTPS externa aprovada e ambiente staging;
- `ready:true` somente com as quatro tabelas da ponte, identidade ativa e conta ativa;
- ausência de migração ou mapeamento retorna bloqueadores explícitos;
- segredo é validado por formato/presença, sem ser retornado;
- produção e URLs com porta 3000, query, fragmento ou URL privada ficam bloqueadas.
