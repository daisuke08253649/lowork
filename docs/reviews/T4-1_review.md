# T4-1 レビュー結果

対象: T4-1 プロジェクト管理 API
ブランチ: `feature/t4-project-api`（`develop` = `ee33958` との差分 + 未追跡ファイル `backend/api/projects.py`, `backend/services/project.py`, `backend/services/index_status.py`）
レビュー日: 2026-08-10

## 判定

**要修正**

実装済みの範囲の**コードそのものに不具合は見つかりませんでした**。パス正規化・重複拒否・カスケード削除・ステータスコードはいずれも実測で期待どおりに動きます。指摘2件はどちらも「T5-1へ先送りした内容が実装計画書に残っていないこと」に起因するもので、修正はほぼドキュメント追記です。

---

## 指摘事項

### 中1: ChromaDB collection 削除の先送りが実装計画書に記録されていない

**該当箇所**: `backend/api/projects.py:73-77` / `docs/implementation_plan.md:199`

`design.md` 4章と `implementation_plan.md` T4-1 は、どちらも `DELETE /projects/{id}` を「削除（**ChromaDB collection も削除**）」と定義しています。実装は SQLite のレコードと in-memory 状態のみを削除しており、`T4-1_impl.md` の「設計判断」に先送りの理由が書かれています。T5-1 より前に collection は存在しないので、**判断としては妥当**です。

問題は記録先です。今回 `implementation_plan.md` に追記されたのは index-status の先送りだけで、collection 削除については何も書かれていません。`T4-1_impl.md` はレビューのやり取りを残すための記録であって仕様書ではないため、`AGENTS.md` 11章「実装中に設計・仕様を変更した場合は `design.md` または `implementation_plan.md` を更新すること」を満たしていません。

さらに、**T5-1 の作業内容にも collection 削除を `DELETE /projects/{id}` へ接続する記述がありません**。

```
$ grep -n "collection" docs/implementation_plan.md
199:  - `DELETE /projects/{id}`: 削除（ChromaDB collection も削除）      ← T4-1（未実装）
229:  - ChromaDB クライアントの初期化（`collection名: project_{project_id}`）  ← T5-1（作成のみ）
```

このままだと、T5-1 で collection を作るようになった後もプロジェクト削除時に collection が消えず、**孤児 collection がディスクに残り続ける**不具合になります。`collection名` は `project_{project_id}` なので、同じフォルダでプロジェクトを作り直しても新しいIDになり、古い collection は永久に回収されません。

**対応**: `implementation_plan.md` の T5-1 の作業内容に「`DELETE /projects/{id}` から ChromaDB collection の削除を呼び出す」を追記してください（T4-1 側に「collection 削除は T5-1 で対応」と注記を足すのも合わせて有効です）。

### 中2: `index-status` がバックエンド再起動で `indexing` → `done` に反転する

**該当箇所**: `backend/services/index_status.py:12-13`

```python
def get_index_status(project_id: str) -> tuple[IndexState, int]:
    return index_statuses.get(project_id, ("done", 100))
```

in-memory dict で進捗を持つこと自体は `implementation_plan.md` の T5-1（「進捗を in-memory dict で管理」）に沿っており問題ありません。指摘は**未登録IDに対する既定値**です。

**実測**

```
作成直後            : {"status":"indexing","progress":0}
30秒後              : {"status":"indexing","progress":0}   ← 実インデクサーが無いので当然
（バックエンド再起動）
再起動後（同一ID）  : {"status":"done","progress":100}     ← 一度もインデックスされていない
```

同じプロジェクトが、再起動を挟むだけで「0%で処理中」から「完了」に変わります。T5-1 完了後であれば collection が永続するので `done/100` が正解になりますが、**T5-1 より前の現時点では両方とも実態と違います**。

これが問題になるのは、**次のタスクである T4-2（プロジェクト一覧画面）がこのAPIに対してUIを作る**点です。T4-2 の担当者から見ると、

- 新規作成したプロジェクトは永久に「インデックス中 0%」のスピナー表示のまま
- アプリを再起動すると同じプロジェクトが突然「完了」表示になる

という挙動になり、UIのバグと区別が付きません。

**対応**: `implementation_plan.md` の T4-1（または T4-2）に、**T5-1 完了までの `index-status` の挙動**を明記してください。具体的には「T5-1 で実インデクサーを接続するまで、作成直後は `indexing`・0% のまま進まず、バックエンド再起動後は `done`・100% を返す」という趣旨です。今回追記された1行は「作成直後は `indexing`・0% の状態を返す」までしか書いておらず、再起動時の挙動と「進まない」ことが読み取れません。

そのうえで、T4-2 のスピナーが永久に回り続けるのを避けたいのであれば、T5-1 まで `start_indexing()` を呼ばない（＝常に `done/100`）という選択肢もあります。どちらを採るかは T4-2 の作りやすさで判断して構いませんが、**前提が実装計画書に書かれている状態**にしてください。

---

### 軽微1: UTC正規化のロジックが `backend/api/chat.py` と重複している

**該当箇所**: `backend/api/projects.py:40-49`

```python
created_at = project.created_at
if created_at.tzinfo is None:
    created_at = created_at.replace(tzinfo=UTC)
```

これは `backend/api/chat.py` の `as_utc_datetime()` と同じ処理です。T3-1 のレビューで入れた対応が、モデルが増えるたびにコピーされていく形になっています。共通ヘルパー（例: `backend/api/serialization.py`）へ切り出しておくと、T5-2 以降でレスポンスモデルが増えても同じコードが増えません。

### 軽微2: 相対パスがサーバーのCWD基準で解決され、そのまま登録される

**該当箇所**: `backend/services/project.py:21`

```python
normalized_path = str(Path(folder_path).resolve())
```

**実測**

```
POST /projects  {"name":"相対","folder_path":"docs"}
→ 201  folder_path = "/Users/daisuke/workspace/saino/development/lowork/docs"
```

`resolve()` は相対パスをバックエンドプロセスのカレントディレクトリ基準で解決するため、リポジトリ内の `docs` が登録されました。T4-2 は Tauri の `open()` ダイアログから絶対パスを渡すので実害は薄いですが、フロントエンド側の不具合で相対パスが飛んだ場合に**意図しないフォルダが静かに登録される**ことになります。`Path(folder_path).is_absolute()` でない場合は 400 で弾く方が事故が起きにくいです。

### 軽微3: プロジェクト名のバリデーションが2箇所に分かれている

**該当箇所**: `backend/api/projects.py:24, 62` / `backend/services/project.py:18-19`

`CreateProjectRequest` の `Field(min_length=1)` は生の文字列にしか効かないため、API層で `.strip()` してからサービス層へ渡し、サービス層で改めて `if not name.strip()` を見ています。動作としては正しく（空白のみの名前は 400 になることを実測で確認）、二重に strip しているだけで害はありませんが、責務としてはどちらか一方（サービス層）に寄せた方が読みやすくなります。

---

## 良かった点・確認できた点

### パス正規化と重複拒否（実測）

`resolve()` による正規化が効いており、表記の違う同一フォルダがすべて弾かれます。

| リクエストの `folder_path` | 結果 |
|---|---|
| `.../t41/proj_a`（初回） | 201 |
| `.../t41/proj_a`（重複） | **409** このフォルダはすでにプロジェクトに登録されています |
| `.../t41/proj_a/`（末尾スラッシュ） | **409** |
| `.../t41/proj_b/../proj_a`（`../` を含む） | **409** |
| `/nope/nowhere`（存在しない） | 400 指定されたフォルダが見つかりません |
| `.../t41/afile.txt`（ディレクトリでない） | 400 |
| `name` が空白のみ | 400 プロジェクト名を入力してください |

`../` を含むパスが正規化されたうえで既存プロジェクトと同一と判定される点は、`AGENTS.md` 7章のパストラバーサル対策の観点でも良い挙動です。T6以降のファイル操作は、ここで保存された正規化済み絶対パスを基準にすることになります。

重複チェックをアプリ側の事前SELECTではなく **DBのUNIQUE制約 + `IntegrityError` の捕捉**で行っている点も適切です。事前チェック方式で起きるレースコンディションがありません。

### その他

- `Path.is_dir()` を `asyncio.to_thread()` でオフロードしており、ファイルシステムアクセスでイベントループを塞がない。細かいですが良い配慮です
- **プロジェクト削除がカスケードする**ことを一時DBで確認しました。`PRAGMA foreign_keys=ON`（T3-1）と `ondelete="CASCADE"` が効いており、Core の `delete()` でも DB 側で2段カスケードします

  ```
  削除前 (projects, conversations, messages): (1, 2, 4)
  削除後 (projects, conversations, messages): (0, 1, 2)
    プロジェクト会話がカスケード削除された : True
    そのメッセージもカスケード削除された   : True
    普通のチャット（project_id=NULL）は無傷 : True
  ```

- API層はリクエスト/レスポンス変換のみ、CRUDは `services/project.py` に集約されており、`design.md` 2章のディレクトリ構成と `code_style.md` の責務分離に沿っています
- ステータスコードが適切（201 / 204 / 400 / 404 / 409）。存在しないIDへの `index-status` と `DELETE` はいずれも 404、削除済みIDの `index-status` も 404 を確認
- 一覧が `created_at` 降順で安定。T3-1 で `created_at` を Python 側のマイクロ秒精度に直した効果がそのまま効いています（`10:24:12.781813Z` / `10:24:12.742319Z` で正しく順序付け）
- `index_statuses` を触る関数が3つに限定され、T5-1 の `indexer.py` から進捗を書き込む受け口として素直な形になっています

### セキュリティ観点（`AGENTS.md` 7章・9章・10章）

- 外部通信の追加なし。この差分にネットワークアクセスは含まれません
- ファイルシステムへの書き込みなし。`is_dir()` による読み取り確認のみ
- パス正規化が入っており、`../` を含む入力が素通りしません
- SQLAlchemy のパラメータバインドのみで、生SQLの文字列連結なし
- 削除は API フロー（`DELETE /projects/{id}`）経由で、`chat.db` への直接操作なし

### Lint

- `ruff check backend`: All checks passed
- `black --check backend`: 14 files unchanged

検証で起動した uvicorn は停止済み、作成した検証用プロジェクトは `DELETE /projects/{id}` 経由で削除済みです（`projects` / `chat_conversations` / `chat_messages` すべて0行であることを確認）。カスケード削除の検証は一時ディレクトリの使い捨てDBに対して行っており、`chat.db` への直接操作は行っていません。

---

## T5-1 への申し送り

- `folder_path` に `/` やホームディレクトリ直下のような広範なパスを登録できます（ユーザーがダイアログで選ぶ以上、制限すべきかは判断が分かれます）。T5-1 の再帰的なファイル走査では、対象ファイル数の上限や進捗表示の粒度を検討しておいた方が安全です
- `index_statuses` は `start_indexing` / `get_index_status` / `remove_index_status` の3関数で閉じているので、`indexer.py` からは進捗更新用の関数を1つ足す形で接続できます

---

# 第2回レビュー（2026-08-10）

初回の指摘（中2件・軽微3件）すべてについて修正を確認しました。

## 判定

**承認（指摘なし）**

---

## 指摘への対応確認

### 中1: ChromaDB collection 削除の先送りが記録されていない → 修正済み

`implementation_plan.md` の**T4-1 と T5-1 の両方**に追記されました。

```
T4-1: - ChromaDB collection はT5-1で初めて作成されるため、
        `DELETE /projects/{id}` の collection 削除もT5-1で接続する
T5-1: - `DELETE /projects/{id}` から ChromaDB の `project_{project_id}` collection を
        削除する処理を接続する
```

先送り側（T4-1）と受け取り側（T5-1）の双方に書かれたので、T5-1 の実装時に見落とす経路がなくなりました。あわせて T5-1 に「プロジェクト作成時にバックグラウンドの初回インデックスを開始し、`index-status` の進捗を更新」も追記され、`start_indexing()` の呼び出しが T5-1 の責務であることが明確になっています。

### 中2: `index-status` が再起動で反転する → 修正済み

`post_project` から `start_indexing()` の呼び出しを外し、仮の `indexing` 状態を登録しない形になりました。T5-1 より前は `get_index_status` の既定値だけが返るため、再起動の前後で一貫します。

**実測（同一プロジェクトに対し、バックエンド再起動を挟んで取得）**

```
再起動前: {"status":"done","progress":100}
再起動後: {"status":"done","progress":100}
```

初回レビューで確認した `indexing/0` → `done/100` の反転は解消しました。T4-2 は「作成直後から完了扱い」という一貫した前提でUIを組めます。`implementation_plan.md` T4-1 の記述も「`index-status` は `done`・100% を返す」に更新済みで、実装と一致しています。

### 軽微1: UTC正規化の重複 → 修正済み

`backend/api/serialization.py` に `as_utc_datetime()` を切り出し、`backend/api/chat.py` からは定義を削除して import する形になりました。`projects.py` の `project_to_response` も共通関数を使っています。

移動による回帰がないことを実サーバーで確認しました。

```
会話 : 2026-08-10T10:36:57.533363Z
       2026-08-10T10:36:57.540680Z  user
       2026-08-10T10:36:57.540685Z  assistant
```

T3-1 で修正した「マイクロ秒精度・`Z` 付き」の形式が維持されています。

### 軽微2: 相対パスの受理 → 修正済み

`requested_path.is_absolute()` のガードが入りました。

| `folder_path` | 結果 |
|---|---|
| `.../t41/proj_a`（絶対） | 201 |
| `docs`（相対） | **400** フォルダパスは絶対パスで指定してください |
| `~/Desktop`（チルダ） | **400**（`Path` はチルダを展開しないため相対扱い。妥当） |
| `.../t41/proj_b/../proj_a`（絶対 + `../`） | **409**（正規化が従来どおり効いている） |

絶対パスのみを受け付けるようになった一方で、`../` を含む絶対パスの正規化は維持されています。パストラバーサル対策として望ましい形です。

### 軽微3: 名前バリデーションの二重化 → 修正済み

トリムと空文字検証が `create_project()` に集約されました。API層は `request_data.name` をそのまま渡すだけです。

```
name = "  "        → 400 プロジェクト名を入力してください
name = "  余白あり  " → 保存名 '余白あり'（トリム済み）
```

---

## 回帰確認

| 確認項目 | 結果 |
|---|---|
| `GET /projects`（空） | `[]` ✅ |
| `POST /projects`（絶対パス） | 201 ✅ |
| 同一フォルダの重複（`../` 経由） | 409 ✅ |
| 存在しないIDの `index-status` | 404 ✅ |
| 存在しないIDの `DELETE` | 404 ✅ |
| `DELETE /projects/{id}` | 204 ✅ |
| `GET /chat/conversations`（`as_utc_datetime` 移動の影響） | 200 ✅ |
| チャットの送信・履歴取得・削除 | ✅ |
| `ruff check` / `black --check` | いずれも成功 ✅ |

初回レビューで確認済みのカスケード削除（プロジェクト → 会話 → メッセージ、普通のチャットは無傷）、UNIQUE制約による重複拒否、`asyncio.to_thread` によるファイルシステムアクセスのオフロード、ディレクトリ責務分離については、該当箇所に変更がないため再検証は行っていません。

検証で起動した uvicorn は停止済み、作成した検証用プロジェクトと会話はすべて API 経由で削除済みです（`projects` / `chat_conversations` / `chat_messages` がいずれも0行であることを確認）。

## 補足（対応不要）

`start_indexing()` は現時点でどこからも呼ばれていません（定義は `index_status.py` のみ）。T5-1 で `indexer.py` から呼ぶための受け口であり、`implementation_plan.md` T5-1 にその旨が明記されたので、残しておいて問題ありません。

`T4-1_impl.md` の「動作確認」節に「`indexing`・0% の状態取得を確認」という修正前の記述が残っていますが、同ファイルの「設計判断」と「レビュー指摘への対応」には修正後の内容が書かれているため、実害はありません。

判定は承認です。`AGENTS.md` 3章の連携フローに従い、`feature/t4-project-api` を `develop` にマージして問題ありません。
