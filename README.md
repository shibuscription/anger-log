# アンガーログアプリ

## 概要

アンガーログアプリは、怒りを感じた出来事と、その背景にある「べき」を記録するためのログアプリです。  
現在の実装は、個人利用を前提にした single-user の v1 プロトタイプです。Firebase Hosting と Firestore を使って、素早く記録し、あとからふりかえれることを優先して作られています。

今後の v2 では Firebase Auth の Google ログインを導入し、ユーザーごとに完全分離された multi-user 構成へ移行する予定です。今回の整備では、現状の挙動をできるだけ変えずに公開可能な最低限の状態へ整えることと、次フェーズの移行方針が README から伝わることを目的にしています。

## 現在の実装状況（v1）

- Firebase Hosting + Firestore
- PWA 対応
- Firestore のオフライン永続化対応
- アンガーログ登録
- 一覧表示
- べきログ入力
- べき画面での編集・削除
- 一覧へのべき内容・重要度表示

現状の Firestore は `anger_logs` コレクション直下にデータを保存する single-user 前提の構成です。認証はまだ導入していないため、公開時は Firestore Rules と運用範囲の扱いに注意が必要です。

## 今後の予定（v2）

- Firebase Auth（Google ログイン）
- ユーザーごとのデータ分離
- Firestore Rules の厳格化
- べき一覧画面
- 怒りマップ
- 頻出語分析

v2 では、個人ログという強いプライバシー性を前提に、認証済みユーザーだけが自分のデータへアクセスできる構成へ移行します。現状はまだこの構造へ移行していませんが、次フェーズでは以下のような Firestore 構造を採用する予定です。

## 現在想定している v2 データ構造

```text
users/{uid}
  - displayName
  - email
  - createdAt
  - updatedAt

users/{uid}/anger_logs/{logId}
  - date
  - place
  - event
  - intensity
  - location
  - beki_date
  - beki_text
  - beki_importance
  - createdAt
  - updatedAt
```

補足:

- Firestore ドキュメント内には `id` を持たず、Firestore のドキュメント ID をそのまま利用する想定です。
- 現在の v1 ではこの構造には未移行で、`anger_logs` 直下に保存しています。
- v2 では `uid` 単位で読み書きを閉じ、他ユーザーのデータにアクセスできない Rules を前提にします。

## 技術構成

- Vite
- Firebase Hosting
- Firebase Firestore
- Firebase Web SDK
- PWA（manifest / service worker）
- HTML / CSS / Vanilla JavaScript

## ローカル起動方法

1. Node.js 20 以上を用意します。
2. 依存関係をインストールします。

```bash
npm install
```

3. `.env.example` をコピーして `.env` を作成し、Firebase 設定値を入力します。
4. 開発サーバーを起動します。

```bash
npm run dev
```

5. ブラウザで表示された URL を開きます。

本番ビルドは以下です。

```bash
npm run build
```

Firebase Hosting へ deploy する場合は、`dist` を配信対象として扱います。

## .env の設定方法

Vite では、クライアントから参照する環境変数に `VITE_` プレフィックスが必要です。Firebase の初期化設定は `.env` に置き、コードからは `import.meta.env` 経由で参照します。

設定対象:

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MEASUREMENT_ID=
```

`VITE_FIREBASE_MEASUREMENT_ID` は未使用であれば空でも問題ありません。

## Firebase 利用に関する補足

- Firebase Web の設定値はフロントエンドに露出する前提の値ですが、秘匿情報の代わりにはなりません。
- 本当に守るべきなのは Firestore Rules と認証設計です。
- 現状の v1 は single-user プロトタイプなので、公開前に Firestore Rules が現状の運用意図と一致しているか必ず確認してください。
- v2 で Auth を入れるまでは、「誰に使わせるか」と「どの Firebase プロジェクトに向けるか」を明確にした上で公開するのが安全です。
- `.firebaserc` には Firebase の project ID が入るため、公開リポジトリで共有して問題ないかチーム方針を確認してください。

## 設計思想

- 個人ログは極めてプライベートな情報として扱う
- 他人のデータは絶対に見えない構造にする
- 集計機能を追加する場合も、個人を特定しない件数ベースを基本にする
- UI はシンプルで、思い出す前にすぐ記録できることを優先する

## 公開前チェックの観点

- `.env` が Git 管理に入っていないか
- Firebase 設定値の直書きがコード内に残っていないか
- Firestore Rules が single-user v1 の暫定公開方針と矛盾していないか
- テスト用 Firebase プロジェクトを使うか、本番用 Firebase プロジェクトを使うか
- `.firebase/` やビルド成果物など、公開不要ファイルが ignore されているか
- 実データや個人ログが Firestore 側に残っている場合、公開前に運用上問題ないか

## 補足

このリポジトリは、現時点では「個人向けプロトタイプを安全に公開可能な最低限まで整えたもの」です。multi-user v2 の本格対応はまだ未実装ですが、認証導入とデータ構造移行を前提に、次のフェーズへ進めやすい状態に整理しています。
