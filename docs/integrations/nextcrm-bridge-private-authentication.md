# NextCRM v0.41.0 — extensão privada de autorização documental

**Escopo:** overlay auditável, sem alterar o gitlink do NextCRM fixado em `d3bead9b44efe2cf94d0dfc2948af0f2c9270deb`. Este código só faz parte de um build NextCRM **customizado** após instalação explícita; o container oficial `ghcr.io/pdovhomilja/nextcrm-app:v0.41.0` NÃO possui a rota abaixo.

## O que faz

A rota `POST /api/internal/erp-document-authorization` existe neste overlay. O ERP assina o corpo da requisição com HMAC-SHA256, timestamp (tolerância de 30 segundos), nonce de 128 bits, método e caminho fixos. O NextCRM verifica a assinatura e responde com outra assinatura HMAC, vinculada ao timestamp, nonce, status e conteúdo. Ambos exigem a mesma chave privada `CISNE_NEXTCRM_BRIDGE_SECRET` com 32 bytes ou mais em hexadecimal, fornecida somente por variáveis privadas do Railway.

O cliente ERP só aceita `http://nextcrm-web.railway.internal:3000` em runtime não-teste; rejeita redirecionamentos, timeout, conteúdo adulterado, assinaturas inválidas e instâncias não esperadas.

Após autenticar **o servidor**, o NextCRM ainda verifica **o usuário e seus direitos**:
1. `users.id = subjectId` existe, `userStatus=ACTIVE` e `banned=false`.
2. A conta `crm_Accounts.id=accountId` é visível segundo `accountReadScopeWhere` do próprio NextCRM e tem `external_ref=erpClientId`, de modo que a conta mapeia ao cliente ERP esperado.
3. O documento existe, não está excluído, está ligado exatamente à conta e é legível segundo `documentReadScopeWhere` do projeto original.
4. Versão e hash, quando disponível, são retornados em corpo JSON assinado; **nenhum URL de arquivo, conteúdo documental ou cookie de sessão é retornado**.
5. `CISNE_NEXTCRM_INSTANCE_KEY` é um identificador **fixo da instalação**, NÃO um tenant nativo do Prisma; contas de outras empresas só são isoladas pelas permissões reais e mapeamento externo. Não alegar multitenancy nativo.

## Como usar o overlay (somente compilação revisada)

```bash
git submodule update --init --recursive
node scripts/install-nextcrm-bridge-overlay.mjs
# Compilar NextCRM a partir do submódulo revisado e do overlay instalado
```

O instalador recusa SHA diferente, sobrescrita de arquivo upstream e ausência de fontes; copia somente os arquivos necessários para a árvore de trabalho do submódulo. CI executa os testes originais do NextCRM e os novos testes Jest da rota sem contato com banco. Antes de fazer deploy, preparar um Dockerfile reprodutível com SHA e imagem digest fixados e testar migrações/healthcheck em banco descartável.

## Exigências ainda não resolvidas

- Criar **mapeamento persistente confiável** de identidade ERP ↔ usuários NextCRM e de clientes ERP ↔ contas NextCRM; não aceitar IDs livres enviados por navegador.
- Implantar a imagem customizada da rota, com chave HMAC e instance key privadas e diferentes em HML/produção, secret rotation e rede privada protegida.
- Verificar o funcionamento da rota com **Prisma real, usuário real e vínculo real de conta/documento**, incluindo papéis, banimento, tenant, external_ref e versões; Jest com mocks NÃO prova isso.
- HMAC autentica a mensagem, mas não fornece sigilo por si só. A rede Railway interna não deve ser substituída por domínio público sem TLS e gateway de segurança adequado.
- Nenhum endpoint público ERP para criar vínculos estará ativo até confirmar ingress/auth original, mapeamentos e autorização NextCRM no runtime.
- A migração `0001` e as alterações de NextCRM ainda NÃO foram aplicadas a staging ou produção.

## Proteções

A rota tem body pequeno com leitura limitada, requisições sem assinatura são 401, documentos negados são 404 assinados e falhas Prisma são 503 assinados. Há limitação de janela temporal, mas **não existe armazenamento distribuído de nonce**; o endpoint é estritamente de leitura e um replay no curto intervalo de 30 segundos pode repetir uma consulta. Exigir rate limit/WAF/mTLS ao expor além da rede privada.

**NO-GO de deploy:** a instalação do overlay, como um build customizado, não está na imagem oficial já preparada no Railway. Não aplicar o patch antigo do NextCRM HML sem revisar e substituí-lo pelo build completo e autenticação aprovada.

## Teste adicional em PostgreSQL/Prisma REAIS (CI descartável)

O workflow `.github/workflows/nextcrm-bridge-prisma-integration.yml` inicializa PostgreSQL 17 com pgvector em container temporário, instala o Prisma Client NextCRM v0.41.0 e executa as migrations originais com `DATABASE_URL` fixada em `127.0.0.1:5432/nextcrm_ci`.

O teste `route.integration.test.ts` grava **somente identidades e documentos fictícios** com Prisma real e executa `POST /api/internal/erp-document-authorization` diretamente pelo handler. Testa proprietário ativo, conta vinculada por `external_ref`, documento vinculado, negação de usuário externo, conta errada, usuário suspenso/banido, documento excluído e revisão.

**Limitação:** teste usa uma instância NextCRM e dados sintéticos no CI. Não comprova que contas reais do staging estão mapeadas, nem substitui UAT sobre a implantação autenticada e as URLs/tokens de Railway. Não transfere dados D1.
