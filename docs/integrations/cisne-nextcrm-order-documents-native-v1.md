# Incorporação NextCRM no contexto da OS do CISNE — leitura v1

## Escopo implementado

Esta etapa é uma integração nativa e incremental **dentro da interface do CISNE**:
- Novo painel "Documentos NextCRM" dentro do contexto da ordem de serviço (OS).
- Endpoint de mesmo domínio `GET /api/orders/:id/nextcrm-documents`.
- Leitura de metadados dos documentos já vinculados à OS nas tabelas PostgreSQL do ERP.
- Nenhuma navegação para outro site, iframe ou troca de sessão neste painel.
- Nunca retorna conteúdo binário, URL de download, ID remoto, token, tenant ou dados de identidade externa.
- Nenhuma alteração no PostgreSQL do NextCRM, nenhuma migração de dados e nenhum write.

## Segurança e autorização

1. `requestContext` exige sessão autenticada no CISNE e aplica o guard de staging.
2. A OS precisa pertencer ao ator autenticado; OS de outro ator ou registro legado com `owner_id=NULL` retorna 404.
3. Cada vínculo exige, **no instante da leitura**, cliente ERP ativo, mapeamento de identidade ERP ↔ NextCRM verificado e ativo, e mapeamento cliente ERP ↔ conta NextCRM verificado e ativo no mesmo `instance_key` / proprietário.
4. Revogar um dos mapeamentos faz o painel deixar de exibir o documento; o evento auditável e o vínculo imutável são preservados.
5. Saída limitada a 50 metadados, ordenação determinística, resposta `no-store`.
6. Falha de PostgreSQL ou migração ausente deve produzir erro, nunca registros artificiais.

**Atenção:** a leitura de metadados não substitui a reautorização do NextCRM para baixar ou visualizar bytes do arquivo. Um vínculo histórico por si só não concede download, e esta etapa não afirma que todo documento foi transferido ou sincronizado.

## Testes e operação

O teste `test/integration/nextcrm-order-documents-read.test.ts` usa exclusivamente PostgreSQL 16/18 local descartável, exercita proprietário correto, isolamento de terceiro, revogação de mapeamento de conta, revogação de identidade e inativação de cliente.

O gate `pnpm test:integration` deve executar o teste com o restante da suíte, após `pnpm db:migrate`. Também exigir TypeScript, ESLint, build, revisão do PR e staging autenticado antes de qualquer merge.

Critérios de aceite no Railway staging:
1. Preservar serviços e volumes NextCRM e Financeiro existentes.
2. Publicar **somente após CI verde no SHA exato** da linha de consolidação, sem promover imediatamente para produção.
3. Abrir OS com vínculo previamente validado e verificar metadados no mesmo painel.
4. Abrir OS sem mapeamento e confirmar zero documentos; testar revogação e isolamento com fixture sintética.
5. Confirmar ausência de links públicos de arquivo, erros de autorização negados e logs sem dados sensíveis.
6. Registrar evidências de Playwright desktop e mobile.

Próximas etapas (não implementadas aqui): download via proxy privado com novo cheque HMAC/ACL/versão, identidade unificada OIDC/SSO, reconciliação idempotente dos registros do CRM legado com os clientes ERP e UAT empresarial completo. Não ativar banco compartilhado nem importar dados reais automaticamente.
