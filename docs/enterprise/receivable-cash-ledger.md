# CISNE ERP — Reconhecimento de recebimentos no razão

## Implantação progressiva

Esta etapa adiciona uma segunda regra contábil nativa e **opt-in** (`sourceType=receivable_receipt`), independente da regra de faturamento (`invoice_billing`). A configuração atribui conta de débito de caixa/banco e conta de crédito de clientes a receber, ambas próprias, ativas e classificadas como ativo. O sistema obriga a seleção de contas diferentes, com versionamento, controle de concorrência e evento de auditoria. Como contas de caixa/banco e clientes pertencem ambas ao ativo, a configuração deve identificar corretamente a semântica de cada conta; o ERP valida também que a conta creditada corresponde à conta debitada no reconhecimento da fatura.

Na baixa de um recebível, sob lock financeiro do proprietário e em competência aberta, o CISNE registra a baixa e, quando a regra está ativa, o diário de duas partidas equilibradas (**D caixa/banco / C clientes**), vínculo persistido de origem e auditoria na mesma transação PostgreSQL. Se a regra estiver ativa e o faturamento não tiver lançamento contábil válido, a baixa inteira falha com `CASH_RECEIPT_ORIGIN_UNRECOGNIZED`; a API não fabrica origem. Se a regra estiver desativada, a baixa financeira legada continua sem lançar diário, explicitamente informada como `not_enabled`. Não há backfill.

Estornar baixa que possua lançamento automático publica, no mesmo commit, um diário `reversal_of` com partidas inversas, um novo vínculo imutável e auditoria. A regra ativa atual pode ter sido desabilitada desde então: **o estorno preserva a obrigação de desfazer o lançamento histórico**, usando as contas e a versão efetivas do diário original. Baixas históricas sem vínculo permanecem sem contabilização automática. O estorno é bloqueado se a competência original estiver fechada; correções pós-fechamento exigirão outro fluxo empresarial e não devem alterar silenciosamente um razão fechado.

Os estornos manuais pelo endpoint genérico de diários são bloqueados para lançamentos com origem em baixa. A receita da fatura não pode ser estornada enquanto houver recebimentos não estornados que dependam dela. Os vínculos de baixa não permitem `UPDATE` ou `DELETE`.

A API de conciliação `GET /api/accounting/receipt-reconciliation` devolve os eventos financeiros do proprietário, a cobertura de lançamentos, eventos históricos sem diário e valores líquidos financeiros/contábeis. Um evento financeiro legado sem lançamento **não** é apresentado como contabilizado. O workspace contábil exibe ambas as políticas e os indicadores.

## Proteção de produção

A migração `0020_receivable_cash_ledger` expande a restrição de tipos de regra sem perder as existentes e cria exclusivamente uma tabela de vínculos, índice e trigger. Não muda retroativamente faturas, baixas ou as 36 tabelas de origem da migração D1.

Este estágio não constitui conciliação bancária externa, baixa automática por extrato, contabilização de fornecedores, impostos, estoque, custos, filiais ou contabilidade multiempresa com RLS. O fiscal permanece manual e interno. Não ativar a política sem configurar contas corretas e homologar em staging com dados sintéticos, PostgreSQL 16/18, restore e fluxos reais. Nenhuma evidência de CI por si só autoriza implantação em produção.
