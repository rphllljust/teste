# Railway staging — proteção contra migração sem restore (CISNE)

## Situação
O serviço `cisne-web-staging` executa `pnpm db:migrate` em pre-deploy.
A migração `0002_crm_proposal_origin` é aditiva, mas aplica constraints,
índices e origem CRM → proposta ao banco persistente Field PostgreSQL.
CI verde, rebuild e snapshot nominal não provam que o banco pode ser
recuperado. O patch atualmente preparado no Railway NÃO deve ser aceito
até ter um teste de restauração de um backup real.

## Gate fail-closed
`scripts/migrate-postgres.mjs` verifica, sob lock transacional, se a
`0002` já consta em `_cisne_schema_migrations`. Se não consta, exige
`CISNE_DB_RESTORE_ATTESTATION` antes de executar qualquer migração
pendente. Ausência, SQL divergente, restore não identificado ou
verificação antiga provocam `MIGRATION_BACKUP_NO_GO` e ROLLBACK.
Reimplantações com migração já aplicada não exigem nova atestação.

O único bypass é o fixture **descartável** do GitHub Actions com
`NODE_ENV=test`, `CI=true`, `GITHUB_ACTIONS=true` e
`DATABASE_URL=postgresql://cisne_test:...@localhost:5432/cisne_test`.
Não existe bypass por nome `staging` ou por um header HTTP.

## Evidência exigida no Railway (manual, staging somente)

1. No projeto Railway `genuine-renewal` > ambiente staging > serviço
   **Postgres** (banco do Field, não `nextcrm-postgres`), inspecionar
   Backups / PITR e registrar o identificador e data de uma recuperação
   disponível, incluindo retenção, volume e estado.
2. Restaurar **uma cópia em um alvo isolado diferente** do banco de
   staging. Nunca usar produção e nunca restaurar sobrescrevendo o
   banco de origem. É obrigatório conseguir abrir a base restaurada,
   consultar a versão do PostgreSQL, as migrações, os registros e
   os relacionamentos relevantes. Registrar logs de resultado.
3. Conferir integridade dos dados e chaves: clientes, propostas,
   versões/ordens já existentes; comparar quantidades e um conjunto
   representativo dos registros. Confirmar que a recuperação é
   utilizável antes de descartar o alvo isolado.
4. Calcular o SHA-256 dos bytes exatos da migração correspondente ao
   commit a implantar. Exemplo, na cópia do mesmo commit:
   `sha256sum drizzle-pg/0002_crm_proposal_origin.sql`.
5. Somente após a restauração comprovada, um operador autorizado pode
   preencher uma variável **somente no Field staging**:
   
   ```json
   {
     "migrationId": "0002_crm_proposal_origin",
     "migrationSha256": "<64 hex do SQL exato>",
     "backupId": "<identificador real do backup restaurado>",
     "restoreTarget": "<nome do banco alternativo restaurado>",
     "verifiedBy": "<identificador do revisor>",
     "verifiedAt": "<UTC ISO 8601, exemplo 2026-11-15T22:00:00Z>"
   }
   ```

   O JSON inteiro é o valor de `CISNE_DB_RESTORE_ATTESTATION`.
   **Não preencher com os placeholders, não forjar identificadores**
   nem incluir senhas/tokens. O código rejeita verificações com
   mais de 72 horas, futuras em mais de cinco minutos, nome de
   destino idêntico ao banco fonte e hash do SQL diferente.
6. Revisar o diff do patch: alterar somente o serviço Field staging,
   preservar volumes, confirmar commit SHA, checar o estado dos
   serviços e então solicitar autorização explícita para aceitar
   a implantação. Não transformar backup configurado em
   backup restaurado sem evidência real.
7. Após a implantação: confirmar a migração 0002 no ledger, conferir
   backups atuais, testes HTTP autenticados, isolamento de usuários e
   execução comercial completa no navegador; registrar o veredito.

## Limitações técnicas
A variável de atestação é **uma declaração operacional revisável**, não
uma prova criptográfica de que o Railway realizou restore. Esta conexão
Railway não permite ler os backups/PITR nem executar uma restauração.
Portanto o bloqueio humano permanece até documentação verificável do
backup e restore do banco persistente.

O CI executa uma prova independente com **PostgreSQL 16 descartável**:
semeia cliente, lead, oportunidade, proposta, PO, contrato e OS; exporta
via `pg_dump --format=custom`; restaura em outro banco com
`pg_restore --exit-on-error`; verifica a cadeia completa de IDs,
preços, estados, ledger 0000/0001/0002 e constraints FK do proprietário.
Depois elimina o alvo e a semente. Essa evidência valida o procedimento
de restore e o SQL, **não substitui o restore do volume Railway**.

## Autoridade e NO-GO
Não alterar o banco `nextcrm-postgres`. O mecanismo não concede SSO,
RBAC, aceite jurídico nem autorização para emissão de OS em produção.
Produção permanece NO-GO até aceites funcionais e controles empresariais,
independentemente da atestação de restauração.
