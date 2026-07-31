# T3-1 レビュー結果

対象: T3-1 SQLite データベース + チャット履歴 API
ブランチ: `feature/t3-chat-history`（`develop` との差分 + 未追跡ファイル `backend/db/`, `backend/services/`）
レビュー日: 2026-07-31

## 判定

**要修正**

重大な指摘が2件あります。特に「重大1（メッセージの保存順序が壊れている）」は、T3-1の作業内容そのもの（時系列順の履歴をOllamaへ渡す）が成立しておらず、T3-2の履歴復元にもそのまま影響します。

---

## 指摘事項

### 重大1: メッセージが時系列順に取得できず、user / assistant が入れ替わる

**該当箇所**: `backend/db/models.py:51-53` / `backend/services/chat_history.py:27-34`

原因は2つの組み合わせです。

1. `created_at` が `server_default=func.now()` で定義されている。SQLite ではこれが `CURRENT_TIMESTAMP` にコンパイルされ、**秒単位の精度しかない**。`save_normal_chat` は user / assistant の2件を1回の `add_all` + `commit` で挿入するため、両者の `created_at` は必ず同じ値になる
2. そのため並び順は `order_by(ChatMessage.created_at, ChatMessage.id)` の第2キーで決まるが、`id` は **ランダムな uuid4**。つまり順序が実質ランダムになる

**実測（一時DBに対し `save_normal_chat` → `get_conversation_messages` を12回）**

```
created_at 実値: ['2026-07-31 10:42:00', '2026-07-31 10:42:00']   ← 秒単位・同値
id(uuid4)   : ['a03a22e3-...', 'fe291d40-...']

順序が逆になった回数: 10/12
```

3ターン保存したあと `get_conversation_history()`（＝Ollamaへ渡す配列）を取得した結果:

```
user      | 1回目
assistant | 回答1
assistant | 回答3      ← 順序破綻
user      | 2回目
assistant | 回答2
user      | 3回目
```

**実サーバー（uvicorn + 実Ollama）でも再現**

`POST /normal-chat` を2ターン実行したあとの `GET /chat/conversations/{id}/messages`:

```
2026-07-31T10:44:38  user      '私の名前はダイスケです。覚えてください。'
2026-07-31T10:44:38  assistant 'はい、**ダイスケさん**ですね。しっかりと覚えました。😊'
2026-07-31T10:44:55  assistant 'ダイスケ様です。'                      ← 先に返る
2026-07-31T10:44:55  user      '私の名前は何でしたか？一言で。'          ← 後に返る
```

**影響**

- `implementation_plan.md` T3-1 の「指定された会話の保存済みメッセージを**時系列順に取得し**、Ollamaへ渡す`messages`配列へ反映する」を満たしていない。ターンが増えるほど文脈が壊れ、AIの応答品質が落ちる
- `GET /chat/conversations/{id}/messages` も同じ関数を使っているため、T3-2で履歴を復元するとバブルの並びが崩れて表示される

**修正案**

`created_at` の精度に依存しない決定的な並び順キーを持たせるのが確実です。例えば以下のいずれか。

- `ChatMessage` に整数の連番カラム（`sequence` など、または autoincrement な `Integer` 主キー）を追加し、`order_by` の主キーにする
- `created_at` を `server_default=func.now()` ではなく Python 側の `default=lambda: datetime.now(UTC)`（マイクロ秒精度）にしたうえで、なお同値になりうるため連番との併用を検討する

なお `list_conversations()`（`chat_history.py:78-87`）の `order_by(created_at.desc())` も同じ秒単位精度に依存しています。同一秒内に複数会話が作られた場合、サイドバーの並びが不定になります。上記の対応と合わせて方針を揃えてください。

---

### 重大2: タイトル自動生成が実運用のモデルでは常にタイムアウトする

**該当箇所**: `backend/services/chat_history.py:111`

```python
async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT_SECONDS) as client:
```

`OLLAMA_TIMEOUT_SECONDS` は `backend/config.py` で **5.0** です。`/normal-chat` 側ではこれを**接続タイムアウト**として使い、読み取りは明示的に無制限にしています（`backend/api/chat.py:186-191`、`read=None`）。一方タイトル生成では `httpx.AsyncClient(timeout=5.0)` と渡しているため、**読み取りを含む全体が5秒**になります。タイトル生成は `stream: False` の一括生成なので、5秒はまず足りません。

**実測**

| モデル | 生成に要した時間 | 5秒タイムアウト下での結果 |
|---|---|---|
| `gemma4:e4b`（コールド） | 5.06秒で `httpx.ReadTimeout` | 失敗（`新しいチャット` のまま） |
| `gemma4:e4b`（ウォーム） | 2.80秒 | 成功しうる |
| `gemma4:12b` | **41.77秒** | 常に失敗 |

タイムアウトだけを180秒に伸ばした同一ロジックでは、どちらのモデルでも正しくタイトルが生成されました（`'Pythonの非同期処理とasyncio'` / `'Pythonの非同期処理に関する質問'`）。**ロジック自体は正しく、タイムアウト値の使い方だけが問題**です。

実サーバーでの通しでは `gemma4:e4b` がウォームだったためタイトル生成に成功しましたが（`名前の記憶と確認`）、ユーザーが `gemma4:12b` を選ぶと `implementation_plan.md` T3-1 の「会話タイトル自動生成」が常に無言で失敗し、T3-2のサイドバーが全件「新しいチャット」になります。

**修正案**: `/normal-chat` と同様に接続と読み取りを分ける。

```python
timeout=httpx.Timeout(connect=OLLAMA_TIMEOUT_SECONDS, read=None, write=OLLAMA_TIMEOUT_SECONDS, pool=OLLAMA_TIMEOUT_SECONDS)
```

`read=None`（無制限）が過剰であれば、タイトル生成専用の定数を `config.py` に追加してください。いずれにせよ、接続用の5秒をそのまま生成の全体タイムアウトに流用しない形にするのが要点です。

---

### 中1: `created_at` がタイムゾーン情報なしで返るため、UI表示時に時刻がずれる

**該当箇所**: `backend/db/models.py:20-22, 35-37, 51-53` / `backend/api/chat.py:43-50`

`DateTime(timezone=True)` を指定していますが、SQLite にはタイムゾーン付きの型がなく、`CURRENT_TIMESTAMP` は **UTC のナイーブ値**として保存されます。実測でも JST 19:44 に作成したレコードが `2026-07-31 10:44:38` として保存され、API レスポンスも `"created_at": "2026-07-31T10:44:38"`（オフセットなし）でした。

JavaScript の `new Date("2026-07-31T10:44:38")` はオフセットのない日時文字列を**ローカル時刻**として解釈するため、T3-2 で作成日時を表示すると JST 環境で9時間ずれます。

**修正案**: 保存時に `datetime.now(UTC)` を Python 側の `default` として使い、レスポンスで `+00:00` 付きの ISO 8601 が返るようにする（重大1の対応と同時に手を入れる箇所なので、まとめて対応するのが効率的です）。

---

### 軽微1: `backend/services/__init__.py` が存在しない

`backend/__init__.py`・`backend/api/__init__.py`・`backend/db/__init__.py` は存在するのに、`backend/services/` にだけありません。名前空間パッケージとして解決されるため動作はしますが、パッケージ構成が不揃いです。追加してください。

### 軽微2: `asyncio.create_task()` の戻り値を保持していない

**該当箇所**: `backend/api/chat.py:113`

Python 公式ドキュメントが明記しているとおり、参照を保持しないタスクは実行途中でガベージコレクトされる可能性があります。ローカル1ユーザーのアプリなので実害の確率は低いですが、モジュールレベルの `set` に保持して `add_done_callback` で破棄する定石に寄せておくと安全です。

### 軽微3: 会話履歴が無制限に伸び、コンテキスト長を超えうる

**該当箇所**: `backend/services/chat_history.py:37-39`

`get_conversation_history()` は会話の全メッセージを返し、`/normal-chat` はそれを毎回すべて Ollama に渡します。長い会話ではモデルのコンテキスト長を超えます。`design.md` に上限の記載がないため設計判断になりますが、直近N件・N文字などの上限を設けるか、上限を設けない旨を `design.md` 8章「その他の設計決定事項」に記録してください。

### 軽微4: 保存失敗時の例外捕捉が `ValueError` のみ

**該当箇所**: `backend/api/chat.py:108`

`save_normal_chat` が投げうるのは `ValueError` だけではありません。SQLite のロック等で `OperationalError` が出ると非同期ジェネレータの外へ抜け、`done` イベントなしでストリームが切れます。フロントは「応答が途中で終了しました」を表示し、**保存に失敗したことがユーザーに伝わりません**。`SQLAlchemyError` も拾って「会話の保存に失敗しました」に寄せるのが妥当です。

### 軽微5: `lifespan` に戻り値の型ヒントがない

**該当箇所**: `backend/main.py:12`

`code_style.md`「関数シグネチャには型ヒントを必須とする」に反しています。`async def lifespan(_: FastAPI) -> AsyncIterator[None]:` としてください。

### 軽微6: 制御構文のネストが3階層

**該当箇所**: `backend/api/chat.py:80-93`

`async for` → `if chunk.done:` → `if chunk.message.content:` で3階層になっています。`code_style.md`「制御構文のネストは2階層までを目安にする」に照らすと、完了チャンクの処理を関数に切り出すか、`if chunk.done:` に入った直後に早期 `break` する形へ整理する余地があります。

---

## 良かった点・確認できた点

- **`PRAGMA foreign_keys=ON`** を `connect` イベントで有効化している（`db/database.py:14-18`）。SQLite の外部キーはデフォルト無効なので、この対応は適切
- **完了したストリームのみ保存する設計**（`completed` フラグ）。T2-3 のレビューで T3-1 への申し送りとした「途中で切れた不完全な回答が文脈として Ollama に送られる」問題が、バックエンド側で正しく回避されている
- `/normal-chat` に**プロジェクト会話のIDを渡すと 404** になる（`get_normal_conversation` が `project_id IS NULL` で絞り込み）。普通のチャットとプロジェクトチャットの取り違えを防げている
- `design.md` 3-1 のテーブル定義（`projects` / `chat_conversations` / `chat_messages`、各カラム）と一致。`folder_path` の UNIQUE 制約も T4-1 を見越して入っている
- `design.md` 4章の API パス・メソッド（`GET /chat/conversations`、`GET /chat/conversations/{id}/messages`、`DELETE /chat/conversations/{id}`）と一致
- ディレクトリ責務分離が `design.md` 2章どおり（API 層は変換のみ、DB アクセスは `services/chat_history.py`、モデル定義は `db/`）
- SSE の契約変更（完了チャンクを `done: false` で送り、保存後に `{content: "", done: true, conversation_id}` を送る）に対し、既存フロントエンド（`src/api/chat.ts`）は追加フィールドを Zod が無視するため無改修で動作することを実サーバーで確認済み

### セキュリティ観点（`AGENTS.md` 7章・9章・10章）

- 外部通信は `OLLAMA_BASE_URL`（`http://127.0.0.1:11434`）のみ。タイトル生成も同じローカル Ollama を使っており、オフライン要件に反する通信の混入はなし
- ファイル書き込みは `backend/data/chat.db` のみ。パストラバーサルの余地なし。`.gitignore` の `data/` と `*.db` で DB ファイルは追跡対象外になっていることを確認
- Tauri `invoke()` の使用なし。Rust 側へのロジック追加なし
- 秘密情報のログ出力なし。`logger.warning` はタイトル生成失敗のみ

### 動作確認（レビュアー実施）

実サーバー（uvicorn + 実 Ollama `gemma4:e4b`）で確認:

| 確認項目 | 結果 |
|---|---|
| 起動時のDB初期化・`GET /chat/conversations` | `[]` |
| 2ターン目で1ターン目の内容を踏まえた応答 | 「私の名前は何でしたか？」→「ダイスケ様です。」 ✅ |
| SSE 最終イベントに `conversation_id` | 含まれる ✅ |
| `GET /chat/conversations/{id}/messages` | 200（ただし**順序が破綻**、重大1） |
| 存在しない会話のメッセージ一覧 | 404 ✅ |
| 存在しない `conversation_id` で `/normal-chat` | 404 `{"detail":"会話が見つかりません"}` ✅ |
| `DELETE /chat/conversations/{id}` | 204 ✅、再実行で 404 ✅、メッセージも消える ✅ |
| `?project_id=` （空文字） | `[]`（空文字でフィルタされる。実害は薄いので指摘には含めず） |
| `ruff check` / `black --check` | いずれも成功 ✅ |

検証で起動したプロセスはすべて停止済み、検証用の会話は `DELETE /chat/conversations/{id}` 経由で削除済み（`chat.db` への直接操作は行っていません）。

---

## T3-2 への申し送り

- 現状フロントエンドは `useChat.ts:54` で `conversationId: null` を固定送信しているため、UIから送るたびに新規会話が作られます。バックエンドが返す `conversation_id` を受け取ってアクティブ会話として保持する対応は T3-2 の作業内容に含まれています
- 上記「中1」を修正しない場合、履歴一覧に作成日時を表示するとタイムゾーン分ずれます

---

# 第2回レビュー（2026-07-31）

初回レビューの指摘（重大2件・中1件・軽微6件）すべてについて修正を確認しました。

## 判定

**承認（指摘なし）**

---

## 指摘への対応確認

### 重大1: メッセージの保存順序 → 修正済み

`ChatMessage` に `sequence: Mapped[int]` を追加し（`db/models.py:55`）、`get_conversation_messages` の並び順を `order_by(ChatMessage.sequence)` に変更（`chat_history.py:32`）。`save_normal_chat` は会話ごとの `max(sequence)` を取って `+1`, `+2` を採番しています（`chat_history.py:60-80`）。UUID・秒精度日時のどちらにも依存しない決定的な順序になりました。

**新規DBで20往復（40件）を保存し、`get_conversation_history()` の並びを期待値と全件比較**

```
40件の履歴がOllamaへ渡る順序と期待値が一致: True
```

初回レビューでは12回中10回で順序が崩れていたので、確実に解消しています。

**実サーバー（uvicorn + 実Ollama `gemma4:12b`）での3ターン**

```
2026-07-31T11:05:15.260440Z  user      '日本の首都はどこ？一言で。'
2026-07-31T11:05:15.260450Z  assistant '東京です。'
2026-07-31T11:06:35.048726Z  user      'では大阪は何県にある？一言で。'
2026-07-31T11:06:35.048745Z  assistant '大阪府です。'
2026-07-31T11:06:51.259944Z  user      '最初に聞いた質問は何でしたか？一言で。'
2026-07-31T11:06:51.259961Z  assistant '「日本の首都はどこ？」です。'
```

3ターン目の「最初に聞いた質問は何でしたか？」に対し **「日本の首都はどこ？」** と正しく答えており、履歴が正しい順序で Ollama に渡っていることが応答内容からも確認できます。

なお `list_conversations` の `order_by(created_at.desc())` は据え置きですが、`created_at` が Python 側のマイクロ秒精度になったことで並びが安定するため、これで問題ありません。

### 既存DBの移行 → 追加検証して問題なし

`initialize_database` に `sequence` カラムの追加と `rowid` からの移行が入りました（`db/database.py:27-37`）。指摘には含めていなかった箇所ですが、既存DBを壊しうるので重点的に確認しました。

**旧スキーマ（`sequence` なし）に2会話・6メッセージを入れたDBを作り、新コードで起動**

```
[1] 移行結果
  旧会話A: 1:A-質問1 → 2:A-回答1 → 3:A-質問2 → 4:A-回答2
  旧会話B: 5:B-質問1 → 6:B-回答1

[2] 移行後の会話に2ターン追記
  seq= 1 user      A-質問1
  seq= 2 assistant A-回答1
  ...
  seq= 7 user      A-質問4
  seq= 8 assistant A-回答4

[3] 再度 initialize_database() を実行（アプリ再起動相当）
  sequence: [1, 2, 3, 4, 5, 6, 7, 8]  重複なし: True
```

- 会話内の相対順序が挿入順どおりに復元されている
- 移行後に追記しても採番が連続する
- カラム存在チェックにより再起動で二重移行されない

`sequence = rowid` は会話をまたいだ通し番号になるため、旧会話Bの先頭が `1` ではなく `5` から始まります。ただし採番は会話ごとの `max` を基準に継続され、並び順は会話内の相対順序だけで決まるので実害はありません。

実DB（`backend/data/chat.db`）も既に移行済みで、`chat_messages` に `sequence INTEGER NOT NULL DEFAULT 0` が追加されていることを確認しました。

### 重大2: タイトル生成のタイムアウト → 修正済み

`httpx.Timeout(connect=OLLAMA_TIMEOUT_SECONDS, read=None, write=..., pool=...)` に変更され（`chat_history.py:120-127`）、`/normal-chat` と同じ方針に揃いました。

初回レビューで **41.77秒かかり必ず失敗していた `gemma4:12b`** で実サーバーの通しを実行した結果:

```
title='日本の首都に関する一問一答'
uvicornログ: 警告なし（ReadTimeout・Traceback ともになし）
```

生成に成功しています。

### 中1: `created_at` のタイムゾーン → 修正済み

`server_default=func.now()` を Python 側の `default=utc_now`（`datetime.now(UTC)`）に変更し、レスポンス生成時に `as_utc_datetime()` でUTCへ正規化しています。

```
DBから読んだ値      : datetime.datetime(2026, 7, 31, 11, 4, 38, 828839)
APIレスポンスのJSON : "created_at":"2026-07-31T11:04:38.828839Z"
マイクロ秒が保持    : True
```

`Z` 付きで返るため、JavaScript の `new Date()` がUTCとして正しく解釈します。T3-2で作成日時を表示してもずれません。

### 軽微1〜6 → いずれも修正済み

| 指摘 | 対応 |
|---|---|
| 軽微1: `services/__init__.py` 欠落 | 追加済み |
| 軽微2: `asyncio.create_task` の参照未保持 | `title_generation_tasks` セットに保持し、`add_done_callback(discard)` で破棄（`api/chat.py:26, 147-163`） |
| 軽微3: 履歴の上限 | `design.md` 8章に「普通のチャットの履歴上限」として、MVPでは上限を設けない方針と追加判断の条件を記録 |
| 軽微4: 例外捕捉が `ValueError` のみ | `except (SQLAlchemyError, ValueError)` に拡張（`api/chat.py:101`） |
| 軽微5: `lifespan` の型ヒント | `-> AsyncIterator[None]` を付与 |
| 軽微6: ネスト3階層 | ガード節（`if not chunk.done: continue`）に置き換え、2階層以内に収まっている（`api/chat.py:82-92`） |

軽微6のリファクタリングは分岐の順序が変わっていますが、「完了チャンクに本文があれば `done: false` で送出してからループを抜ける」という挙動は変わっておらず、実サーバーでの通しでも本文が欠けないことを確認しました。

---

## 回帰確認

| 確認項目 | 結果 |
|---|---|
| 3ターンの会話で履歴を踏まえた応答 | ✅（3ターン目が1ターン目の内容を正答） |
| SSE 最終イベントの `conversation_id` | ✅ |
| 起動時のDB初期化・`GET /chat/conversations` | `[]` ✅ |
| 存在しない会話のメッセージ一覧 | 404 ✅ |
| 存在しない `conversation_id` で `/normal-chat` | 404 ✅ |
| `DELETE /chat/conversations/{id}` | 204 ✅、再実行で 404 ✅ |
| `ruff check` / `black --check` | いずれも成功 ✅ |

初回レビューで「良かった点」に挙げた項目（`PRAGMA foreign_keys=ON`、完了ストリームのみ保存、プロジェクト会話IDの拒否、`design.md` との整合、ディレクトリ責務分離、既存フロントエンドとのSSE契約互換）はいずれも維持されています。セキュリティ観点（Ollama以外への通信なし、書き込み先は `backend/data/chat.db` のみ、Tauri `invoke()` 不使用、秘密情報のログ出力なし）にも変化はありません。

検証で起動したプロセスはすべて停止済み、検証用の会話は `DELETE /chat/conversations/{id}` 経由で削除済みです。既存DBの移行検証は一時ディレクトリに作った使い捨てDBに対して行っており、`backend/data/chat.db` への直接操作は行っていません。

---

## T3-2 への申し送り（第1回から更新）

- フロントエンドは `useChat.ts:54` で `conversationId: null` を固定送信したままなので、現状はUIから送るたびに新規会話が作られます。バックエンドが返す `conversation_id` を保持する対応は T3-2 の作業内容です
- 第1回の「中1」（タイムゾーンずれ）は解消済みのため、作成日時をそのまま `new Date()` に渡して問題ありません

`AGENTS.md` 3章の連携フローに従い、`feature/t3-chat-history` を `develop` にマージして問題ありません。
