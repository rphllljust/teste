# NextCRM ↔ CISNE — minimização dos dados enviados ao navegador

## O que este PR altera
O painel de documentos do CISNE continua a usar a rota autenticada `GET /api/orders/:id/documents`, cuja implementação já revalida a autorização atual do documento no NextCRM por HMAC. A rota de download existente `GET /api/orders/:id/documents/:linkId/file` permanece inalterada, incluindo ACL, assinatura, SHA-256 e limite de 8 MiB.

A listagem autorizada expõe **somente**:
- `id`: identificador do vínculo local no banco do CISNE (usado no download).
- `kind`: espécie do documento.
- `version`: versão da evidência previamente vinculada e revalidada.
- `sha256`: hash corroborado pelo NextCRM, ou `null`.
- `linkedAt`: data da criação do vínculo.

O identificador opaco do objeto no NextCRM (`nextcrm_document_id`) fica **exclusivamente no servidor**. A aplicação não precisa dele no JavaScript do navegador: o download recebe `linkId` local, e o servidor identifica o recurso remoto mediante proprietário, conta, tenant, versão e autorização revalidada.

## Por que fazer isso antes da consolidação

O PR #42 já implementou o fluxo documental físico com ACL/HMAC e o PR #43 corrigiu um 404 da ficha da OS. O antigo PR #58 foi encerrado por duplicar a UI e por listar apenas mapeamentos locais sem consultar a ACL atual do documento no NextCRM. Sua branch foi preservada como evidência histórica, mas **não deve ser incorporada**.

Esta alteração acrescenta um limite explícito ao contrato público sem alterar arquitetura, banco, dados ou configuração do Railway.

## Aceite exigido

1. A saída pública do GET não inclui `documentId`, `nextcrm_account_id`, `tenantKey`, credenciais nem URL assinada de S3.
2. A lista continua retornando apenas links cuja ACL é revalidada no upstream.
3. O download via proxy e o SHA-256 continuam funcionando com o `linkId` local.
4. O teste de integração `nextcrm-public-document-contract.test.ts` passa, além do CI completo no SHA exato.
5. O staging é homologado em desktop e mobile, inclusive acesso revogado, sessão anônima, vínculo cruzado e erros 401/403/404.
6. Nenhuma promoção de PR ou mudança do Railway é automática. A outra linha financeira mantém seu patch e suas migrações isolados.

## Limites

Sem OIDC/SSO, sem migração de dados reais, sem banco unificado, sem imports de NextCRM em lote. Dados de teste fictícios existentes continuam intactos.
