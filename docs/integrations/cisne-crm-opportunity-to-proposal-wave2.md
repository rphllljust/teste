# CISNE CRM nativo — Onda 2: oportunidade -> proposta ERP (2026-11-15)

## Escopo implementado
A operação `createDraftProposal` da API `/api/crm` converte **uma oportunidade
na etapa Proposta** em **uma proposta de rascunho no ERP Field**, sem abrir
outro domínio e sem importar dados do NextCRM legado. A ação exige:
- sessão autenticada do dono da oportunidade;
- versão exata da oportunidade (`expectedVersion`);
- lead previamente qualificado e **cliente ativo do ERP vinculado**;
- escopo declarado pelo operador, data válida não anterior ao dia atual no
  fuso de Porto Velho e valor estimado positivo até R$ 100.000;
- comando com UUID de idempotência e UUID para a nova proposta.

O contrato comercial do Field armazena preço e total com **quatro casas
decimais**. Um único item de rascunho (quantidade 1) representa o valor
estimado, sem alegar que há detalhamento contratual ou aceite.
Proposta, item, origem e recibo idempotente são gravados na **mesma
transação**. O comando não emite a proposta, não registra aceite, não cria
contrato/PO ou OS, e não avança automaticamente o estágio comercial.

## Integridade reforçada no banco
A migração aditiva `drizzle-pg/0002_crm_proposal_origin.sql` cria índices
compostos `(owner_id,id)` em oportunidades e propostas e a tabela
`crm_opportunity_proposals` com:
- uma proposta por oportunidade (PK composta owner/opportunity);
- uma única origem por ID de proposta (UNIQUE);
- referências compostas de proprietário para **ambos** os lados;
- comando originador único e timestamp.

Nenhum registro existente é modificado pela migração; o migrador mantém
ledger e lock transacional e pode rodar novamente de maneira idempotente.
Não há mudanças no banco NextCRM.

## Contrato de consulta e interface
`GET /api/crm` inclui `proposalId` e `proposalStatus` para cada
oportunidade com vínculo. O funil interno do Field apresenta
`Gerar proposta` somente em etapa Proposta com cliente vinculado e sem
proposta anterior. A janela solicita escopo e validade, confirma que cria
apenas um rascunho e apresenta o identificador de origem após recarga.

## Gate de testes
No commit exato, CI deve comprovar:
1. migrações 0000, 0001, 0002 aplicadas duas vezes sem duplicação;
2. cliente inexistente, inativo ou de outro proprietário bloqueado;
3. etapas incorretas, versão obsoleta, validade passada bloqueadas;
4. conversão válida com totais corretos em escala ×10⁴;
5. retry do mesmo UUID idempotente, novo UUID para mesmo negócio rejeitado;
6. dados e vínculos isolados por proprietário em GET/POST e FKs;
7. build, TypeScript, lint e demais testes de handlers existentes verdes.

## Limites declarados
A interface de propostas herdada (`ProposalsWorkspace`) usa rotas como
`/api/proposals`, que não existem na base atual; esta onda **não afirma**
que emissão, revisão, aceite, PO ou OS estejam operantes. A etapa seguinte
é implementar/readaptar as rotas de propostas e seus comandos, com
testes reais e regras do domínio já existentes, antes de UAT.

Acesso de HML continua sendo um piloto de operador único por cookie assinado,
não SSO multiusuário. A produção não deve receber este PR até que o fluxo
inteiro seja homologado, RBAC empresarial implementado e backup/restore
verificados. O deploy também executa `pnpm db:migrate`; exigir revisão
explícita da migração antes de aplicá-la ao PostgreSQL persistente.
