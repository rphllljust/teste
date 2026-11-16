# CISNE Field + NextCRM — onda 7: documentos de OS com autorização cruzada

## Situação e fronteiras reais
- Field: `cisne-web-staging` do Railway, código base do commit `8a166b2d`,
  PostgreSQL 18 e sessão HMAC **técnica** de staging, não SSO empresarial.
- NextCRM: aplicação separada `nextcrm-web` (Prisma, PostgreSQL 17
  com pgvector, MinIO próprio e Better Auth). A imagem customizada traz
  uma rota interna HMAC para autorização documental, implantada no
  serviço NextCRM, mas ainda é necessário verificar sua resposta real
  com uma identidade e documento autorizados.
- NextCRM Gateway Caddy público bloqueia `/api/internal/*` e jamais
  recebe headers de assinatura HMAC. A comunicação ERP -> NextCRM usa
  somente `http://nextcrm-web.railway.internal:3000`.
- Não se compartilham tabelas, tokens de usuário, cookies Better Auth,
  arquivos, credenciais de banco ou objetos S3.

## Implementação proposta
1. Migração Field `0003_nextcrm_document_bridge.sql`: duas tabelas de
   mapeamento de identidade e conta, ambas **inativas por padrão**, além
   de links de documentos da OS e eventos de auditoria imutáveis.
   Nenhuma entidade NextCRM real é importada e não há INSERT automático
   de contas nem usuários.
2. `POST /api/orders/[id]/documents`: recebe apenas UUID idempotente,
   identificador opaco de documento, categoria, versão e hash opcional.
   A identidade é derivada do `requestContext` do ERP, e a OS e cliente
   devem pertencer ao mesmo proprietário autenticado.
3. Os mapeamentos aprovados e ativos indicam *qual usuário NextCRM* e
   *qual conta NextCRM* correspondem aos registros ERP. A autorização
   final é uma resposta **HMAC-SHA256 assinada pelo NextCRM** contendo
   conta, documento, versão e digest, após o próprio NextCRM validar
   Better Auth, usuário ativo, acesso à conta e ACL do documento.
4. O registro idempotente grava somente metadados e um evento imutável
   na transação PostgreSQL, sem URL de arquivo. Retentativas idênticas
   não duplicam vínculos; eventos conflitantes retornam 409.
5. `GET /api/orders/[id]/documents`: antes de retornar metadados,
   confirma a OS proprietária e o estado atual das aprovações. Em cada
   documento reconsulta autorização NextCRM; documentos revogados são
   omitidos, erro de transporte ou assinatura invalida toda a resposta.
6. A ficha de OS do Field agora possui a seção colapsável
   **Documentos vinculados · NextCRM**, com consulta sob demanda e
   revalidação de ACL a cada abertura/atualização. A UI nunca mostra
   arquivos, links de download ou metadados de documento revogado.
7. O segredo `CISNE_NEXTCRM_BRIDGE_SECRET` deve ser um hex seguro e
   exclusivo para o staging, compartilhado entre os dois serviços por
   Railway Variables, nunca pelo navegador.

## Governança dos mapeamentos
- Não existe endpoint público para criar, editar ou ativar mapeamentos.
- Identidade ERP ↔ usuário NextCRM requer revisão por operador e prova
  de que ambos representam **a mesma pessoa**, sem confiar em UUID
  indicado pelo usuário da interface.
- Cliente ERP ↔ conta NextCRM requer verificação de CNPJ/identificadores
  no backend e do `external_ref` oficial na conta NextCRM, com
  proprietário, empresa, origem, revisor e data auditáveis.
- Mapeamento desativado retorna nenhum documento e não acessa
  NextCRM. Não permitir `ownerId`, `tenantKey`, URLs ou credenciais no
  payload HTTP.
- A instância NextCRM não garante tenant isolation nativo apenas pela
  variável `CISNE_NEXTCRM_INSTANCE_KEY`: as regras de autorização reais
  do NextCRM devem ser testadas com múltiplos usuários/contas.

## Gate antes de qualquer deploy do Field desta onda
- PR DRAFT, CI verde no HEAD exato com TypeScript, build, testes do
  contrato HMAC e integração PostgreSQL 16 e 18.
- **Novo backup do Postgres Field staging, seguido de restore em banco
  diferente, depois da UAT anterior.** A migração 0003 é diferente
  da 0002. `CISNE_DB_RESTORE_ATTESTATION_0003` deve conter ID de backup
  real, target separado, revisor, UTC recente, ID de migração
  `0003_nextcrm_document_bridge` e SHA-256 dos bytes do SQL.
  Sem isso, o migrador rejeita a implantação. O segredo/atestado não
  pode ser criado ficticiamente.
- Confirmar que o NextCRM atual realmente hospeda
  `POST /api/internal/erp-document-authorization` no hostname privado;
  verificar HMAC com usuário e conta/dados sintéticos no NextCRM
  PostgreSQL 17, prova de banimento e ACL negativa.
- Testar replay, divergência de hash, acesso estrangeiro, identidade
  desativada e revogação documental. Sem sucesso no NextCRM real,
  nenhum vínculo poderá ser ativado.
- Após aceite em staging: disponibilizar UI documental contextual da
  OS e testar upload, versões, download temporário, exclusão lógica,
  retenção e trilha com usuário real, incluindo backup de metadados
  **e** arquivos MinIO.

## Fora do escopo e bloqueios para integração integral
- O CRM nativo Field já possui leads, oportunidades, propostas, PO,
  contratos e OS; isso **não equivale** a sincronizar todos os contatos
  do NextCRM.
- Não existe SSO entre a sessão HMAC do Field e Better Auth do NextCRM:
  exigir provedor OIDC/SSO empresarial confiável, autorização por função,
  logout e revogação antes de produção. Não copiar cookies.
- Sincronização de contatos e contas precisa de contrato separado
  (mestre ERP, eventos assinados, versão, chave externa, idempotência,
  reconciliação e conflitos). Nenhuma escrita no banco NextCRM aqui.
- Documentos ainda não são baixáveis pelo Field nesta onda; links
  armazenam somente metadados. Não gerar links permanentes ou exibir
  arquivo sem ACL atualizada.
- Produção: **NO-GO** até homologação e aceite empresarial formal.

## Evidências anteriores
PRs #33 e #34: GO técnico do staging do fluxo nativo CRM → OS.
PR #21: imagem customizada NextCRM e gateway isolado.
PRs anteriores de documento no branch
`fix/nextcrm-railway-public-origin-20261115` foram reutilizados com
migração nova não conflitante, mantendo os fluxos do Field intactos.
