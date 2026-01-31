import type { ResultSet } from "@libsql/client";
import { ExtractTablesWithRelations } from "drizzle-orm";
import { SQLiteTransaction } from "drizzle-orm/sqlite-core";

import * as schema from "./schema";

export { db } from "./drizzle";
export type { DB } from "./drizzle";
export * as schema from "./schema";

// libsql互換のエラークラス
export class SqliteError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "SqliteError";
    this.code = code;
  }
}

// This is exported here to avoid leaking libsql types outside of this package.
export type KarakeepDBTransaction = SQLiteTransaction<
  "async",
  ResultSet,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;
