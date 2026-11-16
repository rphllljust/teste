import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle-pg",
  schema: ["./db/schema.ts", "./db/integrations/nextcrm-schema.ts", "./db/integrations/nextcrm-mappings-schema.ts"],
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL || "postgres://placeholder:placeholder@localhost:5432/placeholder" },
});
