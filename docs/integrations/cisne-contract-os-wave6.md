# CISNE — Contratos vinculados e criação controlada de OS (onda 6)

## Implementado
- `GET /api/contracts`: consulta paginada por proprietário, situação,
  referência e empresa; totais reais de OS abertas para cada contrato.
- `POST /api/contracts`: registro de contrato em rascunho a partir de
  proposta aceita e versionada, cliente ERP ativo, referência única pelo
  fluxo da API e PO opcional que precisa estar registrada e pertencer à
  mesma proposta/cliente/proprietário.
- `GET /api/contracts/[id]`: detalhe com termos, cliente verdadeiro,
  histórico de comandos, números de OS e habilitação de criação de OS
  somente quando contrato e cliente estão ativos.
- `POST /api/contracts/[id]/commands`: revisão de rascunho, ativação com
  referência declarada de assinatura, cancelamento de rascunho e
  encerramento de contrato ativo sem OS abertas.
- `POST /api/orders`: quando existe `contractId`, executa
  **bloqueio de linha FOR SHARE no contrato na mesma transação do INSERT
  da OS e de seu evento**, impedindo a corrida com encerramento de
  contrato, que bloqueia a mesma linha `FOR UPDATE`.

## Política de autorização
Nenhuma OS é criada automaticamente por venda, PO ou aceite. A
`ContractsWorkspace` possui botão explícito "Criar ordem de serviço"
somente em contrato ativo com cliente ativo. O endpoint exige identidade
autenticada, `clientVersion`, `contractVersion`, dono, vínculo do
cliente, estado do contrato, dados válidos e chave de ordem idempotente.

A ativação exige cliente ativo, proposta com aceite registrado, e PO
registrada quando vinculada. A referência de assinatura é declarada por
um operador; **não é assinatura digital validada automaticamente**.

A PO com contrato vinculado não pode ser cancelada pelo comando da onda
anterior, independentemente de o contrato estar draft, active ou closed.
Criar contrato e cancelar PO obtêm o mesmo bloqueio na PO, assim a
verificação de cancelamento não concorre com uma nova vinculação.

O contrato é bloqueado ao criar uma OS vinculada ou ao encerrá-lo;
somente um desses eventos contraditórios pode ser confirmado, mesmo
quando as requisições são simultâneas.

## Limites e próximos gates
- Não foram adicionadas tabelas nesta etapa; são usadas as estruturas
  existentes de `contracts`, `service_orders` e `order_events`.
- Duplicidade de referência e PO é rejeitada pelos escritores da API,
  serializados no bloqueio da proposta. Ainda não foi adicionada
  constraint UNIQUE em contratos para escritores externos ao fluxo.
- O serviço NextCRM legado permanece separado e sem migração de dados.
  O Field renderiza o módulo contratos no seu próprio workspace.
- O cancelamento/encerramento depende de nenhuma OS aberta; o fluxo de
  gestão de estados da OS continua sujeito às próprias APIs e UAT.
- Não usar para produção até RBAC/SSO empresarial, revisão de trilha
  de evidências, backup/restore e homologação ponta a ponta.

## Aceite mínimo
1. CI TypeScript, lint, build e testes contra PostgreSQL descartável
   no SHA exato.
2. Proposta aceita → PO registrada → contrato draft → ativação →
   OS criada com dono/cliente/contrato corretos e evento histórico.
3. 403 para cabeçalhos de identidade falsificados em staging;
   404 para outros proprietários; 409 para versões desatualizadas,
   PO cancelada, referências duplicadas e OS em contrato encerrado.
4. Idempotência de contrato e OS com retry sem duplicação.
5. Encerramento rejeitado com OS aberta e liberado após conclusão,
   preservando referência declarada de assinatura e versão.
6. Patch Railway só poderá ser aplicado após prova de backup/restauração
   do volume PostgreSQL de staging, inclusive migração `0002`
   das etapas anteriores. Nenhum deploy de produção nesta PR.
