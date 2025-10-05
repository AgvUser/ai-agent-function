# Azure Functions - OpenAI互換 Chat Completions API with Azure AI Foundry Agent

このプロジェクトは、OpenAI Chat Completions API互換のエンドポイントを Azure Functions で実装し、受け取ったプロンプトを Azure AI Foundry のエージェントに転送して、そのレスポンスを返します。

## 機能

- **OpenAI互換API**: `/api/v1/chat/completions` エンドポイント（POST/OPTIONS）
- **Azure AI Foundryエージェント統合**: 受け取ったメッセージをAzure AI Foundryエージェントに転送
- **ストリーミング対応**: `stream: true` オプションで SSE (Server-Sent Events) によるストリーミングレスポンス
- **CORS対応**: クロスオリジンリクエストをサポート
- **エラーハンドリング**: 必須パラメータ/認証/JSONパース/Foundry APIのエラーを適切に処理、フォールバックメッセージあり
- **Genie AI拡張機能互換**: VS CodeのGenie AI拡張機能と互換

## エンドポイント仕様

- **URL**
  `POST /api/v1/chat/completions`
  （ローカル: `http://localhost:7071/api/v1/chat/completions`）

- **リクエストボディ**（OpenAI互換形式）
  ```json
  {
    "model": "gpt-4o-mini",
    "messages": [
      { "role": "user", "content": "こんにちは！" }
    ],
    "temperature": 0.7,      // 任意
    "max_tokens": 2048,      // 任意
    "top_p": 1.0,            // 任意
    "stream": true           // 任意: ストリーミングレスポンス
  }
  ```

- **必須パラメータ**
  - `model`: モデル名（内容は無視されますが必須）
  - `messages`: メッセージ配列（user/assistant）

- **認証**
  - `Authorization: Bearer <任意の値>`
    ※現在は認証チェックのみ、APIキー自体はAzure AI Foundryとの接続用

## Azure AI Foundryエージェント設定

- **プロジェクトエンドポイント**: `https://[ENDPOINT]/api/projects/[PROJECT]`
- **エージェントID**: `[AGENT-ID]`
- **エージェント名**: `[AGENT-NAME]`

### 認証設定

Azure ADによる Bearer トークン認証

**必要な環境変数**
- `AZURE_AI_FOUNDRY_ENDPOINT`
- `AZURE_AI_FOUNDRY_AGENT_ID`
- `AZURE_AI_FOUNDRY_AGENT_NAME`
- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `AZURE_AI_FOUNDRY_API_KEY`

#### ローカル開発用: `local.settings.json`
```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "",
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "AZURE_AI_FOUNDRY_ENDPOINT": "https://[ENDPOINT]/api/projects/[PROJECT]",
    "AZURE_AI_FOUNDRY_AGENT_ID": "[AGENT-ID]",
    "AZURE_AI_FOUNDRY_AGENT_NAME": "[AGENT-NAME]",
    "AZURE_TENANT_ID": "<your-tenant-id>",
    "AZURE_CLIENT_ID": "<your-client-id>",
    "AZURE_CLIENT_SECRET": "<your-client-secret>",
    "AZURE_AI_FOUNDRY_API_KEY": "<your-api-key>"
  }
}
```
#### 本番環境
Azure Portal > Application Settings で同様の環境変数を設定してください。

---

## セットアップ

### 必要な環境
- Node.js 20.x 以上
- Azure Functions Core Tools 4.x
- TypeScript

### インストールと起動

```bash
# 依存関係をインストール
npm install

# TypeScriptをビルド
npm run build

# Azure Functionsをローカルで起動
func start
```
または
```bash
nvm use 20.19.2 && func host start
```

---

## 使用方法

### 基本的なリクエスト

```bash
curl -X POST http://localhost:7071/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-key" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {
        "role": "user",
        "content": "こんにちは！"
      }
    ],
    "temperature": 0.7,
    "max_tokens": 2048
  }'
```

### ストリーミングリクエスト

```bash
curl -X POST http://localhost:7071/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-key" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {
        "role": "user",
        "content": "長い文章を生成してください"
      }
    ],
    "stream": true
  }'
```

### Genie AI拡張機能での利用

1. VS CodeでGenie AI拡張機能を開く
2. 設定で下記を構成：
   - **API Base URL**: `http://localhost:7071/api`
   - **API Key**: 任意の値（例: `sk-test123`）
   - **Model**: `gpt-4o-mini`

## プロキシ監視

開発時のデバッグ用に、リクエスト/レスポンスを監視するプロキシが含まれています：

```bash
# プロキシを起動（別ターミナル）
node proxy-monitor.js

# プロキシ経由でテスト
curl -X POST http://localhost:8080/api/chat/completions \
  -H "Content-Type: application/json" \
  -H "api-key: test-key" \
  -d '{...}'
```

## ファイル構成

```
├── src/
│   ├── index.ts                 # エントリーポイント
│   └── functions/
│       └── hellosample.ts       # メインのChat Completions API実装
├── proxy-monitor.js             # プロキシ監視ツール
├── test-request.json           # テスト用リクエストサンプル
├── test-requests.sh            # テストスクリプト
├── package.json
├── tsconfig.json
├── host.json                   # Azure Functions設定
└── local.settings.json         # ローカル環境設定
```

## トラブルシューティング

### Azure AI Foundry接続エラー

- **401 Unauthorized**: Azure AD認証情報やAPIキーの設定を確認
- **エンドポイントエラー**: プロジェクトURLが正しいか確認
- **ネットワークエラー**: ファイアウォール設定を確認

### その他

- 依存関係を再インストール: `npm install`
- TypeScriptを再ビルド: `npm run build`
- ポート7071が空いているか確認: `lsof -i :7071`

## 開発用コマンド

```bash
# 開発用（ファイル変更時自動ビルド）
npm run watch

# ビルド
npm run build

# クリーン
npm run clean

# テスト
npm test
```

## 注意事項

- リクエストパラメータ（`model`, `messages`など）はOpenAI API互換ですが、`model`の内容はAzure AI Foundryエージェントの設定には影響しません。
- `messages`配列の最後の`user`メッセージのみがAzure AI Foundryエージェントに転送されます。
- 認証ヘッダーはOpenAI API互換のために受け入れますが、Azure AI Foundryとの接続には環境変数の認証情報が必須です。
- ストリーミングレスポンスはSSE形式ですが、内容は一括で返されます（現状分割生成は非対応）。

## ライセンス

MIT License
