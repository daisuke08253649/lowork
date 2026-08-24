# 実装計画書 - lowork

> 作成: 2026-06-28 / MVP完成条件: 開発環境（`npm run tauri dev`）での動作確認

---

## 前提・方針

- **MVP完成条件**: `npm run tauri dev` で全機能が動作すること（配布用バンドルは対象外）
- **タスク粒度**: 30分〜4時間で完了できる単位に分解
- **担当区分**:
  - 🤖 AI担当: コード生成、設定ファイル、ロジック実装
  - 👤 人間担当: 環境確認・インストール、動作テスト、フィードバック
  - 🤝 協働: UI調整、デバッグ
- **テスト方針**: MVPではテストコードなし（動作確認のみ）。技術的負債を抑えるため、後から追加しやすいよう関数の責務を明確に分ける
- **タスクID**: `T{フェーズ番号}-{連番}` の形式（例: T0-1）。依存関係の記述で参照するための識別子

---

## フェーズ概要

| フェーズ | 内容                                       | 設計書優先度 |
| -------- | ------------------------------------------ | ------------ |
| Phase 0  | 環境構築・プロジェクトスキャフォールド     | -            |
| Phase 1  | Tauri + FastAPI 基盤                       | 優先度1      |
| Phase 2  | 普通のチャット（Ollama + SSE）             | 優先度2      |
| Phase 3  | チャット履歴                               | 優先度6      |
| Phase 4  | プロジェクト管理                           | 優先度3      |
| Phase 5  | RAGインデックス + ファイルツリー           | 優先度3      |
| Phase 6  | プロジェクトチャット（RAG + ファイル操作） | 優先度4      |
| Phase 7  | 確認モード / 自走モード                    | 優先度5      |
| Phase 8  | 設定画面（モデルDL・互換性判定）           | 優先度7      |

---

## Phase 0: 環境構築・プロジェクトスキャフォールド

> 全作業の土台。ここが完了して初めてコードを書き始められる。

### T0-1: 開発環境の確認・インストール ⏱30分 👤人間

**作業内容**:

- Rust (`rustup`) がインストールされていることを確認
- Node.js (v20+) がインストールされていることを確認
- Python 3.11+ がインストールされていることを確認
- Ollama がインストール・起動済みであることを確認（`ollama serve`）
- `nomic-embed-text` モデルが pull 済みであることを確認（`ollama pull nomic-embed-text`）
- Tauri CLI のインストール: `cargo install tauri-cli`

### T0-2: Tauri + React プロジェクト初期化 ⏱1時間 👤人間

**作業内容**:

- `npm create tauri-app@latest lowork -- --template react-ts` で生成
- shadcn/ui の初期セットアップ（`npx shadcn@latest init`）
- Tailwind CSS 設定確認
- Zustand のインストール（`npm install zustand`）
- axios のインストール（`npm install axios`）
- 設計書のディレクトリ構成（`src/api/`, `src/components/`, `src/pages/`, `src/hooks/`, `src/store/`）を作成

**依存**: T0-1完了後

### T0-3: Python バックエンド初期化 ⏱1時間 👤人間

**作業内容**:

- Tauri プロジェクトのルート（`lowork/`）直下に `backend/` ディレクトリを作成し、その中に `venv` を作成（`python -m venv .venv`）
- `requirements.txt` の作成と依存ライブラリのインストール:
  - `fastapi`, `uvicorn`, `langchain`, `langchain-community`, `chromadb`
  - `sqlalchemy`, `aiosqlite`, `httpx`, `psutil`, `beautifulsoup4`
- 設計書のディレクトリ構成（`backend/api/`, `backend/services/`, `backend/db/`）を作成
- `backend/main.py` に FastAPI アプリの最小構成（ヘルスチェックのみ）を実装
- CORS ミドルウェアを設定（`http://localhost:1420` を許可）

**依存**: T0-1完了後

### T0-4: Tauri サイドカー設定 ⏱1時間 👤人間

**作業内容**:

- `tauri.conf.json` に Python サイドカーの起動設定を追加
- `src-tauri/src/main.rs` でサイドカー（`uvicorn backend.main:app`）をアプリ起動時に開始・終了時に停止する処理を実装
- `npm run tauri dev` で FastAPI が自動起動することを確認

**依存**: T0-2, T0-3完了後

---

## Phase 1: Tauri + FastAPI 基盤

> UI の骨格と Ollama 疎通確認。ここで基本アーキテクチャが動くことを保証する。

### T1-0: 環境構築の完了確認 ⏱30分 🤖AI

**作業内容**:

- ディレクトリ構成・`package.json`・`requirements.txt` を確認し、設計書の構成と一致しているかチェック
- `npm run tauri dev` が起動するか確認
- `uvicorn backend.main:app` が起動するか確認（`GET /` でヘルスチェックが返るか）
- Ollama が起動しており `nomic-embed-text` が pull 済みか確認（`ollama list`）
- 問題があれば人間に差し戻し、すべて問題なければ T1-1 へ進む

**依存**: T0-4完了後

### T1-1: 共通レイアウト（左サイドバー）の実装 ⏱2時間 🤖AI

**作業内容**:

- `src/components/layout/Sidebar.tsx`: 「新しいチャット」「プロジェクト」「設定」ボタン + チャット履歴エリア
- `src/components/layout/MainPanel.tsx`: コンテンツ領域のラッパー
- `src/pages/NormalChat.tsx`: 空のチャット画面（プレースホルダー）
- `src/pages/ProjectList.tsx`: 空のプロジェクト一覧（プレースホルダー）
- `src/pages/Settings.tsx`: 空の設定画面（プレースホルダー）
- React Router でページ遷移を設定
- ダーク/ライトテーマ切り替えの基盤（CSS変数 + Tailwind dark mode）

**依存**: T0-2完了後

### T1-2: Ollama 接続確認 API + UI ⏱1時間 🤖AI

**作業内容**:

- `backend/api/ollama.py`: `GET /ollama/status`（Ollama が起動中か確認）、`GET /ollama/models`（インストール済みモデル一覧）を実装
- `src/api/ollama.ts`: axios クライアント関数
- Ollama が未起動の場合、サイドバー上部に警告バナーを表示するコンポーネントを実装
- 起動確認をアプリ起動時に自動で実行（5秒おきにポーリング）

**依存**: T0-3, T1-1完了後

---

## Phase 2: 普通のチャット（Ollama + SSE ストリーミング）

> プロダクトのコア体験。ここが動けばユーザーが最も基本的な価値を感じられる。

### T2-1: 普通のチャット API（SSE ストリーミング）⏱2時間 🤖AI

**作業内容**:

- `backend/api/chat.py`: `POST /normal-chat` を実装
  - リクエスト: `{ conversation_id, message, model }`
  - Ollama API（`http://localhost:11434/api/chat`）へリクエストを中継
  - SSE（Server-Sent Events）でトークンを順次ストリーミング返却
- エラーハンドリング: Ollama 未起動時に適切なエラーレスポンスを返す

**依存**: T0-3完了後

### T2-2: チャット UI コンポーネントの実装 ⏱2時間 🤖AI

**作業内容**:

- `src/components/chat/ChatBubble.tsx`: ユーザー・AI メッセージのバブル（Markdownレンダリングは `react-markdown` で対応）
- `src/components/chat/MessageList.tsx`: メッセージ一覧（自動スクロール）
- `src/components/chat/MessageInput.tsx`: 入力欄 + 送信ボタン（Enterキーで送信、Shift+Enterで改行）
- `src/components/common/ModelSelector.tsx`: Ollama モデルのドロップダウン

**依存**: T1-1完了後

### T2-3: 普通のチャット画面の統合 ⏱1時間 🤖AI

**作業内容**:

- `src/pages/NormalChat.tsx` を完成させる（T2-1の API + T2-2のコンポーネントを統合）
- `src/hooks/useChat.ts`: SSE 受信ロジック、メッセージ状態管理を実装
  - SSE受信はエンドポイント単位でタイムアウトを無効化し、共有APIクライアントの通常リクエスト用タイムアウト（5秒）でストリーミングが切断されないようにする
- `src/store/chatStore.ts`: Zustand ストアにメッセージ状態を追加
  - ストリーミング更新では新しいメッセージ配列を返し、ユーザーが最下部付近にいる場合のみ自動スクロールを追従させる
- 新規チャット画面（中央に入力欄）と会話中画面（上部にメッセージ一覧）の切り替え
- 動作確認: メッセージ送信 → AI がストリーミングで返答

**依存**: T2-1, T2-2完了後

---

## Phase 3: チャット履歴

> アプリを閉じても会話が残る。UX上の重要な完成度指標。

### T3-1: SQLite データベース + チャット履歴 API ⏱2時間 🤖AI

**作業内容**:

- `backend/db/database.py`: SQLAlchemy (async) の接続設定、DB初期化
- `backend/db/models.py`: `projects`, `chat_conversations`, `chat_messages` テーブルの定義（設計書「3-1. SQLite テーブル定義」に準拠）
- `backend/api/chat.py` に追加:
  - `GET /chat/conversations`: 会話一覧（project_id=null で普通のチャット）
  - `GET /chat/conversations/{id}/messages`: メッセージ一覧
  - `DELETE /chat/conversations/{id}`: 会話削除
- `/normal-chat` 完了後にメッセージを SQLite へ保存するロジックを追加
- 指定された会話の保存済みメッセージを時系列順に取得し、Ollamaへ渡す`messages`配列へ反映する
- 会話タイトル自動生成: AI返答完了後に Ollama へ別リクエストを送りタイトルを生成

**依存**: T0-3完了後

### T3-2: チャット履歴 UI ⏱1時間 🤖AI

**作業内容**:

- 設定値をプロジェクトルートの `.env` に集約する
  - バックエンド: `OLLAMA_BASE_URL`、`OLLAMA_TIMEOUT_SECONDS`、`DATABASE_URL` を `.env` から読み込む
  - フロントエンド: `VITE_API_BASE_URL` を `.env` から読み込む
  - `.env.example` を追加し、開発に必要な変数名とローカル向けの既定値を共有する
  - `.env` はGit管理せず、既存の`.gitignore`設定を維持する
- `src/store/chatStore.ts`: 会話一覧・アクティブ会話の状態管理
- `src/hooks/useChat.ts` にアプリ起動時の履歴取得ロジックを追加
- サイドバーのチャット履歴一覧を実データで表示
- 履歴をクリックして過去の会話を復元
- 会話削除（右クリック or ゴミ箱アイコン）

**依存**: T3-1, T1-1完了後

---

## Phase 4: プロジェクト管理

> RAG の前提となるプロジェクト（フォルダ）管理機能。

### T4-1: プロジェクト管理 API ⏱1.5時間 🤖AI

**作業内容**:

- `backend/api/projects.py`:
  - `GET /projects`: 一覧取得
  - `POST /projects`: 新規作成（`{ name, folder_path }`）→ インデックス構築をバックグラウンドで開始
  - `DELETE /projects/{id}`: 削除（ChromaDB collection も削除）
  - `GET /projects/{id}/index-status`: `{ status: "indexing"|"done"|"error", progress: 0-100 }`
- SQLite の `projects` テーブルへの CRUD 処理
- フォルダパスの重複チェック（`folder_path` に UNIQUE 制約）
- T5-1で実インデクサーを実装するまで、`index-status` は `done`・100% を返す。実際のインデックス構築の開始・進捗更新はT5-1でこの状態管理へ接続する
- ChromaDB collection はT5-1で初めて作成されるため、`DELETE /projects/{id}` の collection 削除もT5-1で接続する

**依存**: T3-1完了後

### T4-2: プロジェクト一覧画面 + フォルダ選択 ⏱2時間 🤖AI + 🤝協働

**作業内容**:

- `src/pages/ProjectList.tsx` を完成させる
  - プロジェクトカードの一覧表示
  - 「+ 新規」ボタン → Tauri の `open()` ダイアログでフォルダを選択
  - プロジェクト削除（確認モーダル付き）
- `src/components/project/ProjectCard.tsx`: プロジェクト名・パス表示 + 削除ボタン
- `src/store/projectStore.ts`: Zustand でプロジェクト一覧・アクティブプロジェクトを管理
- `src/hooks/useProject.ts`: プロジェクト一覧取得・作成・削除のロジック
- プロジェクト選択 → プロジェクトチャット画面に遷移

**依存**: T4-1, T1-1完了後

---

## Phase 5: RAG インデックス + ファイルツリー

> ChromaDB へのインデックス構築。プロジェクトチャットの前提。

### T5-1: ChromaDB インデックス構築サービス ⏱2.5時間 🤖AI

**作業内容**:

- `backend/services/rag.py`:
  - ChromaDB クライアントの初期化（`collection名: project_{project_id}`）
  - Ollama Embedding（`nomic-embed-text`）を LangChain 経由で呼び出す関数
  - chunk_size=500, chunk_overlap=50 でドキュメントを分割
  - `top_k=5` で類似チャンク検索する `search()` 関数
- `backend/services/indexer.py`:
  - プロジェクトフォルダ内の `.md` / `.txt` ファイルを再帰的に取得
  - バックグラウンド（`asyncio.create_task`）でインデックスを構築
  - 進捗（処理済みファイル数 / 全ファイル数）を in-memory dict で管理
  - 差分更新: `last_modified` を比較し、変更されたファイルのみ再インデックス
  - プロジェクト作成時にバックグラウンドの初回インデックスを開始し、`index-status` の進捗を更新
  - `DELETE /projects/{id}` から ChromaDB の `project_{project_id}` collection を削除する処理を接続

**依存**: T4-1完了後

### T5-2: ファイルツリー API + UI ⏱1.5時間 🤖AI

**作業内容**:

- `backend/api/projects.py` に追加: `GET /projects/{id}/files`（ファイルツリーをネストした JSON で返却）
- `src/components/project/FileTree.tsx`:
  - フォルダ・ファイルを再帰的にツリー表示
  - フォルダの開閉トグル
  - ファイルをクリックしてもMVPでは何もしない（将来のプレビュー機能のため空ハンドラー）
  - ツリー下部にインデックス進捗インジケーター（`GET /projects/{id}/index-status` をポーリング）
- プロジェクトチャット画面の右サイドバーに組み込み

**依存**: T5-1, T4-2完了後

---

## Phase 6: プロジェクトチャット（RAG + ファイル操作）

> プロダクトのコア価値。RAG検索からファイル操作まで一気通貫で動く。

### T6-1: ファイル操作サービス ⏱1.5時間 🤖AI

**作業内容**:

- `backend/services/file_ops.py`:
  - `create_file(project_folder, filename, content)`: ファイル新規作成（フォルダ直下に保存）
  - `edit_file(project_folder, filename, content)`: ファイル編集（`filename` はプロジェクトフォルダからの相対パスで指定）
  - ファイルが見つからない場合のエラーハンドリング
- `backend/api/files.py`:
  - `POST /files/apply`: `{ project_id, action, filename, content }` → ファイルへの書き込みを実行

**依存**: T5-1完了後

### T6-2: プロジェクトチャット API ⏱2.5時間 🤖AI

**作業内容**:

- `backend/api/chat.py` に追加: `POST /project-chat`
  1. 送信直前に差分インデックス更新（更新完了を待ってから次へ）
  2. ChromaDB で RAG 検索（top_k=5）
  3. 関連ファイルの内容を System Prompt に組み込む
  4. Ollama へリクエスト送信
  5. レスポンス JSON をパース（`{ message, file_op }` 形式）
  6. 自走モードの場合は即座にファイル書き込み
  7. JSON 返却: `{ message, file_op, file_op_error, mode, conversation_id }`
- System Prompt テンプレートの実装（JSON形式での返答を指示）
- JSON パース失敗時のフォールバック処理（`message` のみ表示）
- SQLite へのメッセージ保存

**依存**: T6-1, T5-1完了後

### T6-3: プロジェクトチャット画面の実装 ⏱2時間 🤖AI + 🤝協働

**作業内容**:

- `src/pages/ProjectChat.tsx` を完成させる
- `src/hooks/useChat.ts` にプロジェクトチャット用のロジックを追加
- AI 返答後にファイルツリーを自動更新（`GET /projects/{id}/files` を再取得）
- 「自走モード」トグルの UI（初期状態: 確認モード）
- 動作確認: 「〇〇のメモを作って」→ AIがファイルを生成→ ファイルツリーに反映

**依存**: T6-2, T5-2完了後

**継続対応**:

- プロジェクト会話の一覧表示・復元・削除は、通常チャットの履歴と混在させず、T9-1の統合対応でプロジェクトチャット画面の共通サイドバーに追加する。

---

## Phase 7: 確認モード / 自走モード

> ファイル書き込み前のプレビュー機能。安全性と UX のバランス。

### T7-1: ファイルプレビューモーダル ⏱1.5時間 🤖AI

**作業内容**:

- `src/components/project/DiffPreview.tsx`:
  - モーダル形式で表示（設計書「6. 確認モード：ファイルプレビュー」のデザインに準拠）
  - ファイル名・アクション（作成 / 編集）を表示
  - ファイル全文をコードブロックで表示
  - 「キャンセル」「適用する」ボタン
- 確認モード時: `/project-chat` レスポンスに `file_op` があればモーダルを表示
- 「適用する」クリック → `POST /files/apply` でファイル書き込み → ファイルツリー更新
- 「キャンセル」クリック → メッセージのみ表示、ファイル操作なし

**依存**: T6-3完了後

### T7-2: モード状態管理の仕上げ ⏱30分 🤖AI

**作業内容**:

- `src/store/projectStore.ts` に実行モード（`confirm` | `auto`）を追加
- モードを localStorage に保存（アプリ再起動後も維持）
- プロジェクトチャット画面のトグルボタンと状態を連動

**依存**: T7-1完了後

---

## Phase 8: 設定画面（モデルDL・互換性判定）

> 補助機能。新規ユーザーがモデルをダウンロードするための画面。

### T8-1: PCスペック取得 + モデル一覧スクレイピング API ⏱2時間 🤖AI

**作業内容**:

- `backend/api/ollama.py` に追加:
  - `GET /system/specs`: `psutil` で搭載 RAM を取得して返却
  - `GET /ollama/available-models`: `ollama.com/library` をスクレイピングしてモデル一覧を取得
    - 参考実装: [frefrik/ollama-models-api](https://github.com/frefrik/ollama-models-api)
    - モデル名・パラメータ数（labels: `["8B", "70B"]`）を取得
    - 互換性判定（設計書「6. 設定画面：モデル一覧の取得ロジック」の判定ロジックに準拠）を行い、バッジ情報を付与
    - 結果はサーバー起動中はメモリにキャッシュ（毎回スクレイピングしない）
  - `POST /ollama/pull`: モデル DL を開始し、SSE で進捗をストリーミング

**依存**: T0-3完了後（他フェーズと並行可）

### T8-2: 設定画面の実装 ⏱2時間 🤖AI + 🤝協働

**作業内容**:

- `src/pages/Settings.tsx` を完成させる
  - テーマ切り替えトグル（ライト / ダーク）→ Tailwind dark mode と連動
  - モデル一覧テーブル: 名前・サイズ・互換性バッジ・ダウンロードボタン
  - モデル DL 中は進捗バーを SSE で表示
  - ダウンロード不可モデル（赤バッジ）はグレーアウト
- `src/api/ollama.ts` に対応する API クライアント関数を追加

**依存**: T8-1, T1-1完了後

---

## 最終確認

### T9-1: 統合動作確認 ⏱1〜2時間 🤝協働

**確認項目**:

- [ ] 普通のチャット: メッセージ送信 → ストリーミング返答 → 履歴に保存
- [ ] チャット履歴: アプリ再起動後に会話が復元される
- [ ] プロジェクトチャット履歴: プロジェクトごとの会話一覧を表示し、選択した会話をアプリ再起動後も復元できる
- [ ] プロジェクト作成: フォルダ選択 → インデックス構築 → ファイルツリー表示
- [ ] プロジェクトチャット（確認モード）: 「メモを作って」→ プレビュー表示 → 適用 → ファイル生成
- [ ] プロジェクトチャット（自走モード）: 即座にファイル生成
- [ ] 設定画面: モデル一覧表示 → モデル DL
- [ ] Ollama 未起動時: 警告バナーが表示される
- [ ] ダーク/ライト切り替えが全画面で機能する

**依存**: 全フェーズ完了後

---

## タスク依存関係サマリー

```
T0-1 → T0-2 → T1-1 → T2-2 → T2-3
           ↓             ↑
         T0-3 → T2-1 ───┘
           ↓
         T0-4

T0-3 → T3-1 → T3-2 (T1-1完了後)
T3-1 → T4-1 → T4-2 (T1-1完了後)
T4-1 → T5-1 → T5-2 (T4-2完了後)
T5-1 → T6-1 → T6-2 → T6-3 (T5-2完了後)
T6-3 → T7-1 → T7-2

T0-3 → T8-1 → T8-2 (T1-1完了後)  ← 他と並行可
```

---

## 工数見積もり（参考）

| フェーズ                      | 見積もり工数 |
| ----------------------------- | ------------ |
| Phase 0: 環境構築             | 3.5時間      |
| Phase 1: 基盤                 | 3時間        |
| Phase 2: 普通のチャット       | 5時間        |
| Phase 3: チャット履歴         | 3時間        |
| Phase 4: プロジェクト管理     | 3.5時間      |
| Phase 5: RAGインデックス      | 4時間        |
| Phase 6: プロジェクトチャット | 6時間        |
| Phase 7: 確認/自走モード      | 2時間        |
| Phase 8: 設定画面             | 4時間        |
| 統合確認                      | 2時間        |
| **合計**                      | **約36時間** |

> ※AI支援による実装のため、純粋な人間作業時間はこの30〜40%程度と想定。
