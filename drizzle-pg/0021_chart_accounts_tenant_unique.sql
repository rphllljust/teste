-- Upgrade from global chart-account codes to owner-scoped chart-account codes.
-- An existing global UNIQUE(code) implies the new (actor_id, code) index is valid.
-- Establish the narrower invariant before dropping the global one, in the same
-- migration transaction. No records or established account IDs are rewritten.
CREATE UNIQUE INDEX IF NOT EXISTS "chart_accounts_actor_code_unique"
  ON "chart_accounts" ("actor_id", "code");
--> statement-breakpoint
ALTER TABLE "chart_accounts"
  DROP CONSTRAINT IF EXISTS "chart_accounts_code_unique";
