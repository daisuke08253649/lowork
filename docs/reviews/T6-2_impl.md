# T6-2 実装サマリー

## 実装した内容

- `POST /project-chat` を追加した。`{ project_id, conversation_id, message, model, mode }` を受け取り、`{ message, file_op, file_op_error, mode, conversation_id }` を返す。
- 送信ごとに差分インデックス更新を完了させ、ChromaDBで関連チャンクを最大5件検索してSystem Promptへ含めるようにした。
- Ollama `/api/chat` を非ストリーミングかつJSON形式で呼び出し、`{ message, file_op }` をパースする。JSON形式でない応答は本文をメッセージとして返すフォールバックを設けた。
- `confirm` モードでは提案の `file_op` を返すだけにし、`auto` モードではT6-1の安全なファイル操作サービスを通じて適用する。
- プロジェクト会話をSQLiteへ保存し、既存会話を指定した場合は同一プロジェクトに属することを検証した上で、履歴をOllamaへ渡す。
- 初回会話では、既存のバックグラウンドタイトル生成処理を利用する。

## 変更ファイル

- `backend/api/chat.py`
- `backend/services/chat_history.py`

## 設計判断

- 編集の `filename` はT6-1で確定したプロジェクト相対パスをSystem Promptへ明記し、RAGメタデータの `file_path` と一致させた。
- 自走モードのファイル操作エラーは、回答を失わせず `file_op_error` として返す。

## レビュー指摘への対応（2026-08-12）

- 自走モードのファイル操作失敗はHTTPエラーで会話を中断せず、`file_op_error` として返すようにした。回答メッセージと会話履歴は常に保存される。
- RAG検索時のローカルOllama接続失敗を503「Ollamaに接続できません」として返し、インデックス更新・検索の内部エラーと区別した。
- OllamaのJSON応答は `message` と `file_op` を個別に検証する。部分的に不正なJSON形状でも有効な値を利用し、生のJSONをチャットメッセージとして表示しない。
- `conversation_id` と `file_op_error` を含むレスポンス形式を設計書・実装計画書へ反映した。
- 会話単位のロックでメッセージ採番と保存を直列化し、通常チャット・プロジェクトチャットで共通の保存処理を利用するようにした。

## 動作確認

- `backend/.venv/bin/black backend`
- `backend/.venv/bin/ruff check backend`
- `npm run build`
- 隔離DB・ChromaDBでFastAPIを起動し、一時プロジェクトに対して `POST /project-chat`（`confirm` モード）を実行した。
  - RAG検索とローカルOllamaのJSON応答を確認
  - `file_op: null`、`mode: confirm`、会話IDの返却を確認
  - 取得した会話IDでメッセージ一覧を取得し、ユーザー／AIの2件がSQLiteに保存されたことを確認
- 検証プロジェクトは `DELETE /projects/{id}` を通じて削除し、検証用サーバーは停止済み。`/private/tmp/lowork-t6-2-verify.7S3z8n` は検証の作成物として残している。
