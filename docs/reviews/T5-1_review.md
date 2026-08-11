# T5-1 レビュー結果

対象: T5-1 ChromaDB インデックス構築サービス
ブランチ: `feature/t5-rag-index`（`develop` = `6985c6e` との差分 + 未追跡ファイル `backend/services/rag.py`, `backend/services/indexer.py`）
レビュー日: 2026-08-11

## 判定

**要修正**

RAGの中核部分は**設計どおりに動きます**。`collection名: project_{project_id}`、`chunk_size=500` / `chunk_overlap=50`、`top_k=5`、Ollama経由のEmbedding、`last_modified` による差分更新、削除ファイルの同期、バックグラウンド実行と進捗更新、`DELETE /projects/{id}` からの collection 削除まで、すべて実測で期待どおりでした。インデックス中に `DELETE` した場合もロックで保護され、孤児 collection は残りませんでした。

指摘は3件で、いずれも**インデックスが失敗した／中断したときの振る舞い**に集中しています。特に「失敗理由がどこにも残らない」「再起動すると未完了のインデックスが `done / 100` になる」の2点は、次のT5-2（進捗インジケーター）とT6-2（送信前の差分更新）がこのAPIの値を信じて作られるため、先に直しておく価値があります。

---

## 検証環境

- バックエンド: `DATABASE_URL` / `CHROMA_DB_PATH` をスクラッチパッド配下へ向けて `uvicorn backend.main:app --port 8000` を起動
- Ollama: 稼働中（`nomic-embed-text:latest` インストール済み）
- 検証用フォルダ: 13ファイル（`.md`×8 / `.txt`×3 / 空ファイル1 / `.git`・`node_modules` 配下各1）、200ファイル、1000ファイルの3種類
- リポジトリの `backend/data/chat.db` は一度も開いていません（更新時刻に変化なし）。作成したプロジェクトはすべて `DELETE /projects/{id}` API 経由で削除済み

---

## 指摘事項

### 中1: インデックス失敗の理由がどこにも残らない

**該当箇所**: `backend/services/indexer.py:68-69`

```python
except Exception:  # noqa: BLE001 - バックグラウンド処理の失敗を進捗状態へ反映する。
    fail_indexing(project_id, processed_files)
```

例外を握りつぶし、`index-status` を `error` にするだけで、**ログ出力も例外内容の保持も一切ありません**。

**実測（Embeddingモデル名を存在しない値にして起動）**

```
$ curl -s .../index-status
{"status":"error","progress":0}

$ tail サーバーログ
INFO:     127.0.0.1:49429 - "POST /projects HTTP/1.1" 201 Created
INFO:     127.0.0.1:49431 - "GET /projects/.../index-status HTTP/1.1" 200 OK
            ← 失敗に関する出力は1行もない
```

`error` としか分からないため、開発者もユーザーも原因を切り分けられません。このアプリで実際に起きる失敗理由は、

- Ollamaが起動していない
- `nomic-embed-text` が `ollama pull` されていない
- フォルダの読み取り権限がない

のいずれかがほとんどで、**どれも対処方法がまったく違います**。`requirements.md` 89行目は「Ollamaが起動していない場合はUI上にわかりやすいエラーを表示する」と定めていますが、`index-status` が `error` しか返さない以上、T5-2 側で「わかりやすいエラー」を出す材料がありません。

このプロジェクトには**すでに同じ状況の前例があり、そちらではログを出しています**。

```python
# backend/services/chat_history.py:141
logger.warning("会話タイトルを生成できませんでした", exc_info=True)
```

タイトル生成という軽微な処理ですらスタックトレースを残しているのに、インデックス構築という重い処理が無言で失敗するのは一貫していません。

**対応**: `indexer.py` にも `logger = logging.getLogger(__name__)` を用意し、`logger.warning("プロジェクトのインデックス構築に失敗しました", exc_info=True)` 相当を出してください。あわせて、T5-2でエラー内容を表示できるよう、`index-status` のレスポンスに理由を載せるか（`design.md` 4章の `{status, progress}` を変える場合は設計書の更新が必要）、最低限ログだけでも残す形にしてください。

---

### 中2: 失敗時の `progress` にパーセントではなくファイル数がそのまま渡っている

**該当箇所**: `backend/services/indexer.py:69` / `backend/services/index_status.py:20-21`

正常時はパーセントに換算していますが、

```python
update_index_progress(project_id, processed_files * 100 // total_files)   # ← パーセント
```

失敗時は**換算せずファイル数を渡しています**。

```python
fail_indexing(project_id, processed_files)                                 # ← 件数
```

`fail_indexing` 側は `min(max(progress, 0), 100)` でクランプするだけなので、値の意味が入れ替わったまま `IndexStatusResponse.progress` に載ります。

**実測（200ファイル中150件目で失敗させたケース）**

```
総ファイル数      : 200
成功したファイル数: 150  (= 75% 相当)
index-status      : status='error' progress=100
```

**75%で失敗したのに「100%」と報告されます。** クランプのおかげでバリデーションは通ってしまうので、静かに間違った値が出ます。逆に、ファイル数が100未満のプロジェクトでは実際より低い値になります（12ファイル中5件成功なら「41%」であるべきところ「5%」）。

T5-2の進捗インジケーターはこの値をそのまま描画するため、「エラーなのにバーが満タン」という表示になります。

**対応**: `fail_indexing(project_id, processed_files * 100 // total_files if total_files else 0)` のようにパーセントへ換算してから渡してください。`total_files` は `try` の内側で定義されているため、`except` から参照するには初期値を関数先頭に移す必要があります。

---

### 中3: バックエンド再起動で、未完了のインデックスが `done / 100` になる

**該当箇所**: `backend/services/index_status.py:24-25`

```python
def get_index_status(project_id: str) -> tuple[IndexState, int]:
    return index_statuses.get(project_id, ("done", 100))
```

`index_statuses` は in-memory dict（`implementation_plan.md` T5-1 の指定どおり）なので、プロセスが落ちると消えます。未登録IDの既定値が `done / 100` のため、**中断されたインデックスが「完了」として報告されます**。

T4-1のレビューでも同じ既定値を指摘しましたが、あのときは「まだ実インデクサーがないので実害なし」でした。T5-1で実データが入ったことで、**実害のある状態になりました**。

**実測（1000ファイルのプロジェクトを、インデックス中にバックエンドを停止して再起動）**

```
19:27:21 {"status":"indexing","progress":0}
   …
19:27:28 {"status":"indexing","progress":29}
=== バックエンドを停止 → 再起動 ===
{"status":"done","progress":100}          ← 完了扱い

実際にインデックスされていたファイル数: 334 / 1000
```

**666ファイルが未インデックスのまま「完了」になりました。**

これは稀なケースではありません。`design.md` のとおり FastAPI は Tauri のサイドカーで「アプリ終了時に自動停止」します。つまり**アプリを終了するたびにこの状態になり得ます**。大きめのフォルダを登録した直後にアプリを閉じるという、ごく普通の操作で発生します。

影響:

- T5-2のインジケーターが「完了」と表示する
- T6-2は送信直前に差分更新をかける設計（`design.md` 413行目「送信ボタン押下直後に差分更新（更新完了後にRAG検索・Ollama呼び出しを行う）」）なので**検索結果自体は最終的に正しくなります**が、その代わり最初の1通目で666ファイル分の待ち時間が発生します。今回の実測スループット（約40ファイル/秒）でも17秒、実運用のドキュメントサイズならさらに伸びます。しかもこの間、チャット画面には進捗が出ません

**対応（いずれか）**:

- アプリ起動時に全プロジェクトへ `start_project_indexing()` を投げる。インデックス済みなら差分更新なので実質ノーコストで、状態も正しく `indexing → done` を辿ります（実測: 変更なしのプロジェクトの再実行は 0.01 秒）
- または `index-status` の既定値を「未確定」として扱えるようにする

前者が既存の構造にそのまま乗るので簡単です。どちらも採らず現状を仕様とする場合は、`implementation_plan.md` にその判断とT6-2への影響を明記してください（`AGENTS.md` 11章）。

---

## 軽微な指摘

### 軽微1: `.git` / `node_modules` などを除外していない

**該当箇所**: `backend/services/indexer.py:22-30`

`rglob("*")` で拡張子だけを見ているため、隠しディレクトリや依存ディレクトリの中身もすべてインデックス対象になります。

**実測（`.git/HIDDEN.md` と `node_modules/pkg/README.md` を置いた13ファイルのフォルダ）**

```
indexed files: 12
   .git/HIDDEN.md              ← 入っている
   doc1.md 〜 doc6.md
   docs/note1.txt 〜 note3.txt
   node_modules/pkg/README.md  ← 入っている
   target.md
```

`implementation_plan.md` は「`.md` / `.txt` ファイルを再帰的に取得」としか書いていないので**仕様違反ではありません**。ただ、ユーザーがコードリポジトリをプロジェクトフォルダに選んだ場合、`node_modules` 配下の大量のREADMEや `.git` の内部ファイルまでEmbeddingすることになり、初回インデックスが極端に遅くなるうえ、RAGの検索結果もノイズだらけになります。除外リスト（`.git`, `node_modules`, `.venv`, `dist`, `target` など）は数行で入るので、入れておくことを勧めます。

### 軽微2: モジュールを import しただけで ChromaDB のディレクトリとDBファイルが作られる

**該当箇所**: `backend/services/rag.py:25`

```python
chroma_client = chromadb.PersistentClient(path=str(CHROMA_DB_PATH))
```

モジュールスコープなので、`backend.services.rag` を import した時点でディスクに書き込みが発生します。実際、**このレビュー時点でリポジトリに `backend/data/chroma_db/chroma.sqlite3`（188KB）が存在していました**。

```
$ ls -laT backend/data/chroma_db/
-rw-r--r--@ 1 daisuke staff  188416 Aug 11 19:14:30 2026 chroma.sqlite3
```

タイムスタンプは私が検証用サーバーを起動する前（19:22:44）で、`T5-1_impl.md` の動作確認にある「RAG関連モジュールのインポート成功」の副作用と考えられます。`.gitignore` の `data/` に含まれるためコミットされる心配はありませんが、「import しただけで永続ストレージが生成される」という性質は、今後のCLIツールや `--help` 的な実行でも同じことが起きます。遅延初期化（初回アクセス時に生成）にしておくと安全です。

なお、`CHROMA_DB_PATH` を環境変数で切り替えられる作りになっている点は良く、おかげで今回の検証をリポジトリ外で完結できました。

### 軽微3: `get_project_lock` の生成自体が競合しうる

**該当箇所**: `backend/services/rag.py:37-40`

```python
def get_project_lock(project_id: str) -> Lock:
    if project_id not in project_locks:
        project_locks[project_id] = Lock()
    return project_locks[project_id]
```

この関数は `asyncio.to_thread` 経由で**複数のワーカースレッドから呼ばれます**（`index_file` と `delete_project_collection` は別スレッドで並行に走り得ます）。「存在チェック → 生成」がアトミックでないため、同じ `project_id` に対して2つのスレッドが**別々の `Lock` オブジェクトを受け取る**可能性があります。そうなるとロックが排他になりません。

発生確率は「collectionへの初回アクセスが同時に2回起きたとき」に限られるので低く、実際に今回の検証で `DELETE` をインデックス中に投げたケースでは正しく直列化されました（孤児 collection なし、エラーログなし）。ただし、守っている対象がベクトルDBの整合性なので、モジュールレベルの `Lock` で `project_locks` の生成自体を保護するか、`defaultdict` ではなく単一のグローバルロックにするなど、確実な形にしておくことを勧めます。

---

## 任意（対応しなくてもマージ可）

1. **空ファイルが毎回再インデックスされる** — `index_file` はチャンクが0件だと `collection.delete()` だけして early return するため、`last_modified` が記録されません。結果、変更がなくても毎回処理対象になります。実測でも、変更なしの再実行で `empty.md` だけが毎回拾われました（Embedding呼び出しは発生しないので 0.01 秒。実害はほぼありません）。

   ```
   [no change]        re-indexed 1 files in 0.01s -> ['empty.md']
   [doc3.md modified] re-indexed 2 files in 0.10s -> ['doc3.md', 'empty.md']
   ```

2. **`search()` は同期関数でブロッキング** — `embed_query` と `collection.query` はどちらも同期I/Oです。T6-2 から呼ぶときは必ず `asyncio.to_thread` 経由にしてください（`indexer.py` が既にそうしているのと同じ理由）。

3. **`project_locks` が解放されない** — プロジェクトを削除しても辞書から消えません。1エントリは小さいので実害はありませんが、`remove_index_status` と同じタイミングで消しておくと対称になります。

4. **ファイル数の上限がない** — `create_project` は任意の絶対パスを受け付けるので、ホームディレクトリや `/` を選ぶことも可能です。今回の実測スループットは約40ファイル/秒（1000ファイルで約25秒）なので、数万ファイルのフォルダを選ぶと初回インデックスが実用的な時間で終わりません。T5-2でファイルツリーを出すときに件数が見えるようになるので、そこで上限や警告を検討してもよいと思います。

5. **`# noqa: BLE001` は不要** — Ruff はデフォルトルールセット（`E`, `F`）で運用されており、`BLE001`（flake8-blind-except）は有効になっていません。実際 `ruff check backend` は noqa を外しても通ります。

---

## レビュー観点ごとの所見

### `design.md` / `implementation_plan.md` との整合

| 項目 | 定義 | 実装 | 結果 |
|---|---|---|---|
| collection名 | `project_{project_id}` | `get_collection_name()` | ✅ 実測で `project_e115ae06-…` を確認 |
| Embeddingモデル | `nomic-embed-text`（Ollama経由） | `OllamaEmbeddings(model=…, base_url=OLLAMA_BASE_URL)` | ✅ 既定値も一致 |
| chunk_size | 500 | `CHUNK_SIZE = 500` | ✅ 定数化されている |
| chunk_overlap | 50 | `CHUNK_OVERLAP = 50` | ✅ |
| top_k | 5 | `TOP_K = 5` | ✅ 実測で5件返却 |
| 対象ファイル | `.md` / `.txt` を再帰的に | `SUPPORTED_FILE_SUFFIXES` + `rglob` | ✅（除外については軽微1） |
| バックグラウンド実行 | `asyncio.create_task` | `start_project_indexing` | ✅ |
| 進捗管理 | 処理済み / 全件を in-memory dict | `index_statuses` | ✅（失敗時は中2、再起動時は中3） |
| 差分更新 | `last_modified` 比較 | `st_mtime_ns` をメタデータ保存 | ✅ 実測で変更ファイルのみ再処理 |
| 作成時に初回インデックス開始 | T5-1で接続 | `post_project` | ✅ |
| `DELETE` から collection 削除 | T5-1で接続 | `delete_project_by_id` | ✅ 実測で collection 消滅を確認 |

`code_style.md` の「マジックナンバーは `design.md` の値をそのまま定数化」も守られています。

### `AGENTS.md` 7章（アーキテクチャ制約）

| 制約 | 結果 |
|---|---|
| LLM推論・EmbeddingはすべてOllama経由 | ✅ `OllamaEmbeddings` のみ。ChromaDBの既定Embedding関数は使わず、明示的に `embeddings=` を渡しているので、`onnxruntime` によるローカル埋め込みへフォールバックしない作りになっています |
| Ollama以外の外部通信を追加しない | ✅ `base_url` は `config.get_ollama_base_url()`（ローカルhttpのみ許可）を経由。新規の通信先なし |
| Tauri側にロジックを置かない | ✅ `src-tauri/` に変更なし |
| ファイル操作のパストラバーサル対策 | 対象外（T5-1は**読み取り専用**。書き込みはT6-1） |
| 確認モード/自走モードのゲート | 対象外（T6以降） |

書き込み系の処理は含まれておらず、ファイルI/Oは `read_text(encoding="utf-8", errors="replace")` による読み取りのみです。バイナリ混じりの `.txt` でも例外にならず、インデックス全体が止まらない作りになっています。

> 補足（対応不要）: プロジェクトフォルダ内にフォルダ外を指すシンボリックリンクの**ファイル**があると、その中身が読まれてベクトルDBに入ります。ディレクトリのシンボリックリンクは Python の `rglob` が既定で辿らないので再帰的な流出はありません。すべてローカルに閉じており外部送信もないため実害は小さいですが、T6-1でファイル書き込みを実装するときは同じ経路が書き込みに使われないよう注意してください。

### `code_style.md`

| 項目 | 結果 |
|---|---|
| 型ヒント必須 | ✅ すべての関数に付いています |
| I/Oバウンドは async/await | ✅ ChromaDB・Embeddingは同期APIなので `asyncio.to_thread` でイベントループを塞がない構成。設計判断としても妥当です |
| Pydanticでバリデーション | ✅ 既存の `IndexStatusResponse` をそのまま利用 |
| ロジックは `services/`、`api/` は変換のみ | ✅ `projects.py` の追加分は呼び出しのみ |
| 制御構文のネスト2階層まで | ✅ 最大2階層 |
| マジックナンバーの定数化 | ✅ |
| Black / Ruff | ✅ `black --check backend` → 17 files unchanged、`ruff check backend` → All checks passed! |

### `requirements.md`（エラーハンドリング）

Ollamaが使えないときにインデックスが `error` へ遷移すること自体は確認しました。ただし中1のとおり**理由が残らない**ため、「UI上にわかりやすいエラーを表示する」という要件をT5-2で満たすための情報が足りません。

### 動作確認サマリー（実測）

| シナリオ | 結果 |
|---|---|
| `POST /projects` → 初回インデックス開始 | ✅ `indexing / 0` から開始 |
| 進捗の推移（200ファイル） | ✅ `0 → 23 → 45 → 69 → 93 → 100` と滑らかに更新 |
| 完了状態 | ✅ `{"status":"done","progress":100}` |
| インデックス結果（13ファイルのフォルダ） | ✅ 12ファイル / 45チャンク（空ファイルを除く） |
| `search()` の関連度 | ✅ 上位3件が意図した `target.md` のチャンク、`top_k=5` を遵守、0.06秒 |
| 差分更新（変更なし） | ✅ 再Embeddingなし（0.01秒） |
| 差分更新（1ファイル変更） | ✅ `doc3.md` のみ再処理（0.10秒） |
| 差分更新（1ファイル削除） | ✅ インデックスから除去（12 → 11件） |
| `DELETE /projects/{id}` | ✅ 204、collection 消滅を確認 |
| 存在しないIDへの `DELETE` | ✅ 404 |
| **インデックス実行中の `DELETE`** | ✅ 204。孤児 collection なし、サーバーログにエラーなし。ロックによる直列化が効いています |
| Embedding失敗時 | ⚠️ `error` にはなるが理由が残らない（中1）、`progress` の意味がずれる（中2） |
| 再起動を挟んだ場合 | ❌ 未完了でも `done / 100`（中3） |
| `black --check` / `ruff check` | ✅ 両方成功 |

### `AGENTS.md` 10章（禁止コマンド）への抵触

差分・レビュー作業のいずれにも抵触はありません。

- `chroma_client.delete_collection()` は**APIフロー（`DELETE /projects/{id}`）経由でのみ**実行し、スクリプトから直接は呼んでいません
- 検証で使った補助スクリプトは `list_collections()` / `get_indexed_file_modified_times()` / `search()` / `index_project()` といった読み取り・通常のアプリケーションコードのみです
- SQLiteファイルへの直接操作なし。`backend/data/chat.db` は開いておらず更新時刻に変化なし
- ChromaDBの保存先は `CHROMA_DB_PATH` でスクラッチパッドへ隔離
- 検証で作成したプロジェクト（4件）はすべて `DELETE /projects/{id}` API 経由で削除済み。最終状態は `GET /projects` = `[]`、collections = `[]`
- 起動したuvicornはすべて停止済み

> 1点だけ状態の報告です。リポジトリに `backend/data/chroma_db/`（軽微2で触れたCodexの検証由来と思われるファイル）が残っています。`.gitignore` 対象なのでコミットされることはありませんが、私の判断では削除していません。不要であれば開発者の方で削除してください。

---
---

# 第2回レビュー（2026-08-11）— 敵対的検証

対象: 第1回の指摘（中1〜3・軽微1〜3）への対応と、修正によって新たに生じた欠陥の探索
方針: 「直っているか」の確認だけでなく、**新しいコードを壊しにいく**方針で検証した。特に今回追加された「起動時の全プロジェクト再インデックス」（`backend/main.py`）を最大の攻撃面とみなし、異常系を重点的に突いた。

## 判定

**要修正**

第1回の指摘は**6件すべて解消**しています。修正の質も高く、失敗時のログにはOllamaのエラーがそのまま出るところまで到達しました。

しかし、**中3の修正として追加された起動時再インデックスが、新たに重大な欠陥を持ち込みました**。プロジェクトフォルダが一時的に読めない状態でアプリを起動すると、そのプロジェクトのインデックスが**警告ひとつ出ないまま全消去され、`done / 100`（完了）と報告されます**。修正前は「未完了なのに完了と言う」だけでしたが、修正後は「**インデックスを消したうえで完了と言う**」に変わっており、症状としては悪化しています。

---

## 新規指摘

### 重大1: フォルダが読めない状態で起動すると、インデックスが全消去され「完了」と報告される

**該当箇所**: `backend/services/indexer.py:26-37`（`find_project_files`）/ `backend/main.py:16-18`（起動時再インデックス）

**原因**

`find_project_files` は `os.walk` を使っていますが、`os.walk` は**対象ディレクトリが存在しない場合も、読み取り権限がない場合も、例外を投げずに空を返します**（既定の `onerror=None` はエラーを黙殺する仕様）。

```
$ python -c "import os; print(list(os.walk('/private/tmp/definitely-not-here-xyz')))"
[]                                    ← 例外なし

$ 権限を落としたサブディレクトリ
unreadable walk: [('...tmphnmosmzu', [])]   ← 中のファイルが消えて見える
```

`index_project` はこの空リストを「**フォルダが空になった**」と解釈します。

```python
current_paths = { ... }                     # → 空集合
removed_paths = set(indexed_files) - current_paths   # → 既存の全ファイル
await asyncio.to_thread(delete_indexed_files, project_id, list(removed_paths))  # → 全削除
total_files = len(project_files)            # → 0
if total_files == 0:
    finish_indexing(project_id)             # → done / 100
    return
```

つまり「フォルダが消えた／読めない」と「フォルダが空になった」を区別できておらず、前者でも後者の処理（インデックスの掃除）が走ります。

**実測1: フォルダがリネーム／移動されていた場合**

```
1. プロジェクト作成 → インデックス完了（10ファイル / 30チャンク）
2. サーバー停止（＝アプリ終了。Tauriサイドカーは毎回停止する）
3. フォルダをリネーム（外付けドライブ未マウント、iCloudのオフロード、
   ユーザーによるフォルダ移動などに相当）
4. サーバー再起動

index-status : {"status":"done","progress":100}
インデックス : indexed files: 0 []
               chunks: 0
サーバーログ : (警告・エラーの出力なし)
```

**30チャンク／10ファイルが跡形もなく消え、しかも「完了」と表示されます。**

**実測2: 権限がない場合（macOSのTCC未許可に相当）**

```
$ chmod 000 <プロジェクトフォルダ> して再起動

index-status : {"status":"done","progress":100}
インデックス : indexed files: 0 []
サーバーログ : (警告なし)
```

こちらのほうが深刻です。macOSでは、`~/Documents` や `~/Desktop` 配下へのアクセスにユーザーの許可（TCC）が必要です。**アプリが許可を得る前の初回起動や、ユーザーが許可を取り消した後の起動で、この経路にそのまま入ります。**

**なぜ第1回より悪化したと言えるか**

| | 第1回時点 | 現在 |
|---|---|---|
| 発生タイミング | プロジェクト作成時のみ | **アプリ起動のたび**（全プロジェクトが対象） |
| 症状 | 未完了なのに `done / 100` | **インデックスを全削除**したうえで `done / 100` |
| 検知手段 | なし | なし（ログにも出ない） |

`design.md` のとおりFastAPIはTauriのサイドカーで「アプリ終了時に自動停止」するため、**起動時再インデックスはアプリを開くたびに必ず走ります**。外付けドライブやネットワーク共有、クラウド同期フォルダをプロジェクトに指定していると、マウントが間に合わないだけで消えます。

**復旧はするが無償ではない（実測）**

```
フォルダを元に戻して再起動 → indexed files: 10 / chunks: 30
```

フォルダが戻れば次回起動時の再インデックスで作り直されるため、**恒久的なデータ損失ではありません**。ただし、

- 全ファイルの再Embeddingが発生します（実測スループット約40ファイル/秒なので、1000ファイルで約25秒、実運用サイズならさらに長い）
- 復旧するまでの間、`search()` は0件を返します。T6-2のプロジェクトチャットは**コンテキストなしで、エラーも出さずに回答します**（RAGが効いていないことに気づけません）

**対応（推奨）**

`index_project` の先頭でフォルダの可用性を確認し、読めない場合は「空」ではなく**失敗**として扱ってください。

```python
if not project_folder.is_dir():
    raise FileNotFoundError(project_folder)   # → 既存の except で warning ログ + error 状態
```

`os.walk(project_folder, onerror=...)` でエラーを拾って再送出する形にすれば、権限エラー（実測2）も同じ経路で扱えます。すでに `except Exception` がログ出力と `fail_indexing` を行う作りになっているので、**例外を握りつぶさず上げるだけで、警告ログと `error` ステータスの両方が自動的に付いてきます**。

---

## 第1回指摘への対応状況（すべて解消）

| # | 指摘 | 状態 |
|---|---|---|
| 中1 | 失敗理由がどこにも残らない | ✅ 解消 |
| 中2 | 失敗時の `progress` にファイル数が渡る | ✅ 解消 |
| 中3 | 再起動で未完了が `done / 100` になる | ✅ 解消（ただし重大1を持ち込んだ） |
| 軽微1 | `.git` / `node_modules` を除外していない | ✅ 解消 |
| 軽微2 | import だけでChromaDBが生成される | ✅ 解消 |
| 軽微3 | `get_project_lock` の生成が競合しうる | ✅ 解消 |

### 中1・中2 → 解消（「インデックス中にOllamaが落ちる」を実際に再現して確認）

ローカル（`127.0.0.1:11435`）にOllamaスタブを立て、**6ファイル目までは正常応答、7ファイル目以降は500を返す**という、実運用で最も起こりやすい「途中でOllamaが死ぬ」状況を作りました。

```
index-status : {"status":"error","progress":60}
実インデックス: indexed files: 6 / chunks: 12
```

- **進捗が正しくパーセントになりました**（6/10 = 60%）。第1回の実装なら `progress: 6` になっていた値です
- ログに原因が出るようになりました。しかも**根本原因まで到達しています**:

```
プロジェクトのインデックス構築に失敗しました
Traceback (most recent call last):
  File ".../backend/services/indexer.py", line 64, in index_project
    await asyncio.to_thread(
  ...
ollama._types.ResponseError: ollama is gone (status code: 500)
```

`logger.warning` がuvicornのログに実際に出力されることも確認しました（ロガー未設定でも Python の last-resort ハンドラ経由で stderr に出ます）。これで「Ollamaが起動していない／モデル未pull／権限エラー」の切り分けが可能になり、第1回で指摘した `requirements.md` 89行目の要件に必要な材料が揃いました。

### 中3 → 解消（中断したインデックスが再開される）

1000ファイルのプロジェクトをインデックス中に停止し、再起動しました。

```
（1回目）indexing 0% → 28% で強制停止
停止時点の実インデックス: 330 / 1000 ファイル

（再起動）
  {"status":"indexing","progress":47}    ← 完了扱いにならず再開している
  {"status":"indexing","progress":53}
  ...
  {"status":"done","progress":100}
最終: indexed files: 1000
```

差分更新が効いているため、既にインデックス済みの330ファイルは再Embeddingされず、progressが47%から始まっています。設計としても素直で、良い直し方です。

### 軽微1 → 解消

`os.walk` の `directory_names[:]` を書き換える定石どおりの実装で、除外ディレクトリ配下に再帰しません。

```
配置したファイル13件のうち、インデックスされたのは10件:
  doc1.md 〜 doc6.md, docs/note1.txt 〜 note3.txt, target.md
除外されたもの:
  .git/HIDDEN.md, node_modules/pkg/README.md, dist/bundle.md
```

### 軽微2 → 解消

```
$ python -c "import backend.services.rag as rag; print(rag.chroma_client)"
import OK / chroma_client = None
  ディレクトリは作られていない（OK）
```

`get_chroma_client()` の遅延初期化が効いており、import だけではディスクに触れません。二重生成を防ぐ `chroma_client_lock` も付いています。

### 軽微3 → 解消（64スレッドで殴って確認）

```
同一project_idへ64スレッドが同時に初回アクセス
  → 得られたLockの種類数: 1        （排他が成立）
別々のproject_id 200件を同時生成
  → 生成されたLock数: 201          （取りこぼしなし）
再入テスト: 1回目=True 2回目=False （非再入。ネスト呼び出しがあればデッドロック）
```

`project_locks_lock` + `setdefault` で正しく直列化されています。`Lock` は非再入なので、`get_project_lock` を保持したまま再取得する経路があれば即デッドロックしますが、`index_file` / `search` / `delete_indexed_files` / `delete_project_collection` / `get_indexed_file_modified_times` のいずれも入れ子になっていないことをコード上で確認しました。ロック順序も「`project_lock` → `chroma_client_lock`」で一貫しており、逆転はありません。

---

## その他の敵対的検証（問題なし）

| 攻撃 | 結果 |
|---|---|
| `os.walk` はシンボリックリンクのディレクトリを辿るか | ✅ 既定 `followlinks=False` のため辿らない。第1回の `rglob` と同じ安全性を維持 |
| 起動時再インデックスがイベントループを塞がないか | ✅ `asyncio.create_task` + `to_thread`。1000ファイルのインデックス中も `GET /projects/{id}/index-status` が即応 |
| インデックス実行中の `DELETE` | ✅ 204、孤児collectionなし（第1回で確認済み。当該コードに変更なし） |
| 検証終了後の孤児collection | ✅ 全プロジェクト削除後 `collections: []` |
| `black --check` / `ruff check` | ✅ 両方成功（17 files unchanged / All checks passed!） |

> 前回 任意 として挙げた項目（空ファイルの毎回再処理、`search()` がブロッキング、`project_locks` の未解放、ファイル数上限なし）は未対応のままですが、いずれも任意のため判定には influence しません。`# noqa: BLE001` は削除されています。

---

## マージにあたって

- **重大1の修正が必要です。** `index_project` の先頭に `project_folder.is_dir()` のガードを入れる（数行）だけで、既存の warning ログ + `error` ステータスの経路に乗ります
- ブランチ `feature/t5-rag-index` にはまだコミットがありません（先端は `develop` = `6985c6e`）。`AGENTS.md` 3章に従い `T5-1: …` の形式でコミットしてからマージしてください

## 環境の後始末

- 検証で作成したプロジェクトはすべて `DELETE /projects/{id}` API 経由で削除済み。最終状態は `GET /projects` = `[]`、`collections: []`
- SQLite / ChromaDB はすべてスクラッチパッド配下に隔離。`backend/data/chat.db` は開いておらず更新時刻に変化なし（`Aug 10 21:12`）
- `chroma_client.delete_collection()` はAPIフロー経由でのみ実行。スクリプトからの直接呼び出しはしていません
- 検証で立てたOllamaスタブは `127.0.0.1:11435` にバインドしたローカルプロセスで、外部への通信は発生していません。uvicorn・スタブとも停止済み

---
---

# 第3回レビュー（2026-08-11）— 敵対的検証

対象: 第2回の重大1（フォルダが読めないときのインデックス全消去）への対応と、そのガード自体の破壊試験
差分: 前回から変更されたのは `backend/services/indexer.py` の `find_project_files`（`is_dir()` ガード + `os.walk(onerror=…)`）のみ

## 判定

**要修正**

**重大1は解消しました。** フォルダ消失・権限なしのいずれでも、既存インデックスは1チャンクも失われず `error` で停止し、警告ログも出ます。正当に空のフォルダ／正当なファイル削除という「消してよいケース」も従来どおり動いており、区別が正しくできています。

一方、ガードを破壊しにいった結果、**単一のファイル／サブフォルダのI/Oエラーがインデックス処理全体を巻き添えにして中断させる**ことが分かりました。3通りの引き金を再現しています。うち1つは今回の `onerror` 追加で新たに生じたもの、2つは以前から潜んでいたものです。いずれもインデックスは保全される「安全側の失敗」ですが、`error` のまま復帰手段がない状態になります。

---

## 第2回 重大1 の確認 → 解消

**実測A: フォルダをリネームして再起動**

```
  status: {"status":"error","progress":0}
  indexed=10 chunks=23        ← 消えていない（第2回は 0 / 0 だった）
  warningログ件数: 1
```

**実測B: トップフォルダを `chmod 000` して再起動（macOSのTCC未許可に相当）**

```
  status: {"status":"error","progress":0}
  indexed=10 chunks=23        ← 消えていない
  warningログ件数: 1
```

`find_project_files` が例外を投げることで `delete_indexed_files` の削除同期に到達しなくなり、既存 collection が保全されます。`except Exception` の既存経路にそのまま乗るので、warningログと `error` ステータスも自動的に付いています。指摘したとおりの、最小で正しい直し方です。

### 回帰確認（「消してよいケース」が壊れていないか）

ガードが厳しすぎると、正当な削除まで拒否して差分更新が機能しなくなります。両方確認しました。

| ケース | 期待 | 実測 |
|---|---|---|
| **F. 正当に空のフォルダ**を新規プロジェクトに指定 | `done / 100` | ✅ `{"status":"done","progress":100}` |
| **G. ユーザーが2ファイルを削除**して再起動 | 索引から除去される | ✅ `indexed=10 chunks=23` → `indexed=8 chunks=18`、`done / 100` |

「読めない」と「空」を取り違えずに区別できています。

---

## 新規指摘

### 中1: ファイル1つ・サブフォルダ1つのI/Oエラーで、インデックス処理全体が中断する

**該当箇所**: `backend/services/indexer.py:33-36`（`onerror=raise_walk_error`）/ `backend/services/indexer.py:75`（`file_path.stat()`）

`find_project_files` も `index_project` のループも、個別のエラーを局所的に扱わず、そのまま `index_project` の `except Exception` まで飛ばします。結果、**1件の問題が全ファイルのインデックスを巻き添えにします**。3つの引き金を再現しました。

#### C. サブフォルダが1つ読めない（今回の `onerror` 追加で新たに発生）

```
外付けドライブの .Trashes 相当（chmod 000 のサブフォルダ）を1つ置いて再起動

  status: {"status":"error","progress":0}
  indexed=10 chunks=23        ← 保全されている（安全側）
  例外: PermissionError: [Errno 13] Permission denied: '.../proj/.Trashes'
```

`os.walk` の `onerror` はサブディレクトリの `scandir` 失敗でも呼ばれるため、**読める9割のファイルまで含めて何もインデックスされません**。これは第2回まで存在しなかった挙動です（以前は黙って無視していた＝別の意味で問題でしたが、全体を止めはしませんでした）。

`create_project` は任意の絶対パスを受け付けるので、**外付けボリュームのルートを選ぶと `.Trashes` / `.Spotlight-V100` / `.fseventsd` が該当し、そのプロジェクトは永久に `error` のまま**になります。これらは `EXCLUDED_DIRECTORY_NAMES` にも入っていません。

#### D. 壊れたシンボリックリンク（`*.md`）が1つある（以前から存在）

```
broken.md -> （存在しないファイル） を置いて再起動

  status: {"status":"error","progress":0}
  indexed=10 chunks=23
  例外: FileNotFoundError: [Errno 2] No such file or directory: '.../proj/broken.md'
```

`find_project_files` は壊れたリンクも「`.md` のファイル」として拾い、ループ内の `file_path.stat()`（75行目）で落ちます。**リンクを削除するまで、そのプロジェクトは永久に `error` です。**

#### E. インデックス実行中にユーザーがファイルを削除（以前から存在／最も現実的）

```
1000ファイルのインデックス実行中（16%時点）に f0900.md を1つ削除

  結果: {"status":"error","progress":90}
  例外: FileNotFoundError: [Errno 2] No such file or directory: '.../huge/f0900.md'
```

**90%まで進んだ処理が、ファイル1つの削除で中断します。** ノートフォルダを登録した直後、初回インデックスが走っている最中にユーザーがファイルを整理する――というごく普通の操作で起きます。

#### まとめと影響

| | 新規/既存 | インデックスの保全 | 復帰 |
|---|---|---|---|
| C. 読めないサブフォルダ | **新規**（`onerror` 追加による） | ✅ 保全 | ❌ そのフォルダがある限り永久に `error` |
| D. 壊れたシンボリックリンク | 既存 | ✅ 保全 | ❌ リンクを消すまで永久に `error` |
| E. 実行中のファイル削除 | 既存 | ✅ 保全（90%分は残る） | ⭕ 次回起動の再インデックスで復帰 |

どれもデータを壊さない安全側の失敗であり、**第2回の重大1のような消失は起きません**。問題は復帰手段です。MVPには再インデックスのAPIもUIボタンもなく、リトライの契機はアプリ再起動かT6-2の送信前差分更新だけです。CとDはその再試行でも同じ場所で落ちるため、**ユーザーから見ると「プロジェクトチャットが永久に効かない」状態**になります。T5-2の進捗インジケーターは `error` を出しますが、原因のファイル名はログにしかありません。

**対応（推奨）**

個別のエラーを局所化し、走査全体を落とさない形にしてください。ただし**単純に無視すると第2回の重大1が再発します**（読めなかったファイルが「削除された」と見なされて索引から消える）ため、次の2点をセットにする必要があります。

1. `onerror` では例外を投げず、`logger.warning` で記録して**そのディレクトリだけスキップ**する。同様に、ループ内の `stat()` も `try` で囲んでそのファイルだけスキップする
2. **スキップが1件でも発生した場合は、その回の `delete_indexed_files`（削除同期）を丸ごと見送る**。走査結果が不完全なまま差分削除を行うと、読めなかったファイルの索引が消えてしまうため

トップフォルダ自体が存在しない／読めない場合は、今回どおり全体を失敗させるのが正しい挙動です（そこは現状のままで問題ありません）。

---

## その他の敵対的検証（問題なし）

| 攻撃 | 結果 |
|---|---|
| `is_dir()` を通り抜けるパス（ファイルを指定） | ✅ `is_dir()` が False を返し `FileNotFoundError` |
| ディレクトリへのシンボリックリンクをプロジェクトに指定 | ✅ `is_dir()` はリンクを辿るため正常動作。`os.walk` は `followlinks=False` なので配下のリンクは辿らない |
| `raise_walk_error` が `find_project_files` より後に定義されている | ✅ 呼び出し時解決のため問題なし |
| 正当に空のフォルダを「読めない」と誤判定しないか | ✅ F のとおり `done / 100` |
| 正当なファイル削除の同期 | ✅ G のとおり 10 → 8 ファイルへ縮小 |
| 検証終了後の孤児collection | ✅ `collections: []` |
| `black --check` / `ruff check` | ✅ 両方成功（17 files unchanged / All checks passed!） |

第1回・第2回で解消済みの項目（ログ出力、失敗時の進捗換算、中断インデックスの再開、除外ディレクトリ、遅延初期化、ロック生成）は、`indexer.py` の当該箇所に変更がないため再検証を省略しています。

---

## マージにあたって

- **中1の修正が必要です。** 引き金Cは今回の変更で生じたものなので、少なくともサブディレクトリのエラーをスキップ扱いにする対応は入れてください。その際、上記2点目（走査が不完全なら削除同期を見送る）を必ずセットにしてください
- ブランチ `feature/t5-rag-index` にはまだコミットがありません（先端は `develop` = `6985c6e`）

## 環境の後始末

検証で作成したプロジェクトはすべて `DELETE /projects/{id}` API 経由で削除済み（`GET /projects` = `[]`、`collections: []`）。SQLite / ChromaDB はスクラッチパッド配下に隔離しており、`backend/data/chat.db` は開いておらず更新時刻に変化なし（`Aug 10 21:12`）。権限を落としたディレクトリはすべて元に戻し、作成した壊れたシンボリックリンクも削除済みです。uvicornは停止済みです。

---
---

# 第4回レビュー（2026-08-11）— 敵対的検証

対象: 第3回の中1（個別I/Oエラーで処理全体が中断する）への対応と、その修正の破壊試験
差分: `backend/services/indexer.py`（`ProjectFileScan` の導入・個別スキップ・削除同期の抑止）と `backend/services/rag.py`（Embeddingを既存チャンク削除より前に実行）

## 判定

**承認**

第3回の指摘は3つの引き金すべてで解消しました。加えて、こちらが指摘していなかった**「Embedding失敗で更新前のチャンクが消える」問題を自主的に見つけて直しており**、実測でも保全を確認できました。第1〜3回で挙げた重大・中・軽微の指摘は全件クローズです。

残るのは1件の軽微な指摘のみで、これは**第3回でこちらが「そうしてください」と指示した仕様の副作用**です。実装は指示どおりで、より安全な側に倒れています。マージをブロックする理由にはならないため、精緻化の提案として記録します。

---

## 第3回 中1 の確認 → 3つの引き金すべて解消

いずれも「読める分は最後までインデックスし、読めないものだけを警告付きでスキップする」挙動に変わりました。

### C. 読めないサブフォルダが1つある（第3回の新規指摘）

```
.Trashes 相当（chmod 000）を配置し、同時に new1.md を追加して再起動

  status : {"status":"error","progress":100}
  索引   : indexed=11 chunks=24（new1.md が追加されている）
  log    : スキップします: [Errno 13] Permission denied: '.../proj/.Trashes'
```

第3回は `indexed=10` のまま1件もインデックスされませんでした。今回は**読める分がすべて処理され、追加した新規ファイルも索引に入っています**。

### D. 壊れたシンボリックリンクが1つある

```
broken.md（リンク切れ）を配置し、同時に new2.md を追加して再起動

  status : {"status":"error","progress":100}
  索引   : indexed=12 chunks=25（new2.md が追加されている）
  log    : スキップします: [Errno 2] No such file or directory: '.../proj/broken.md'
```

### E. 1000ファイルのインデックス実行中にファイルを削除（最も現実的な引き金）

```
20%進行時点で f0900.md を削除

  結果       : {"status":"error","progress":100}
  索引済み   : 999 / 999（削除した1件を除く全ファイル）
  f0900.md   : 索引に含まれない
  スキップ警告: 1件
```

第3回は**90%で全体が中断**していました。今回は残り全件を処理しきっています。警告も過不足なく1件だけです。

### 副作用の確認: 個別スキップで第2回の重大1が再発していないか

「個別エラーを無視すると、読めなかったファイルが削除扱いされて索引から消える」という再発リスクを指摘していましたが、`has_errors` による削除同期の抑止で正しく塞がれています。

| 回帰テスト | 結果 |
|---|---|
| **A.** フォルダをリネームして再起動 | ✅ `error / 0`、`indexed=11 chunks=23` を保全 |
| **B.** トップフォルダ `chmod 000` で再起動 | ✅ `error / 0`、`indexed=11 chunks=23` を保全 |
| **F.** 正当に空のフォルダ | ✅ `done / 100`（第3回で確認済み、ロジック不変） |
| **G'.** 壊れたリンクを取り除いて再起動 | ✅ 削除同期が復活し `done / 100`、削除済みの `doc6.md` が索引から除去（12 → 11件） |

---

## 自主的な修正の確認: Embedding失敗が既存チャンクを壊さない

`index_file` の処理順が「削除 → Embedding → upsert」から「**Embedding → 削除 → upsert**」に変わっています。これはこちらが指摘していなかった問題で、旧実装ではファイルを更新した後にOllamaが落ちると、**更新前のチャンクまで失われて検索対象から丸ごと消える**状態でした。

```
doc1.md を書き換えたうえで、Ollamaを全リクエスト失敗させて再起動

  失敗前: doc1.md のチャンク数: 2 / 全チャンク: 23
  status: {"status":"error","progress":0}
  失敗後: doc1.md のチャンク数: 2 / 全チャンク: 23     ← 維持されている
```

旧実装ならここで doc1.md のチャンクが0になっていました。良い発見と良い直し方です。空ファイルの場合は従来どおり削除だけ行う分岐も残っており、内容を空にしたファイルが索引に残り続けることもありません。

---

## 軽微1: エラーが1件でも残っていると、削除同期が止まったままになる

**該当箇所**: `backend/services/indexer.py:88-93`

これは第3回でこちらが提示した対応方針（「スキップが1件でも発生した回は削除同期を丸ごと見送る」）をそのまま実装したもので、**指示どおりです**。安全側の判断としても正しく、第2回の重大1を確実に防いでいます。そのうえで、副作用を実測したので記録します。

**実測: 壊れたリンクを残したまま、ユーザーがファイルを削除**

```
broken.md を置いたまま doc6.md を削除して再起動

  status : {"status":"error","progress":100}
  索引   : indexed=12（doc6.md が残ったまま）

RAG検索「プロジェクト説明 6」:
  ヒット: ['doc6.md', 'doc6.md', 'doc5.md', 'doc1.md', ...]
  → 削除したはずの doc6.md が上位2件を占める
```

`.Trashes` のような読めないサブフォルダや壊れたシンボリックリンクは**放置されると恒久的に存在し続ける**ため、その間ずっと削除同期が止まります。結果として、ユーザーが削除したファイルの内容がRAG検索に出続け、T6-2 ではそれがコンテキストとしてLLMに渡ります。エラー条件を取り除けば次回起動で同期が復活することは G' で確認済みです（12 → 11件）。

**提案（任意）**: 抑止をプロジェクト全体ではなく**失敗した範囲だけ**に絞ると、この副作用がなくなります。

- ディレクトリ `D` の走査に失敗した場合 → `D` 配下の索引パスだけを削除対象から除外する
- ファイル `F` の `stat()` に失敗した場合 → `F` だけを削除対象から除外する
- それ以外のパスは通常どおり削除同期の対象にする

`find_project_files` はすでに `walk_errors` に `OSError` を集めているので、`error.filename` からプレフィックスを組み立てれば実装できます。MVPのスコープとしては現状のままでも問題ないので、T6-2でRAGの精度が気になった段階で対応すれば十分です。

> 併せて細かい点: エラーありで完走した場合の `fail_indexing(project_id, 100)` は「全ファイルを処理し終えたが一部スキップした」という意味で妥当ですが、T5-2の進捗バーは「エラーなのに満タン」という表示になります。ステータス表示が主で進捗が従なら問題ありません。

---

## その他の敵対的検証（問題なし）

| 攻撃 | 結果 |
|---|---|
| `*.md` という名前の**ディレクトリへのシンボリックリンク** | ✅ `S_ISREG` で通常ファイル以外を除外。スキップ警告も出ず `done / 100`（誤検知なし） |
| FIFO・ソケット等の特殊ファイル | ✅ 同上のロジックで除外される |
| 走査時と処理時で二重に `stat()` する構成 | ✅ 1000ファイルで実用上の速度低下は観測されず |
| 検証終了後の孤児collection | ✅ `collections: []` |
| `black --check` / `ruff check` | ✅ 両方成功（17 files unchanged / All checks passed!） |

第1〜3回で解消済みの項目（ログ出力、失敗時の進捗換算、中断インデックスの再開、除外ディレクトリ、遅延初期化、ロック生成の排他、インデックス中の `DELETE`）は、該当コードに変更がないため再検証を省略しています。

---

## 指摘の総括（第1回〜第4回）

| 回 | 指摘 | 状態 |
|---|---|---|
| 1 | 中1: 失敗理由がどこにも残らない | ✅ 解消 |
| 1 | 中2: 失敗時の `progress` にファイル数が渡る | ✅ 解消 |
| 1 | 中3: 再起動で未完了が `done / 100` になる | ✅ 解消 |
| 1 | 軽微1: `.git` / `node_modules` を除外していない | ✅ 解消 |
| 1 | 軽微2: import だけでChromaDBが生成される | ✅ 解消 |
| 1 | 軽微3: `get_project_lock` の生成が競合しうる | ✅ 解消 |
| 2 | 重大1: フォルダが読めないと索引を全消去して「完了」 | ✅ 解消 |
| 3 | 中1: 個別I/Oエラーで処理全体が中断する | ✅ 解消 |
| 4 | 軽微1: エラーが残る間、削除同期が止まる | 任意（指示どおりの実装。精緻化の提案のみ） |

## マージにあたって

コードは `develop` へマージして問題ありません。運用面で1点だけ残っています。

- **ブランチ `feature/t5-rag-index` にコミットがまだありません**（先端は `develop` = `6985c6e` のままで、変更はすべて未コミットの作業ツリーにあります）。`AGENTS.md` 3章に従い `T5-1: ChromaDBインデックス構築サービスを実装` のような形式でコミットしてからマージしてください。

## 後続タスクへの申し送り

- **T5-2**: `index-status` は `indexing` / `done` / `error` の3状態を返します。`error` は「全体失敗（progress は途中の値）」と「一部スキップして完走（progress=100）」の両方で返るため、進捗バーだけでなくステータス文言を主に据えてください。失敗理由はサーバーログにのみ出ます
- **T6-2**: `search()` は同期関数（`embed_query` と `collection.query` がブロッキング）です。必ず `asyncio.to_thread` 経由で呼んでください
- **T6-2**: 送信前の差分更新をここに繋ぐと、上記 軽微1 の削除同期の抑止もそのタイミングで効きます。RAGに削除済みファイルが混ざる場合はこの点を疑ってください
- 第1回で挙げた任意項目のうち、空ファイルの毎回再処理・`project_locks` の未解放・ファイル数の上限なし（実測スループット約40ファイル/秒）は未対応のまま残っています

## 環境の後始末

検証で作成したプロジェクトはすべて `DELETE /projects/{id}` API 経由で削除済み（`GET /projects` = `[]`、`collections: []`）。SQLite / ChromaDB はスクラッチパッド配下に隔離し、`backend/data/chat.db` は開いておらず更新時刻に変化なし（`Aug 10 21:12`）。権限を落としたディレクトリは元に戻し、作成した壊れたシンボリックリンク・ディレクトリリンクも削除済みです。Ollamaスタブは `127.0.0.1:11435` にバインドしたローカルプロセスで外部通信はなく、uvicorn・スタブとも停止済みです。
