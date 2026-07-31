# T3-2 実装サマリー

## タスク

T3-2: チャット履歴 UI

## 実装内容

- `chatStore` に会話一覧、アクティブ会話 ID、履歴の読み込み状態を追加
- アプリ起動時に会話一覧を取得し、サイドバーへ実データのタイトル一覧を表示
- サイドバーの会話を選択すると、メッセージを取得して普通のチャット画面へ復元
- 各履歴に削除ボタンを追加し、会話削除 API と連動
- 新しいチャット操作ではアクティブ会話 ID も解除するよう変更
- 通常チャットの SSE 完了イベントから `conversation_id` を受け取り、以降の送信で同じ会話を継続
- 会話一覧・メッセージ一覧・削除 API のレスポンスを Zod で検証
- 設定値をルート `.env` へ集約
  - バックエンド: Ollama URL、タイムアウト、SQLite URL
  - フロントエンド: API ベース URL
  - `.env.example` を追加し、`.env` は Git 管理対象外のままとした

## 変更ファイル

- `.env.example`
- `.gitignore`
- `README.md`
- `backend/config.py`
- `backend/db/database.py`
- `backend/requirements.txt`
- `src/api/chat.ts`
- `src/api/client.ts`
- `src/components/layout/Sidebar.tsx`
- `src/hooks/useChat.ts`
- `src/store/chatStore.ts`
- `src/types/chat.ts`
- `src/vite-env.d.ts`
- `docs/implementation_plan.md`
- `docs/reviews/T3-2_impl.md`

## 設計判断

- Vite がブラウザへ公開する値は `VITE_API_BASE_URL` のみとし、バックエンド用の変数をフロントエンドへ公開しない
- `.env.example` は追跡対象とするため、`.gitignore` の `.env.*` パターンから明示的に除外した
- SQLite URL が相対パスの場合でも、バックエンドはプロジェクトルート基準の絶対パスへ正規化する

## 動作確認

```bash
npm run lint
npm run build
backend/.venv/bin/ruff check backend
backend/.venv/bin/black --check backend
git diff --check
```

- TypeScript ビルド、バックエンドの Ruff / Black、差分チェックはすべて成功
- Lint は既存 shadcn `Button` 由来の警告1件のみで、新規エラーはなし
- Python から `.env` の Ollama・DB設定を読み込み、SQLite URL がプロジェクトルート基準の絶対パスに正規化されることを確認
- ブラウザ接続が利用できないため、画面操作による手動確認はレビュー時に実施する

## レビュー指摘への対応

- `.env` が存在しない環境でも、フロントエンドは `http://127.0.0.1:8000` を既定値として使用するようにした。型も任意項目へ変更し、READMEに `.env` 作成手順を追加した
- 新規会話では、タイトルが「新しいチャット」の間だけ5秒間隔・最大60秒で一覧を再取得し、バックグラウンドのタイトル生成完了をサイドバーへ反映するようにした
- 履歴一覧を独立した縦スクロール領域にして、会話数が増えてもすべて選択・削除できるようにした
- Sidebarは必要なZustand状態だけを購読するように変更し、ストリーミング本文の更新ごとの再描画をなくした
- 削除ボタンの不要なイベント伝播停止を削除した
- `.env` 経由でも Ollama の接続先を `localhost` / `127.0.0.1` / `::1` のHTTP URLに制限し、外部LLM APIへ向けられないようにした
- タイトルの再取得は最大120秒へ拡張し、遅いローカルモデルでも反映を待てるようにした
- 既存の履歴がある再取得中は「読み込み中...」を追加表示せず、一覧の縦位置が動かないようにした
- 初期履歴取得を常時表示されるSidebarへ移し、`useChat` の未使用状態購読を取り除いた
