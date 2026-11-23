# CISNE Enterprise — inventário verificável de rotas e contratos

Fonte: `app/page.tsx` e os workspaces referenciados pela navegação atual.

O frontend atual possui uma rota Next.js canônica (`/`). A navegação empresarial é mantida no fragmento da URL (`/#<nome-do-workspace>`), por `navigate()` e pelo listener de `hashchange`. Portanto, este inventário não cria rotas independentes que não existem.

O arquivo de dados verificável é [`route-inventory.json`](./route-inventory.json). Cada entrada registra rota efetiva, domínio, workspace, APIs observadas no código e estado da migração.

Estados permitidos:

- `migrated-and-tested`: workspace existente, contrato documentado e coberto pelos testes automatizados deste diretório.
- `in-transformation`: alteração parcial ainda não validada como contrato completo.
- `blocked-by-dependency`: bloqueado por dependência concreta.
- `justified-out-of-scope`: fora do escopo com justificativa registrada.

Os testes não inicializam PostgreSQL, não leem `DATABASE_URL` e não importam APIs. Eles validam apenas a consistência estática do inventário contra os arquivos e contratos presentes no repositório.
