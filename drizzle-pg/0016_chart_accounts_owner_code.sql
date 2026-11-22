-- Preserve historical accounting records while allowing the same standard ledger
-- code in separate tenant-owned charts of accounts. The replacement constraint
-- is created BEFORE dropping the global uniqueness constraint to fail closed.
ALTER TABLE "chart_accounts" ADD CONSTRAINT "chart_accounts_actor_code_unique" UNIQUE ("actor_id","code");
--> statement-breakpoint
ALTER TABLE "chart_accounts" DROP CONSTRAINT "chart_accounts_code_unique";
