# T5-1 実装サマリー

## 実装したタスク

- T5-1: ChromaDB インデックス構築サービス

## 概要

- プロジェクトごとに`project_{project_id}` collectionを使用する、永続化ChromaDBサービスを追加した。
- `nomic-embed-text`をLangChainの`OllamaEmbeddings`経由で呼び出し、`.md`と`.txt`を再帰取得してインデックス化するようにした。
- `chunk_size=500`、`chunk_overlap=50`で分割し、`top_k=5`の`search()`を実装した。
- `last_modified`（ナノ秒精度の更新時刻）をメタデータに保存し、変更・削除ファイルだけを再インデックスするようにした。
- プロジェクト作成時に`asyncio.create_task`で初回インデックスを開始し、処理済みファイル数から進捗状態を更新するようにした。
- プロジェクト削除時に、実行中のインデックスを停止してからcollectionを削除する処理を接続した。

## 変更ファイル

- `backend/services/rag.py`
  - ChromaDB永続クライアント、Ollama Embedding、分割、upsert、差分用メタデータ取得、検索、collection削除を実装。
- `backend/services/indexer.py`
  - 対象ファイルの再帰取得、非同期バックグラウンドインデックス、進捗管理、差分・削除同期、タスク管理を実装。
- `backend/services/index_status.py`
  - インデックス中・完了・失敗の進捗状態更新関数を追加。
- `backend/api/projects.py`
  - 作成時の初回インデックス開始と、削除時のcollection削除をAPIフローへ接続。
- `backend/config.py` / `.env.example`
  - `CHROMA_DB_PATH`と`OLLAMA_EMBEDDING_MODEL`を環境変数として追加。
- `backend/requirements.txt`
  - 現行LangChainのOllama統合で必要な`langchain-ollama`を追加。

## 設計判断

- ChromaDBへのベクトル保存・検索には、LangChainで生成したEmbeddingを明示的に渡す方式を採用した。これによりEmbedding処理は設計どおりOllama経由に限定される。
- ChromaDBとEmbedding処理は同期APIのため、インデックス処理は`asyncio.to_thread`でイベントループをブロックしないようにした。
- 同一プロジェクトのインデックスと削除が競合しないよう、collection操作をプロジェクト単位のロックで保護している。
- ChromaDB保存先はプロジェクト内の`backend/data/chroma_db`を既定値とし、`.gitignore`のローカルデータ除外対象に含まれる。

## 動作確認

- `backend/.venv/bin/black --check backend` 成功
- `backend/.venv/bin/ruff check backend` 成功
- RAG関連モジュールのインポート成功
- 隔離した一時SQLite／ChromaDBで、FastAPI APIを使って以下を確認:
  1. `POST /projects`後、`GET /projects/{id}/index-status`が`done / 100`へ到達
  2. `search()`で関連チャンクを5件取得（`design.md`を含む結果）
  3. `DELETE /projects/{id}`が204を返却

検証用のプロジェクト・SQLite・ChromaDBはすべて`/private/tmp`配下の隔離環境を使用し、リポジトリの`backend/data/chat.db`は操作していない。

## レビュー対応（2026-08-11）

- バックグラウンドのインデックス失敗時にスタックトレース付きのwarningログを残し、失敗の原因を追跡できるようにした。
- 失敗状態の進捗値も、処理済みファイル数を全ファイル数で割ったパーセント値に統一した。
- FastAPI起動時に既存プロジェクトの差分インデックスを開始することで、再起動で中断されたインデックスを再開するようにした。
- `.git`、`node_modules`、`.venv`、`dist`、`target`配下を再帰走査の対象から除外した。
- ChromaDBクライアントを遅延初期化し、RAGモジュールのimport時にはローカル保存先を生成しないようにした。
- プロジェクト単位ロックの生成も専用ロックで保護し、複数スレッドからの初回アクセス時に競合しないようにした。

## 第2回レビュー対応（2026-08-11）

- プロジェクトフォルダが存在しない場合、または再帰走査中に読み取りエラーが発生した場合は、既存インデックスの削除同期を実行せず失敗状態へ遷移するようにした。これにより、外付けドライブ未マウントや権限不足を空フォルダと誤認してcollectionを全消去することを防ぐ。

## 第3回レビュー対応（2026-08-11）

- 読み取れないサブディレクトリ、壊れたシンボリックリンク、インデックス中に削除されたファイルは、warningログを残して個別にスキップするようにした。
- 走査または個別ファイル処理に1件でもエラーがあった回は、走査結果が不完全であるため削除同期を実行しない。既存チャンクを保全しつつ、残りの読み取り可能なファイルは引き続きインデックスする。
- Embeddingの生成を既存チャンク削除より先に行い、OllamaのEmbedding失敗で更新前のチャンクを消さないようにした。
