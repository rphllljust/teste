# Inventário de rotas empresariais — CISNE

Base: `main@0834d252`  
Fonte: `app/page.tsx`  
Escopo: cobertura automatizada e documentação; nenhuma rota ou API nova.

O contrato `test/enterprise-route-inventory.contract.test.mjs` verifica que
cada entrada abaixo permanece representada pelo shell e pelo dispatcher atual.

| Grupo | Entradas existentes |
|---|---|
| Início e operação | Visão operacional; Field Service Cockpit; Resource Planning Board; Ordens de serviço; Execução; Medições |
| Comercial e relacionamento | CRM e Vendas; Clientes e propostas; Propostas e PO |
| Contratos e suprimentos | Contratos; Compras; Estoque e compras |
| Recursos e logística | Frota e ativos; Profissionais |
| Financeiro e controladoria | Faturamento; Visão financeira; Financeiro; Fluxo de caixa; Tesouraria; Contas a pagar; Caixa e conciliação; Fiscal e tributos; Contabilidade; Razão contábil; Fechamentos |

## Regras

- Não adicionar entrada sem implementação existente no dispatcher.
- Não criar rota, endpoint ou mock para satisfazer o contrato.
- Renomeações devem atualizar o teste e registrar compatibilidade no mesmo PR.
- Rotas de API são inventariadas separadamente; esta frente cobre entradas do shell.
