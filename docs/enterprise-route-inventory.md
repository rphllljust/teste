# Inventário de entradas empresariais — CISNE

Base de referência: módulo nativo da onda 5, descendente de `main`  
Fonte: `app/page.tsx` (navegação por hash)  
Escopo: inventário de navegação e integração com o dossiê empresarial autenticado (APIs próprias da onda 5).

O contrato `test/enterprise-route-inventory.contract.test.mjs` verifica as 26 entradas de navegação, sua ordem, os componentes de destino e a consistência com este documento. Ele roda no gate `quality` e na verificação da branch `main`. A verificação é estática e não substitui testes de APIs, autorização, persistência e fluxos ponta a ponta.

| Grupo | Entradas existentes |
|---|---|
| Início e operação | Visão operacional; Dossiês empresariais; Field Service Cockpit; Resource Planning Board; Ordens de serviço; Execução; Medições |
| Comercial e relacionamento | CRM e Vendas; Clientes e propostas; Propostas e PO |
| Contratos e suprimentos | Contratos; Compras; Estoque e compras |
| Recursos e logística | Frota e ativos; Profissionais |
| Financeiro e controladoria | Faturamento; Visão financeira; Financeiro; Fluxo de caixa; Tesouraria; Contas a pagar; Caixa e conciliação; Fiscal e tributos; Contabilidade; Razão contábil; Fechamentos |

## Regras

- Não adicionar entrada sem implementação existente no dispatcher.
- Novas APIs devem existir e exigir autenticação antes de qualquer acesso a dados; não criar endpoint ou mock decorativo.
- Renomeações devem atualizar o teste e registrar compatibilidade no mesmo PR.
- Rotas de API são inventariadas separadamente; esta frente cobre seletores de tela por hash, não rotas HTTP independentes.
- Mudanças no menu e no dispatcher devem passar em `pnpm test:route-inventory`.
