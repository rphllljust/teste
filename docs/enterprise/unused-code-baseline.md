# Auditoria de código não utilizado — baseline

Data: 2026-11-24
Branch audit: audit/unused-code-baseline
Commit auditado: 886da309af98de3d78e39af6416dc8352002cca7

## Métricas de referência

| Verificação | Resultado |
|---|---:|
| TypeScript Compiler | PASS |
| ESLint | PASS |
| Build | PASS |
| Arquivos sinalizados pelo Knip | 181 |
| Dependências sinalizadas | 18 |
| DevDependencies sinalizadas | 2 |
| Imports não resolvidos | 8 |
| Exports sinalizados | 20 |
| Tipos sinalizados | 11 |
| Binaries sinalizados | 4 |
| Arquivos de bundle | 158 |
| Bundle total | 3.004.945 bytes |

## Classificação

### Não removíveis nesta onda

- Arquivos em `dist/`: são artefatos gerados e não candidatos a remoção de fonte.
- `app/chatgpt-auth.ts`: contrato de autenticação; ausência de referência local não prova ausência de uso pelo runtime.
- `db/index.ts`, `lib/utils.ts` e módulos de domínio: podem ser carregados por aliases, runtime ou contratos.
- `lib/integrations/nextcrm/*` e overlay: integração isolada com workflows próprios; não remover sem análise de submódulo e pipeline.
- Exports e tipos públicos: podem ser consumidos por testes, handlers, scripts ou contratos externos.
- Binaries de workflows: `prisma` e `jest` são dependências operacionais declaradas nos próprios workflows.

### Candidatos para uma futura remoção controlada

- Dependências listadas pelo Knip: exigem confirmação por busca de imports, configuração de bundler e lockfile.
- Scripts de instalação: possuem encadeamento entre si e não podem ser removidos apenas por ausência de referência textual.
- Imports não resolvidos do upstream NextCRM: pertencem a contratos isolados e devem ser corrigidos no próprio isolamento, não apagados.

## Decisão

Nenhum arquivo de produção ou dependência foi removido nesta etapa. A auditoria não demonstrou segurança suficiente para uma remoção automática. A próxima remoção deverá ser feita em lote individual, com diff mínimo e execução de TypeScript, ESLint, build, testes e Playwright antes de integração.
