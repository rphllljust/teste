# CISNE — Ciclo de vida das propostas (onda 4)

## Escopo desta implementação
A interface existente de Propostas do Field deixa de oferecer ações
fictícias e passa a falar com a rota real
`POST /api/proposals/[id]/commands` para:

- `revise`: em rascunho, altera dados e linhas, recalcula valores exatos;
- `issue`: transita rascunho vigente para emitida, desde que cliente
  ainda esteja ativo e a soma das linhas seja igual ao total do documento;
- `accept`: aceita somente proposta emitida vigente; exige referência
  informada pelo operador, sem presumir verificação externa ou assinatura;
- `reject`: rejeita somente proposta emitida vigente;
- `expire`: somente proposta emitida cujo `valid_until` seja anterior
  à data comercial corrente no fuso `America/Porto_Velho`;
- `cancel`: permitido em rascunho ou proposta emitida; estado terminal.

A consulta `GET /api/proposals` e o detalhe `GET /api/proposals/[id]`
expõem somente os comandos realmente implementados e liberados para o
estado atual. O comando `revision` permanece oculto, assim como o
registro/consulta de PO. Não há emissão automática, ordem de serviço
automática nem sincronização com o NextCRM legado.

## Propriedades de integridade
Cada comando exige UUID de idempotência, versão esperada (rowVersion),
actorId do `requestContext` e pertence ao dono da proposta. O servidor
reserva o comando, bloqueia a linha de proposta `FOR UPDATE`, valida
estado/versão/data, executa a transição e grava recibo na mesma transação.
Retries exatos retornam recibo; payload alterado ou proprietário diferente
é rejeitado. Os estados terminais não podem voltar ao rascunho.

Edição do rascunho verifica cliente ativo, substitui as linhas de preço na
mesma transação e só confirma se o domínio calcular um valor exato dentro
do limite de inteiro PostgreSQL. Emissão confere novamente a soma das
linhas contra o total, evitando documento divergente.

O aceite armazena **referência declarada** em `evidence_reference`, não
prova assinatura eletrônica nem autentica o cliente. É necessário
complementar com evidência documental e fluxo de aprovação empresarial.

## Critérios de aceite
- TypeScript, ESLint e build verdes no HEAD.
- Execução real contra PostgreSQL descartável de rascunho/revisão,
  emissão/aceite, rejeição, cancelamento, expiração e falhas de estado.
- Acesso interproprietário em comandos retorna 404.
- Retry idempotente mantém versão; comandos diferentes com versão antiga
  não confirmam alterações; emissão simultânea deve gerar sucesso único.
- Rejeitar aceite com referência vazia, validade vencida ou rascunho não
  emitido; não aceitar alteração após aceite.
- `availableCommands` deve corresponder ao estado persistido; nenhum
  botão de PO/revisão pode redirecionar a endpoint ausente.
- Nenhuma alteração no banco NextCRM; staging apenas após comprovação
  de backup e decisão específica sobre migração pendente 0002.

## Bloqueios restantes
Revisões comerciais (nova versão), contratos, recebimento formal de PO,
aceite externo e geração de ordens de serviço precisam de suas próprias
regras, testes e gates. O piloto HML usa um operador único por cookie
assinado; não é SSO empresarial multiusuário.

**Veredito de produção: NO-GO** até restore comprovado, homologação de
fluxo ponta a ponta e autenticação/segregação empresarial adequada.
