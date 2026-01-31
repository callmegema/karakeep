# Karakeep Cloud Run + Turso デプロイ計画

## 概要
KarakeepをGoogle Cloud Run + Turso（LibSQL）でデプロイするための計画。

## 前提条件
- **データベース**: Turso（LibSQL）
- **全文検索**: 無効化（Meilisearchなし）
- **クローリング**: Browserless.io
- **アセットストレージ**: S3互換ストレージ（Cloudflare R2等）

---

## Step 1: ブランチ準備

### 方針
`upstream/libsql`は137コミット遅れのため、**mainから開発**して必要な変更のみ適用。

### 作業手順

```bash
# 1. upstreamの最新を取得
git fetch upstream

# 2. mainから作業ブランチを作成
git checkout -b gema/libsql upstream/main
```

---

## Step 2: better-sqlite3 → libsql 移行 + Tursoリモート対応

### 2.1 `packages/db/package.json` の依存関係変更

```diff
- "better-sqlite3": "^11.3.0",
+ "@libsql/client": "^0.15.15",
```

devDependenciesから削除:
```diff
- "@types/better-sqlite3": "^7.6.11",
```

### 2.2 `packages/db/drizzle.ts` を書き換え

libsqlクライアントに移行 + Tursoリモート対応:

```typescript
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
    : { url: `file:${dbConfig.dbCredentials.url}`, concurrency: 0 }
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
    await migrate(db, { migrationsFolder: path.resolve(__dirname, "./drizzle") });
  }
  return db;
}
```

### 2.3 `packages/db/drizzle.config.ts` を変更

```diff
export default {
-  dialect: "sqlite",
+  dialect: "turso",
  schema: "./schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: databaseURL,
  },
} satisfies Config;
```

### 2.4 `packages/shared/config.ts` に環境変数追加

環境変数スキーマに追加:
```typescript
TURSO_DATABASE_URL: z.string().url().optional(),
TURSO_AUTH_TOKEN: z.string().optional(),
```

---

## Step 3: Cloud Run用Dockerfileの調整

### 新規ファイル: `docker/Dockerfile.cloudrun`

libsqlはネイティブビルドが不要なため、軽量化が可能:
- `make`, `g++`, `python3` のインストールを削除
- s6-overlayを使わずシンプルなCMD形式に
- webとworkersを別サービスとして構成

```dockerfile
# Web用
FROM node:24-slim AS web
# ... (ビルドステップは既存のDockerfileを参考)
CMD ["node", "apps/web/server.js"]

# Workers用
FROM node:24-slim AS workers
CMD ["node", "apps/workers/index.js"]
```

---

## Step 4: Cloud Run デプロイ構成

### 環境変数設定

```env
# 必須
NEXTAUTH_URL=https://your-domain.run.app
NEXTAUTH_SECRET=<ランダム文字列>
DATA_DIR=/data
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=<turso-token>

# Browserless
BROWSER_WEBSOCKET_URL=wss://chrome.browserless.io?token=<your-token>
BROWSER_CONNECT_ONDEMAND=true

# S3互換ストレージ (例: Cloudflare R2)
ASSET_STORE_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
ASSET_STORE_S3_REGION=auto
ASSET_STORE_S3_BUCKET=karakeep-assets
ASSET_STORE_S3_ACCESS_KEY_ID=<access-key>
ASSET_STORE_S3_SECRET_ACCESS_KEY=<secret-key>
ASSET_STORE_S3_FORCE_PATH_STYLE=true

# 検索無効化
# MEILI_ADDR を設定しない
```

### Cloud Runサービス構成

1. **karakeep-web** (Web + API)
   - ポート: 3000
   - メモリ: 512MB〜1GB
   - CPU: 1

2. **karakeep-workers** (バックグラウンドジョブ)
   - ポート: なし（HTTPリクエスト受付不要だがCloud Runの制約で必要）
   - メモリ: 1GB〜2GB
   - CPU: 1

---

## Step 5: データベースマイグレーション

Tursoでマイグレーションを実行:
```bash
# ローカルから
TURSO_DATABASE_URL=libsql://your-db.turso.io \
TURSO_AUTH_TOKEN=<token> \
pnpm db:migrate
```

---

## 修正対象ファイル一覧

| ファイル | 変更内容 |
|---------|---------|
| `packages/db/package.json` | 依存関係変更 (better-sqlite3 → @libsql/client) |
| `packages/db/drizzle.ts` | libsql移行 + Tursoリモート接続対応 |
| `packages/db/drizzle.config.ts` | dialect変更 (sqlite → turso) |
| `packages/shared/config.ts` | TURSO_* 環境変数追加 |
| `docker/Dockerfile.cloudrun` | 新規作成、Cloud Run用 |

---

## 検証手順

1. **ローカルテスト**
   ```bash
   # Tursoにテストデータベースを作成
   turso db create karakeep-test

   # マイグレーション実行
   TURSO_DATABASE_URL=... pnpm db:migrate

   # アプリ起動
   TURSO_DATABASE_URL=... pnpm web
   ```

2. **Dockerビルドテスト**
   ```bash
   docker build -f docker/Dockerfile.cloudrun --target web -t karakeep-web .
   docker build -f docker/Dockerfile.cloudrun --target workers -t karakeep-workers .
   ```

3. **Cloud Runデプロイ**
   ```bash
   gcloud run deploy karakeep-web --image ... --set-env-vars ...
   gcloud run deploy karakeep-workers --image ... --set-env-vars ...
   ```

---

## 注意事項

- Tursoの無料プランには制限あり（1GB/月のストレージ、10億行リード/月）
- Cloud Runのコールドスタートでworkersが遅延する可能性あり
- Browserless.ioの無料プランには月間制限あり
