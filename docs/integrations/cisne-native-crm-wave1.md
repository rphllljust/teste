# CISNE CRM nativo — onda 1: Leads e Oportunidades (2026-11-15)

## Sem segunda aplicação, sem iframe, sem troca de banco
Esta onda substitui a entrada de menu "CRM comercial" (link externo) por
**CRM e Vendas**, uma tela renderizada diretamente pelo Field em React.
Há cadastro/qualificação de leads, vínculo opcional a cliente ERP existente,
criação de oportunidades, funil de propostas/negociações e estados ganha/perdida.

A camada de negócio usa o PostgreSQL já integrado ao Field, com duas novas
tabelas de registros e uma tabela de recibos idempotentes. Não cria outro
serviço, não grava no banco NextCRM e não inventa que os registros do NextCRM
foram importados. O antigo NextCRM no Railway continua preservado como
sistema legado/serviço isolado durante a transição.

## Contrato de integridade
- A identidade provém exclusivamente de `requestContext`; nunca do payload.
- Toda consulta e escrita é escopada por `owner_id`.
- A conexão lead→cliente ERP e oportunidade→lead é reforçada por FK
  composta `(owner_id,id)` no PostgreSQL, além da checagem na aplicação.
- Transições usam `expectedVersion` e bloqueiam saltos, reabertura e
  alterações obsoletas.
- A mesma `key` com o mesmo payload é replay idempotente; outra identidade
  ou payload recebe 409.
- Operações e recibo são gravados numa única transação.
- Valores monetários são inteiros de centavos, apresentados em BRL.
- Os limites de listagem (100) são explícitos; contagens são exatas.
- O endpoint não publica token, e-mail do usuário autenticado nem IDs de outro
  proprietário. CRM fechado com `403` no staging público.
- Não há sync silencioso com NextCRM, SSO, OAuth, ou replicação de dados.

## Migração
`drizzle-pg/0001_native_crm.sql` é aditiva: nova indexação composta para
clientes e novas tabelas CRM. A migração 0000 original não é alterada.
`scripts/migrate-postgres.mjs` usa ledger e lock transacional para executar
cada migração uma única vez; uma falha executa rollback completo.
Nenhuma tabela antiga é excluída ou sobrescrita.

## Testes e aceite
- Rodar TypeScript, ESLint e build do Field no commit exato.
- Rodar `pnpm db:migrate` em PostgreSQL descartável, seguido de
  `pnpm test:integration`, incluindo `crm.test.ts`.
- Verificar 403 contra identidade forjada no staging; não afrouxar a proteção.
- Verificar replay, versionamento, isolamento entre proprietários, ligação
  real com cliente do ERP, pipeline de estágios e FKs no PostgreSQL.
- Na UI: selecionar CRM e Vendas sem abrir aba nem domínio; ver estados de
  carregamento, erro de acesso, listas e funil. Não exibir números falsos
  quando o backend recusar acesso.

## Bloqueios conscientemente preservados
A implantação em staging público **não habilita CRUD**: o guard atual
`stagingBoundaryError` continua retornando 403 mesmo para headers forjados.
É obrigatório ter autenticação e gateway de identidade verificável antes de
homologação humana com registros reais. O build não prova uso empresarial.
Sem autorização específica, não executar a migração em DB persistente nem
afetar produção. O CRM legado mantém sua própria autenticação/banco e os
seus dados não entram automaticamente no CRM nativo do CISNE.

## Próximas ondas de integração
1. Autenticação confiável no Railway (gateway/session/tenant), com testes
   negativos e sem confiar em header público.
2. Mapeamento explícito, revisável e idempotente de Accounts/Leads do NextCRM
   para registros do CISNE, com quarentena de duplicados e métricas.
3. Conversão autorizada de oportunidade→proposta do Field, com registro de
   origem, regras comerciais e teste ponta a ponta até ordem de serviço.
4. Anexos e histórico pela ponte documental privada HMAC já existente,
   mantendo ACL por usuário/tenant.
5. UAT e observabilidade antes do cutover para domínio único; production NO-GO
   até restauração de backup testada e aceite de negócio.
