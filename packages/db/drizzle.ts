import "dotenv/config";

import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

import serverConfig from "@karakeep/shared/config";

import dbConfig from "./drizzle.config";
import * as schema from "./schema";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Tursoリモート or ローカルファイル
const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;

const client = createClient(
  tursoUrl
    ? { url: tursoUrl, authToken: tursoToken }
    : { url: `file:${dbConfig.dbCredentials.url}`, concurrency: 0 },
);

// PRAGMAs設定（ローカルファイルの場合のみ）
async function configurePragmas() {
  if (tursoUrl) return; // Tursoリモートでは不要

  if (serverConfig.database.walMode) {
    await client.execute("PRAGMA journal_mode = WAL");
    await client.execute("PRAGMA synchronous = NORMAL");
  } else {
    await client.execute("PRAGMA journal_mode = DELETE");
  }
  await client.execute("PRAGMA foreign_keys = ON");
  await client.execute("PRAGMA temp_store = MEMORY");
  await client.execute("PRAGMA cache_size = -65536");
  await client.execute("PRAGMA busy_timeout = 20000");
}

await configurePragmas();

export const db = drizzle(client, { schema });
export type DB = typeof db;

// テスト用インメモリDB（libsql版）
export async function getInMemoryDB(runMigrations: boolean) {
  const memClient = createClient({ url: ":memory:" });
  const db = drizzle(memClient, { schema, logger: false });
  if (runMigrations) {
    await migrate(db, {
      migrationsFolder: path.resolve(__dirname, "./drizzle"),
    });
  }
  return db;
}
