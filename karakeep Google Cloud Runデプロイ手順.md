# karakeep Google Cloud Runデプロイ手順

このドキュメントは、karakeep（セルフホスタブルなブックマーク管理アプリ）をGoogle Cloud Runにデプロイするための詳細な手順を提供します。

## 前提条件

### 必要なツール
- Google Cloud SDK（gcloud CLI）がインストールされていること
- Docker（ローカルテスト用）
- Google Cloudプロジェクトが作成済みであること

### 必要なGoogle Cloud APIs
以下のAPIを有効化してください：
```bash
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable containerregistry.googleapis.com
gcloud services enable sqladmin.googleapis.com
gcloud services enable storage.googleapis.com
```

## アーキテクチャ概要

karakeepは以下のコンポーネントで構成されています：
- **Webアプリケーション**: Next.js（メインアプリ）
- **データベース**: PostgreSQL（Cloud SQL）
- **検索エンジン**: Meilisearch（別のCloud Runサービス）
- **ストレージ**: Cloud Storage（画像・ファイル保存）
- **ブラウザ**: Puppeteer（ウェブページキャプチャ）

## ステップ1: 外部サービスの準備

### 1.1 Cloud SQL（PostgreSQL）のセットアップ

```bash
# Cloud SQLインスタンスの作成
gcloud sql instances create karakeep-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=asia-northeast1 \
  --network=default

# データベースの作成
gcloud sql databases create karakeep \
  --instance=karakeep-db

# ユーザーの作成
gcloud sql users create karakeep-user \
  --instance=karakeep-db \
  --password=[secure-password]
```

### 1.2 Cloud Storageバケットの作成

```bash
# バケットの作成
gsutil mb -p [PROJECT-ID] -c standard -l asia-northeast1 gs://karakeep-storage-[PROJECT-ID]/

# CORSポリシーの設定
cat > cors.json << EOF
[
  {
    "origin": ["*"],
    "method": ["GET", "POST", "PUT", "DELETE"],
    "responseHeader": ["*"],
    "maxAgeSeconds": 3600
  }
]
EOF

gsutil cors set cors.json gs://karakeep-storage-[PROJECT-ID]/
```

### 1.3 Meilisearchのデプロイ

```bash
# Meilisearch用のDockerfileを作成
cat > Dockerfile.meilisearch << EOF
FROM getmeili/meilisearch:v1.6
ENV MEILI_ENV="production"
ENV MEILI_MASTER_KEY="[secure-master-key]"
EXPOSE 7700
EOF

# イメージのビルドとプッシュ
gcloud builds submit --tag gcr.io/[PROJECT-ID]/meilisearch -f Dockerfile.meilisearch .

# Cloud Runにデプロイ
gcloud run deploy meilisearch \
  --image gcr.io/[PROJECT-ID]/meilisearch \
  --platform managed \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --port 7700
```

#### Meilisearchとは
```
⏺ Meilisearchは、オープンソースの高速な全文検索エ
  ンジンです。以下に主な特徴をまとめます：

  概要

  - Rust製の検索エンジンで、高速かつ軽量
  - RESTful APIを提供し、簡単に統合可能
  - typo-tolerance（タイプミスの許容）機能を内蔵
  - リアルタイムでのインデックス更新が可能

  主な特徴

  1. 高速な検索

  - ミリ秒単位での検索結果返却
  - 大量のドキュメントでも高速動作
  - メモリ効率が良い

  2. 開発者フレンドリー

  - シンプルなREST API
  - 多言語対応のSDK（JavaScript、Python、Go、Ruby
  等）
  - ゼロコンフィグで動作開始可能

  3. 検索機能

  - ファセット検索：カテゴリー別フィルタリング
  - タイプミス許容：スペルミスがあっても正しい結果
  を返す
  - 同義語サポート：類似語での検索が可能
  - ハイライト機能：検索語をハイライト表示
  - フィルタリング：属性によるフィルタ
  - ソート：関連性や任意の属性でソート

  4. karakeepでの使用

  karakeepでは、Meilisearchを以下の用途で使用：
  - ブックマークの全文検索
  - ノートの内容検索
  - タグやカテゴリーでのフィルタリング
  - 高速な検索体験の提供

  Elasticsearchとの比較

  | 特徴     | Meilisearch | Elasticsearch |
  |--------|-------------|---------------|
  | セットアップ | 簡単（ゼロコンフィグ） |
  複雑（設定が必要）     |
  | リソース使用 | 軽量          | リソース集約的
        |
  | 学習曲線   | 緩やか         | 急峻
  |
  | 用途     | エンドユーザー向け検索 |
  分析・ログ解析向け     |

  Cloud Runでの運用メリット

  - 軽量：少ないメモリ（512MB〜）で動作
  -
  ステートレス対応：データは永続化ストレージに保存
  - 自動スケーリング：負荷に応じて自動的にスケール
  - コンテナ化済み：公式Dockerイメージが利用可能

  karakeepのようなブックマーク管理アプリケーション
  には、Meilisearchの高速性とシンプルさが非常に適
  しています。
```

## ステップ2: 環境変数の設定

### 必須環境変数

```bash
# 認証関連
NEXTAUTH_SECRET=$(openssl rand -base64 32)
NEXTAUTH_URL=https://karakeep-[PROJECT-HASH]-an.a.run.app

# データベース
DATABASE_URL=postgresql://karakeep-user:[password]@/karakeep?host=/cloudsql/[PROJECT-ID]:asia-northeast1:karakeep-db

# Meilisearch
MEILI_ADDR=https://meilisearch-[PROJECT-HASH]-an.a.run.app
MEILI_MASTER_KEY=[secure-master-key]

# ストレージ
S3_ENDPOINT=https://storage.googleapis.com
S3_ACCESS_KEY=[service-account-key]
S3_SECRET_KEY=[service-account-secret]
S3_BUCKET=karakeep-storage-[PROJECT-ID]
S3_REGION=asia-northeast1

# アプリケーション設定
DATA_DIR=/data
DISABLE_SIGNUPS=false
MAX_ASSET_SIZE_MB=10
```

### オプション環境変数

```bash
# OpenAI（AI機能用）
OPENAI_API_KEY=[your-api-key]
OPENAI_BASE_URL=https://api.openai.com/v1

# OAuth認証（オプション）
OAUTH_GOOGLE_CLIENT_ID=[client-id]
OAUTH_GOOGLE_CLIENT_SECRET=[client-secret]
OAUTH_GITHUB_CLIENT_ID=[client-id]
OAUTH_GITHUB_CLIENT_SECRET=[client-secret]

# SMTP（メール通知用）
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=[email]
SMTP_PASSWORD=[app-password]
SMTP_FROM=[email]
```

## ステップ3: karakeepアプリケーションの準備

### 3.1 リポジトリのクローン

```bash
git clone https://github.com/karakeep-app/karakeep.git
cd karakeep
```

### 3.2 Cloud Run用の設定ファイル作成

```yaml
# cloudbuild.yaml
steps:
  # ビルドステップ
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', 'gcr.io/$PROJECT_ID/karakeep:$COMMIT_SHA', '.']
  
  # プッシュステップ
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', 'gcr.io/$PROJECT_ID/karakeep:$COMMIT_SHA']
  
  # デプロイステップ
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args:
      - 'run'
      - 'deploy'
      - 'karakeep'
      - '--image'
      - 'gcr.io/$PROJECT_ID/karakeep:$COMMIT_SHA'
      - '--region'
      - 'asia-northeast1'
      - '--platform'
      - 'managed'
      - '--update-env-vars'
      - 'NEXTAUTH_URL=https://karakeep-$PROJECT_NUMBER-an.a.run.app'

images:
  - 'gcr.io/$PROJECT_ID/karakeep:$COMMIT_SHA'
```

### 3.3 Puppeteer設定の修正

Cloud Runでは、Puppeteerの設定を調整する必要があります。

```javascript
// puppeteer.config.js
module.exports = {
  launch: {
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ],
    headless: true
  }
};
```

## ステップ4: デプロイ

### 4.1 コンテナイメージのビルドとプッシュ

```bash
# プロジェクトIDを設定
export PROJECT_ID=[your-project-id]

# イメージのビルド
gcloud builds submit --tag gcr.io/$PROJECT_ID/karakeep

# または、ローカルでビルドしてプッシュ
docker build -t gcr.io/$PROJECT_ID/karakeep .
docker push gcr.io/$PROJECT_ID/karakeep
```

### 4.2 Cloud Runへのデプロイ

```bash
gcloud run deploy karakeep \
  --image gcr.io/$PROJECT_ID/karakeep \
  --platform managed \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --timeout 300 \
  --max-instances 10 \
  --min-instances 0 \
  --port 3000 \
  --add-cloudsql-instances $PROJECT_ID:asia-northeast1:karakeep-db \
  --set-env-vars "DATABASE_URL=postgresql://karakeep-user:[password]@/karakeep?host=/cloudsql/$PROJECT_ID:asia-northeast1:karakeep-db" \
  --set-env-vars "NEXTAUTH_SECRET=$NEXTAUTH_SECRET" \
  --set-env-vars "MEILI_ADDR=$MEILI_URL" \
  --set-env-vars "S3_BUCKET=$BUCKET_NAME" \
  --service-account karakeep-sa@$PROJECT_ID.iam.gserviceaccount.com
```

### 4.3 サービスアカウントの設定

```bash
# サービスアカウントの作成
gcloud iam service-accounts create karakeep-sa \
  --display-name="Karakeep Service Account"

# 必要な権限の付与
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:karakeep-sa@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:karakeep-sa@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"
```

## ステップ5: 初期設定とマイグレーション

### 5.1 データベースマイグレーション

```bash
# Cloud Shellまたはローカルから実行
npm install
npm run db:migrate
```

### 5.2 初期管理者ユーザーの作成

アプリケーションにアクセスして、最初のユーザーを作成します。

## トラブルシューティング

### よくある問題と解決方法

1. **メモリ不足エラー**
   - メモリを4Giに増やす: `--memory 4Gi`

2. **タイムアウトエラー**
   - タイムアウトを延長: `--timeout 900`

3. **データベース接続エラー**
   - Cloud SQL Proxyの設定を確認
   - VPCコネクタの使用を検討

4. **Puppeteerエラー**
   - カスタムChromeイメージの使用を検討
   - メモリとCPUの割り当てを増やす

### ログの確認

```bash
# アプリケーションログ
gcloud run services logs read karakeep --region asia-northeast1

# Cloud SQLログ
gcloud sql operations list --instance=karakeep-db
```

## セキュリティの考慮事項

1. **認証の有効化**
   - 本番環境では `--no-allow-unauthenticated` を使用
   - Identity-Aware Proxy (IAP) の設定を検討

2. **シークレット管理**
   - Secret Managerを使用して環境変数を管理
   ```bash
   gcloud secrets create nextauth-secret --data-file=-
   gcloud run services update karakeep --update-secrets NEXTAUTH_SECRET=nextauth-secret:latest
   ```

3. **ネットワークセキュリティ**
   - VPCコネクタを使用してプライベート接続を確立
   - Cloud ArmorでDDoS対策を実装

## まとめ

このドキュメントでは、karakeepをGoogle Cloud Runにデプロイするための包括的な手順を説明しました。Cloud SQLデータベース、Meilisearch検索エンジン、Cloud Storageを統合し、スケーラブルで管理しやすいデプロイメントを実現できます。

追加のカスタマイズやエンタープライズ機能については、karakeepの公式ドキュメントを参照してください。