import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { getPool } from "./raw";

/**
 * Shared PostgreSQL-backed Drizzle client. No Cloudflare database binding.
 * The runtime fails closed when DATABASE_URL is not configured.
 */
export function getDb() {
  return drizzle(getPool(), { schema });
}
