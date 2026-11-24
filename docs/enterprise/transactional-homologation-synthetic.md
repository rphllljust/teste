# Homologação transacional sintética

## Escopo

Esta frente valida a coerência das jornadas sem gravar dados no banco, chamar APIs ou declarar sucesso de integrações externas. Os cenários sintéticos servem como pré-gate para os testes de integração existentes.

## Jornadas cobertas

| Jornada | Evidência sintética | Teste real existente | Dependência externa |
| --- | --- | --- | --- |
| Financeiro → Medição → Faturamento → Recebível | Identidade, origem e valor preservados entre os quatro objetos | `test/integration/field-service-measurements.test.ts`, `test/integration/billing-receivables.test.ts`, `test/integration/finance-settlements.test.ts` | Nenhuma para o contrato interno; transmissão fiscal não é simulada |
| Compras → Recebimento | Requisição, pedido e recebimento mantêm a origem e o valor | `test/integration/customer-po.test.ts` | OFBiz deve estar configurado para homologação externa |

## Execução segura

```bash
node --test test/enterprise-transactional-journeys.synthetic.test.mjs
pnpm lint --quiet
```

Os testes sintéticos são obrigatórios antes da execução dos testes com `DATABASE_URL`. Os testes de integração existentes continuam sendo a autoridade para persistência, autorização, idempotência, concorrência, auditoria, liquidação e estorno.

## Critérios de aceite

1. Medição só pode originar faturamento quando aprovada.
2. Faturamento deve preservar a ordem e a medição de origem.
3. Recebível deve preservar a fatura de origem.
4. Valores devem permanecer consistentes entre os objetos da jornada.
5. Pedido deve preservar a requisição de origem.
6. Recebimento deve preservar o pedido de compra.
7. Falha de vínculo deve reprovar o pré-gate.
8. Nenhum teste pode tratar transmissão fiscal, OFBiz ou outro serviço externo como concluído sem resposta real.

## Sequência de homologação em Staging

1. Executar o pré-gate sintético.
2. Executar os testes reais de medição, faturamento e recebíveis com banco descartável ou isolado.
3. Executar o teste real de pedido de compra e recebimento quando o contrato de recebimento estiver disponível.
4. Validar os registros persistidos, auditoria e isolamento por identidade.
5. Validar as telas correspondentes no Staging, sem disparar operações irreversíveis.
6. Registrar separadamente `IMPLEMENTADO`, `INTEGRADO`, `IMPLANTADO` e `HOMOLOGADO`.

## Bloqueios que não devem ser mascarados

- Ausência de API contábil não deve ser preenchida com lançamentos fictícios.
- OFBiz não configurado impede declarar a jornada externa de compras concluída.
- Registro fiscal manual não equivale a transmissão à SEFAZ ou prefeitura.
- Dados sintéticos deste pré-gate não comprovam persistência no Railway.
