# NextCRM + ERP: mapa de integração de Pessoas, Documentos e Ordens de Serviço

## Inventário observado em 2026-11-15
- ERP (rphllljust/teste): a API /api/orders mantém service_orders e autenticação em requestContext; o modelo de OS inclui id, client_id, contract_id, status, version e owner_id.
- ERP: lib/domain/clients.ts define ClientRow com id, owner_id, documento, nome, email, telefone, status e row_version.
- NextCRM upstream (d3bead9b...): ações de documentos em actions/documents; create-document.ts cria documentos ligados opcionalmente a accountId e dispara evento Inngest document/uploaded.
- NextCRM: create-document-version.ts cria uma nova versão associada ao documento original e atualiza a referência do documento principal.
- NextCRM: get-documents-by-contactId.ts consulta vínculo por tabela DocumentsToContacts e verifica autorização de acesso.
- As ações citadas são Server Actions com contexto autenticado; não estão comprovadas como APIs públicas para consumo direto do ERP.

## Dono dos dados e identificadores
| Entidade | Dono proposto | Regra |
| --- | --- | --- |
| Clientes (pessoas jurídicas/físicas atendidas) | ERP | Não substituir client.id nem reimportar registros sem reconciliar unicidade e owner_id. |
| Ordens de serviço | ERP | service_orders.id é fonte da verdade; alterações seguem as transições existentes. |
| Contatos comerciais e oportunidades | NextCRM | Acessos e integração exigem contrato autenticado e mapeamento do cliente ERP. |
| Arquivos e versões de documentos | NextCRM | Documento e metadados guardados no storage/banco dedicado, sujeitos a ACL e validação. |
| Vinculação documento ↔ OS | Adaptador ERP, futura implementação | Associação por erpOrderId + nextcrmDocumentId + tenant/owner, sem duplicar o arquivo. |

## Contrato mínimo proposto (a implementar depois de testes)
- Link: { erpOrderId: UUID, erpClientId: UUID, nextcrmDocumentId: ID, ownerId: ID, kind: string, version: number, linkedAt: ISO timestamp }.
- Listar documentos da OS: GET autenticado por erpOrderId, sempre validando ownerId e autorização no ERP E no NextCRM.
- Upload: usar URL temporária de storage gerada no serviço documental; validar tipo, tamanho, hash, nome, quota e antivírus; depois registrar o vínculo.
- Download: autorização de usuário/empresa antes de URL curta e temporária. Não persistir links públicos permanentes.
- Remoção/desvinculação: manter trilha de auditoria, retenção legal e histórico de versões.

## Segurança e implicações
- Não compartilhar diretamente cookie, tabela users, auth secret, PostgreSQL nem storage entre aplicações.
- Não inserir clientId/ownerId do usuário sem validar vínculo servidor-servidor.
- Não sincronizar os mesmos registros bidirecionalmente sem estratégia de conflitos e idempotência.
- Não associar documentos a uma OS apenas pelo título ou por campos mutáveis; utilizar identificadores estáveis.
- Homologar ACL para cada grupo de usuário (cliente, técnico, gestor, administrador), com testes negativos.
- Não habilitar uploads ou AI enrichment contra dados reais até revisar credenciais, subprocessadores, retenção e LGPD.

## Critérios de aceite desta integração futura
1. Criar um documento para cliente de teste e encontrar somente na OS autorizada.
2. Usuário de outra empresa não vê nome, metadados, arquivo ou links do documento.
3. Anexar nova versão preserva histórico; arquivos e hash são verificáveis.
4. Falha de conexão NextCRM não apaga nem corrompe uma OS.
5. Repetir requisição idempotente não duplica vínculos.
6. Backup e recuperação recuperam metadados, arquivos, vínculos e auditoria.

## Situação real
Somente análise e documentação nesta branch. As APIs de integração, schema de links, uploads, autorização cruzada e testes E2E NÃO foram implementados.