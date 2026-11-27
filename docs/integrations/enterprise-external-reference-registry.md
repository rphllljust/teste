# Registro de referências externas empresariais

Esta frente cria o primeiro ponto de integração transversal do CISNE ERP. Ela não importa, replica ou presume dados de uma fonte externa. Apenas registra uma referência fornecida pelo usuário, vinculada a um tenant e, quando aplicável, a uma unidade empresarial.

## Fluxo implementado

1. Um membro autorizado cria uma referência por `POST /api/enterprise/tenants/:tenantId/external-references`.
2. O payload guarda sistema, identificador externo, URL da fonte, rótulo da fonte, nome do responsável informado e CNPJ normalizado.
3. O estado inicial é sempre `pending_review`; nenhum registro é tratado como verificado automaticamente.
4. A leitura é isolada ao tenant e permite filtrar por objeto e estado.
5. A chave de comando e a combinação tenant/sistema/identificador tornam o retry idempotente.
6. O evento de permissão e o comando de negócio preservam correlação e auditoria.

## Aplicação ao cadastro fornecido

O cadastro fornecido pelo usuário pode ser registrado como uma referência da fonte `cnpj.biz`, usando o identificador `11897171000181`, o nome informado `Abrahim Jabour Junior` e a URL original. O ERP deve manter o estado `pending_review` até que um usuário autorizado confira a razão social, a unidade empresarial e a correspondência com o tenant.

Não há transmissão fiscal, emissão financeira, alteração de produção ou criação automática de cliente nesta etapa.
