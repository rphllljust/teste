# CISNE — Faturamento com contabilização automática opt-in

Status da implementação: PR em validação; **não presume homologação ou implantação**.

O comando existente de faturamento da medição aprovada passa a reconhecer automaticamente a receita somente quando uma regra de contabilização do proprietário da OS está explícita e ativa. A regra é mantida na API nativa `GET/POST /api/accounting/posting-rules` e no workspace contábil, com conta debitada de ativo a receber e conta creditada de receita, versionamento, chave idempotente e auditoria. Sem regra ativa o faturamento segue criando fatura e recebível, mas não cria lançamentos artificiais. A ativação não contabiliza dados históricos retroativamente.

Com regra habilitada, **a mesma transação PostgreSQL** cria o título a receber, a fatura, o diário contábil publicado com duas partidas equilibradas, o vínculo imutável com origem e versão da regra, o evento financeiro auditável e o recibo de idempotência. Uma falha em qualquer etapa reverte todas as inserções. O lock financeiro é adquirido antes dos locks de dados, para serializar alterações de regra, fechamentos de período e faturamentos concorrentes. O lançamento usa a data UTC de reconhecimento gerada pelo servidor, separada da data de vencimento do título.

O contrato exige contas ativas de mesma propriedade e naturezas `asset` (débito) e `revenue` (crédito), valor inteiro positivo compatível com PostgreSQL, ausência de competência fechada e medição no estado `approved`. O replay de `order_events` devolve a fatura e o diário anteriores; outra chave sobre a mesma medição já faturada recebe conflito.

A migração `0019_native_invoice_posting_rules` é aditiva: cria regras, acrescenta modo de contabilização e versão da regra aos vínculos `accounting_invoice_links`, sem converter vínculos manuais anteriores nem modificar registros transacionais. A conciliação diferencia automaticidade efetiva, vínculo manual e faturas pendentes, incluindo estornos.

**Limites explícitos:** não contabiliza pagamentos/baixas, despesas de compras, estoque, impostos, ajustes de competência ou documentos fiscais manuais. O escopo legado permanece baseado no proprietário; a migração transversal para `tenant_id`/filial e o isolamento por RLS são trabalhos posteriores. O fiscal continua interno/manual, sem transmissão externa. Somente CI com PostgreSQL descartável, staging e UAT autenticada podem fundamentar uma decisão de produção; o verde no CI não substitui restore real.
