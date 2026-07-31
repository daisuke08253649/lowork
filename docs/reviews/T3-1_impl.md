# T3-1 実装サマリー

## タスク

T3-1: SQLite データベース + チャット履歴 API

## 実装内容

- SQLAlchemy + aiosqlite による非同期 SQLite 接続と、FastAPI 起動時のテーブル初期化を追加
- 設計書 3-1 に準拠して、`projects`、`chat_conversations`、`chat_messages` テーブルを定義
- チャット履歴サービスを追加し、会話・メッセージの保存、一覧取得、時系列取得、削除を実装
- 以下の API を追加
  - `GET /chat/conversations?project_id=`: 指定プロジェクトの会話一覧（`project_id` 未指定時は普通のチャット）
  - `GET /chat/conversations/{id}/messages`: 会話内のメッセージ一覧
  - `DELETE /chat/conversations/{id}`: 会話と紐づくメッセージの削除
- `/normal-chat` は指定済み会話の保存済みメッセージを時系列順に Ollama へ渡し、完了した応答のみを保存するよう変更
- 保存の完了後に SSE の最終イベントを返し、`conversation_id` を含めるようにした。T3-2 ではこの ID をアクティブ会話として保持できる
- 新規会話の初回応答後、同じローカル Ollama モデルへ別リクエストを送り、20文字以内のタイトルを非同期生成するようにした
- SQLAlchemy の非同期実行に必要な `greenlet` をバックエンド依存へ追加

## 変更ファイル

- `backend/db/__init__.py`
- `backend/db/database.py`
- `backend/db/models.py`
- `backend/services/chat_history.py`
- `backend/api/chat.py`
- `backend/main.py`
- `backend/requirements.txt`
- `docs/reviews/T3-1_impl.md`

## 設計判断

- 会話メッセージはストリームが `done: true` で完了した場合のみ保存する。途中切断・Ollama 応答の解析失敗時には不完全な履歴を残さない
- 新規会話 ID は保存後の SSE 完了イベントに含める。これにより、UI が保存を待たずに次のメッセージから同じ会話 ID を送れる
- タイトル生成の失敗は会話本体の保存を妨げない。既定タイトル「新しいチャット」を維持する
- MVPでは普通のチャットの全履歴を Ollama へ渡す。この上限を設けない方針は `design.md` の「その他の設計決定事項」に記録した

## 動作確認

```bash
backend/.venv/bin/ruff check backend
backend/.venv/bin/black --check backend
git diff --check
```

- 上記チェックはすべて成功
- FastAPI をローカルで起動し、DB 初期化、`GET /chat/conversations` の空配列、未存在会話の削除時の 404 を確認
- ローカル Ollama を用いた `POST /normal-chat` で、SSE の最終イベントに `conversation_id` が含まれることを確認
- 保存後の会話一覧・メッセージ一覧で、タイトルと user / assistant メッセージが時系列で取得できることを確認
- `DELETE /chat/conversations/{id}` が 204 を返し、手動確認用の会話を API 経由で削除できることを確認

## レビュー指摘への対応

- メッセージごとに会話内の連番 `sequence` を保存し、UUIDや秒精度の日時に依存せず決定的な順序で取得するようにした
- 保存日時を Python 側の UTC・マイクロ秒精度で設定し、APIレスポンスでは必ずUTCオフセット付きの日時に正規化した
- SQLiteの既存DBに対しても、アプリ起動時に `sequence` カラムを追加して既存行を `rowid` 順に移行する処理を追加した
- タイトル生成は接続タイムアウトのみ5秒とし、読み取りタイムアウトを無制限に変更した
- タイトル生成タスクへの強い参照を保持し、完了時に自動で破棄するようにした
- 保存時は `SQLAlchemyError` も捕捉し、SSEで保存失敗を通知するようにした
- `lifespan` の戻り値型と `backend/services/__init__.py` を追加し、ストリーム処理の制御構文ネストを2階層以内に整理した

### 修正後の動作確認

- 既存の SQLite ファイルを持つ状態で FastAPI を起動し、`sequence` カラムのアプリ内移行を確認
- 同一会話へ連続して2ターン送信し、`user → assistant → user → assistant` の順に取得されることを確認
- 各 `created_at` がマイクロ秒精度かつ UTC の `Z` 付きで返ることを確認
- 確認用会話は `DELETE /chat/conversations/{id}` を通して削除し、一時サーバーも停止済み
