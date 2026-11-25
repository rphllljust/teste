# CISNE — Fechamento financeiro com prova de origem contábil

Escopo: regra de segurança empresarial para `POST /api/finance/periods/close` e para aprovações de `finance_period_close`, aplicadas no mesmo lock financeiro do ator.

Antes de inserir o fechamento no PostgreSQL, o ERP verifica as faturas **pertencentes ao proprietário da OS** e criadas na competência solicitada. A competência só pode ser fechada se cada fatura possuir vínculo contábil imutável com diário publicado, não estornado, de mesma propriedade e efetivado na própria competência, com totais de débito e crédito iguais ao faturamento. Uma fatura sem reconhecimento de receita comprovado ou com estorno impede o fechamento (HTTP 409, `FINANCE_CLOSE_BLOCKED`). Nenhum registro de fechamento ou aprovação é persistido quando a verificação reprova.

A API autenticada `GET /api/finance/periods/preflight?periodStart=YYYY-MM-DD&periodEnd=YYYY-MM-DD` apresenta quantidade e valor de faturas bloqueadoras, no escopo do usuário. O resultado é apenas prévia: a decisão final executa novamente a verificação sob lock transacional, impedindo sucesso baseado em consulta desatualizada.

O estorno de um diário vinculado a fatura cuja competência já esteja fechada retorna HTTP 409 `ACCOUNTING_CLOSED_ORIGIN`, mesmo quando a data sugerida para o estorno estiver em competência futura. Isso evita invalidar silenciosamente um período consolidado. Correções após fechamento exigirão fluxo empresarial específico de reabertura ou ajuste de competência, ainda não implementado; portanto, o bloqueio é deliberadamente conservador.

Não há integração externa de SEFAZ/município. O fiscal permanece interno/manual. O sistema ainda não reconcilia automaticamente pagamentos, contas a pagar, estoques, bancos e impostos para a declaração completa de fechamento contábil Tier 1. As evidências de CI com PostgreSQL descartável e de staging não equivalem a aceite financeiro de produção.
