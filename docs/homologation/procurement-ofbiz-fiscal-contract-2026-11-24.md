# Homologação de Compras, OFBiz e Fiscal — Staging

## Escopo

Diagnóstico realizado no serviço `cisne-web-staging` do ambiente Railway `staging`, sem criação de integração externa e sem alteração de dados produtivos.

## Compras e OFBiz

O centro de compras usa os contratos internos persistidos:

- `GET /api/procurement`: fila paginada, filtros e resumo de pedidos.
- `GET /api/procurement/:id`: Object Page do pedido, linhas e recebimentos.
- `POST /api/procurement`: cadastro de fornecedor ou pedido em estado `draft`.
- `POST /api/procurement/:id/commands`: comandos de aprovação/cancelamento com versão e idempotência.
- `POST /api/procurement/:id/receipts`: recebimento parcial ou integral com conciliação de estoque.
- `GET /api/erp/ofbiz?resource=health|suppliers|products|purchase-orders|inventory`: adaptador externo OFBiz.

### Causa exata do bloqueio OFBiz

As variáveis obrigatórias não existem no serviço Railway Staging:

- `OFBIZ_BASE_URL`
- `OFBIZ_SERVICE_TOKEN`

O adaptador valida as duas variáveis no carregamento e responde `OFBiz não configurada no ambiente` sem executar `fetch`. Portanto, o ambiente suporta a jornada interna de compras, mas não pode declarar sincronização Apache OFBiz.

### Jornadas de compras homologáveis sem OFBiz

Podem ser homologadas com os dados persistidos internos:

1. Criar fornecedor interno.
2. Criar pedido em `draft`.
3. Aprovar pedido com controle de versão.
4. Registrar recebimento parcial ou integral.
5. Consultar a conciliação de estoque e os documentos de recebimento.
6. Cancelar pedido elegível.

Não podem ser declaradas homologadas:

- consulta de fornecedores/produtos no OFBiz;
- importação ou exportação de pedidos para o OFBiz;
- sincronização de estoque externo.

## Fiscal

Contratos existentes:

- `GET /api/fiscal/documents`: consulta paginada por competência, busca e situação.
- `POST /api/fiscal/documents`: registra documento manual com validação, vínculos e auditoria.
- `GET /api/fiscal/documents/:id`: consulta detalhe e eventos persistidos.
- `POST /api/fiscal/documents/:id` com `command=cancel`: cancela somente documento manual registrado, sujeito ao período financeiro aberto.

Jornadas fiscais homologáveis sem transmissão externa:

1. Registrar documento manual de entrada, saída, serviço, recibo ou outro.
2. Vincular documento a cliente, contrato, OS, faturamento, recebível ou obrigação quando os IDs existirem e pertencerem ao mesmo contexto.
3. Consultar detalhe, origem e histórico de auditoria.
4. Cancelar documento manual registrado com justificativa.
5. Filtrar por competência, número/cliente e situação.

Limites explícitos:

- Não existe transmissão para SEFAZ ou prefeitura.
- Não existe autorização fiscal externa.
- Não existe emissão de documento fiscal eletrônico.
- O sistema deve continuar exibindo a advertência manual em todas as respostas e telas fiscais.

## Veredito

Compras internas e fiscal manual são homologáveis em Staging com dados fictícios persistidos. OFBiz e transmissão fiscal externa permanecem `BLOCKED_EXTERNAL_DEPENDENCY`, sem fallback silencioso e sem sucesso simulado.
