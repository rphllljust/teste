# Integração isolada do NextCRM — Fase 0

Status: preparação técnica. Não há implantação, homologação nem fusão funcional.

## Origem, revisão e licença
- Upstream: https://github.com/pdovhomilja/nextcrm-app
- Commit fixado: d3bead9b44efe2cf94d0dfc2948af0f2c9270deb (2026-11-14).
- Licença principal: MIT; preservar avisos e revisar dependências.
- Inclusão: Git submodule em integrations/nextcrm-upstream. Código original inteiro permanece versionado upstream.
- ERP: rphllljust/teste, branch integration/nextcrm-isolated-20261115.
- Proibido qualquer alteração em Railway production nesta fase.

## Obter os dois projetos com um clone
```bash
git clone --recurse-submodules --branch integration/nextcrm-isolated-20261115 https://github.com/rphllljust/teste.git
```
Para um checkout já existente:
```bash
git submodule update --init --recursive integrations/nextcrm-upstream
```
Clonar NÃO executa o NextCRM, não instala dependências e não implanta serviços.

## Isolamento e integração futura
- O ERP principal permanece responsável por suas ordens de serviço, clientes e identidades.
- O NextCRM deve usar banco PostgreSQL independente, com requisitos próprios como pgvector, e storage próprio (MinIO/S3).
- Não importar código do submodule em app/, lib/ ou db/ nesta fase.
- Não alterar package.json, auth, migrações, contratos de API ou arquivos de produção do ERP.
- Não executar compose, seed, Prisma migrate, Docker build ou start automaticamente.
- O NextCRM precisa de variáveis próprias; secrets nunca devem ir ao Git.

## Escopo funcional a validar
- Pessoas: contas, contatos, clientes e fornecedores; definir mestre de dados e mapeamento de IDs.
- Documentos: arquivos, OCR quando aplicável, metadados, vínculos com cliente/OS/contrato, controle de versão, permissão por usuário/empresa, hash, auditoria e retenção.
- OS: service_orders permanece fonte de verdade; vincular documentos a OS por API autenticada; evitar duplicar ordens.
- Segurança: autenticação separada inicial, RBAC, segregação de tenants, antifraude de upload, CORS restrito, controle de anexos e download.

## Gates pré-deploy
1. Verificar commit de submodule, licença e eventuais componentes com licenças distintas.
2. Build e testes isolados do NextCRM e do ERP, com resultados observados.
3. Avaliar banco de staging exclusivo e storage exclusivo, sem acesso à base de produção.
4. Revisão de segurança e dependências, segredos em Railway Variables (não neste repo).
5. Homologar login, contatos, documentos, uploads e permissões; testar E2E e restauração.
6. Definir APIs versionadas de integração e contratos para OS/documentos/pessoas.
7. Merge somente após aprovação e prova de que não altera production automaticamente.

## Rollback
Esta fase apenas adiciona .gitmodules, um gitlink 160000 e documentação em branch isolada. Reverter o PR desfaz a referência. Nenhum banco, serviço ou deploy foi alterado.

Não homologado: execução NextCRM, banco NextCRM, deploy, integração efetiva ou testes E2E.