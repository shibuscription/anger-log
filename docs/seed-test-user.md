# Test User Seed Scripts

Firebase Auth / Firestore の実データ検証用に、`users/{uid}/anger_logs` へダミー怒りログを投入するローカルスクリプトです。

## Target UID (default)

`XfSFsJnxsmQAV3KZp3YjR3L7dy52`

必要なら `--uid` または `TARGET_UID` で変更できます。

## Prerequisites

1. 依存インストール

```bash
npm install
```

2. `firebase-admin` 用の認証を準備

- 推奨: `GOOGLE_APPLICATION_CREDENTIALS` にサービスアカウント JSON ファイルパスを設定
- 代替: `FIREBASE_SERVICE_ACCOUNT_JSON` にサービスアカウント JSON 文字列を設定

## Seed (dummy anger logs)

### Dry run

```bash
npm run seed:test-user:dry
```

### Apply

```bash
npm run seed:test-user
```

### Optional args

- `--uid <uid>`: 対象 uid
- `--count <number>`: 件数（1〜300）
- `--dry-run`: 書き込みなし
- `--apply`: Firestore へ書き込み実行

例:

```bash
node scripts/seed-anger-logs.js --uid SOME_UID --count 110 --apply
```

## Cleanup (seeded data only)

`seeded == true` かつ `seedVersion == "seed-v1"` のドキュメントを削除します。

### Dry run

```bash
npm run cleanup:test-user:dry
```

### Apply

```bash
npm run cleanup:test-user
```

### Optional args

- `--uid <uid>`: 対象 uid
- `--seed-version <version>`: 削除対象 seedVersion（デフォルト `seed-v1`）
- `--dry-run`: 削除なし
- `--apply`: 削除実行

## Seeded document shape

既存アプリの参照スキーマに合わせています。

- `date` (ISO string)
- `place` (string)
- `event` (string)
- `intensity` (1..10)
- `location` (`{ latitude, longitude, accuracy }` or `null`)
- `beki_date` (ISO string or `null`)
- `beki_text` (string or `null`)
- `beki_importance` (1..5 or `null`)
- `createdAt` / `updatedAt` (`serverTimestamp`)

識別用フィールド:

- `seeded: true`
- `seedVersion: "seed-v1"`
- `seedTag: "seed-<timestamp>"`
