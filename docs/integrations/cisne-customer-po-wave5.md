# CISNE — Onda 5: pedido do cliente (PO) a partir de proposta aceita

## O que é
PO neste módulo é **pedido do cliente recebido** após aceite comercial
da proposta; não é a ordem de compra de fornecedor (`procurement`).
O registro preserva a origem, o cliente do ERP, a referência informada e
a data real de recebimento. O Field apresenta a PO sem abrir um segundo
aplicativo.

## Contrato implementado
- `GET /api/purchase-orders`: lista com busca, status, proposta de
  origem e paginação, isolada por proprietário autenticado.
- `POST /api/purchase-orders`: exige UUID, proposta aceita do mesmo
  proprietário, versão exata, referência não duplicada para a mesma
  proposta, data de recebimento válida e não futura e cliente ativo.
- `GET /api/purchase-orders/[id]`: detalhe, contexto da proposta e
  histórico auditável; cancelamento só aparece se não houver contrato.
- `POST /api/purchase-orders/[id]/commands`: cancelamento exige motivo
  de 3 a 500 caracteres, versão e ausência de qualquer contrato vinculado.
- `ProposalsWorkspace`: volta a exibir a aba de PO e o comando de
  registro em uma proposta aceita, com transição ao detalhe da PO.

## Propriedades de segurança e integridade
A criação exige apenas um registro de aceite **declarado** com
`evidence_reference` preenchido; a referência não é uma assinatura
verificada automaticamente. O servidor não cria PO de rascunho,
proposta emitida não aceita, cancelada ou de outro proprietário.

A escrita usa uma única transação PostgreSQL para o comando idempotente,
verificação do pai com bloqueio `FOR UPDATE`, inserção da PO e recibo.
Uma referência duplicada para a mesma proposta é rejeitada enquanto
todos os escritores utilizarem esse bloqueio. Não existe índice UNIQUE
de referência na migração inicial; outros escritores no banco exigem
governança adicional.

Cancelamento de PO bloqueia a própria linha `FOR UPDATE` e rejeita
se existir qualquer contrato relacionado. O registro de contratos,
ainda não implementado nesta onda, deverá obter o mesmo bloqueio e
revalidar o estado registrado para evitar corrida.
Não há geração automática de contrato nem ordem de serviço.

## Aceitação
1. CI completo verde: TypeScript, lint, build, invariantes e PostgreSQL
   real em ambiente descartável.
2. Integridade aceita/versão/cliente ativo, rejeição de proprietário,
   data futura, referência duplicada e replay diferente.
3. Detalhe, paginação e histórico corretos; operações anônimas no
   staging continuam HTTP 403.
4. Cancelamento negado após vincular contrato; recibos mantêm versão e
   estado real, sem criação de ordens de serviço.
5. Sem migrações nesta onda. A migração 0002 do PR #26 continua
   pendente em banco persistente até backup e restore comprovados.

## Pendências
O módulo de contratos exige API própria e regras de autorização
empresarial. A conexão PO→OS precisa de vínculo imutável de origem,
autorização operacional e validações de contrato, capacidade e data.
A antiga base NextCRM não foi importada. Produção permanece NO-GO.
