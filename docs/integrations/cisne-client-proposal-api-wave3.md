# CISNE — APIs de Clientes e Propostas (Onda 3, 2026-11-15)

## Entrega

Este PR torna utilizável no Field staging uma parte da navegação comercial
que antes renderizava páginas React mas chamava endpoints ausentes.

- `GET /api/clients`: filtros, paginação e projeções isoladas por dono.
- `POST /api/clients`: registro de cliente com validação Zod, documento
  normalizado, recibo idempotente e transação PostgreSQL.
- `GET /api/clients/[id]`: detalhe do proprietário, ordens relacionadas e
  histórico real, sem filtrar por identificador de origem externo.
- `POST /api/clients/[id]/commands`: ativar/desativar/revisar,
  controle de versão otimista, transação, idempotência e isolamento.
- `GET /api/proposals`: listagem de propostas registradas no banco,
  com status, nome do cliente e paginação.
- `POST /api/proposals`: cadastro manual de proposta em rascunho com
  cliente ativo/versão verificados e linhas monetárias calculadas pelo
  domínio `proposalAmounts`, sem criar pedido ou OS automaticamente.
- `GET /api/proposals/[id]`: detalhe real com linhas, histórico, pedidos
  associados e origem de uma oportunidade nativa, quando aplicável.
- Funil CRM: rascunho convertido pela onda 2 abre na própria
  `ProposalsWorkspace`, sem nova aba ou domínio.

## Segurança e comportamento fail-closed

Todos os endpoints usam `requestContext` e restringem a identidade
pelo proprietário autenticado. No staging, cabeçalhos públicos forjados não
habilitam leitura ou escrita sem cookie validado. Histórico e detalhes não
incluem registros de outros proprietários. A mutação e o recibo idempotente
são gravados atomicamente, com 409 para comandos repetidos com payload
diferente e versões obsoletas.

Os botões de ações de emissão, aceite e registro de PO permanecem
**desabilitados**: suas rotas de comando empresarial ainda precisam de
implementação e homologação. Isso impede que a interface prometa ações
que resultariam em 404. Cadastros, consultas, vínculo CRM→proposta e
registros de rascunho não dependem desses comandos.

## Critérios de aceitação antes do Railway

1. GitHub: TS, lint, build, invariantes e testes de handlers contra
   PostgreSQL descartável aprovados no HEAD exato.
2. Registro manual cliente→proposta→detalhe, com valores em escala 10^4
   e bloqueio interproprietário real.
3. CRM→proposta via vinculação idempotente continua aprovado; não deve
   haver diferença em amount, origem ou permissões.
4. Os handlers que estiverem fora desta etapa devem estar visivelmente
   desabilitados, e não simular sucesso.
5. Sem migrações adicionais neste PR; a migração aditiva de origem da
   onda 2 permanece sujeita à revisão própria antes do deploy staging.
6. Produção `teste/main`, NextCRM e bancos legados inalterados.

## Próximas etapas

Implementar comandos de proposta (`issue`, `accept`, `reject`,
`cancel`, `revision`) e, em PR separado, contrato de PO/OS com
evidências e aceite, sem presumir que `won` seja autorização para criar
ordem de serviço. Depois validar RBAC multiusuário, auditoria e restauração
de backup. **CI verde não é aceite empresarial.**
