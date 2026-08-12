# T6-2 レビュー結果

対象ブランチ: `feature/t6-project-chat-api`（`develop` = `784f767` からの差分。**全変更が未コミット**）
対象ファイル: `backend/api/chat.py` / `backend/services/chat_history.py`

---

## 第1回レビュー（2026-08-12）— 敵対的検証

### 判定: **要修正**（中3件 / 軽微4件）

impl.md の記述を前提にせず、隔離DB・隔離ChromaDB に加えて **スクリプト可能なローカル Ollama スタブ**（`127.0.0.1:11435`）を立て、LLM の応答内容を1件ずつ指定して挙動を実測した。これにより「LLM がこう返したらどうなるか」を推測ではなく再現で確認している。

**確認モード/自走モードのゲートと、T6-1 の書き込み境界はどちらも正しく機能していた。** 問題は、その手前と後段のエラー処理に集中している。

---

### 中1: 自走モードでファイル操作が拒否されると、AIの回答ごと消える

`backend/api/chat.py:431-432`, `194-221`

`apply_auto_file_operation()` は失敗時に `HTTPException` を送出し、それが `post_project_chat` を貫通してリクエスト全体を終了させる。その結果、**LLM が生成したメッセージは返らず、SQLite にも保存されない**。

API実測（いずれも `message` に「重要な回答テキストです」を含む応答をLLMに返させた）:

| LLMが提案した file_op | 結果 |
|---|---|
| `create run.sh` | 400 `Markdownまたはテキストファイルを指定してください` |
| `create notes/x.md`（ネスト） | 400 `新規ファイルはプロジェクトフォルダ直下の名前で指定してください` |
| `edit .git/config` | 400 `編集対象にできないディレクトリが指定されています` |
| `edit missing.md` | 404 `編集対象のファイルが見つかりません` |
| `create existing.md` | 409 `同名のファイルがすでに存在します` |
| `create ../outside/secret.md` | 400 `プロジェクトフォルダ内の安全なパスを指定してください` |

メッセージが失われていることは会話数でも確認した。

```
project conversations: 26
auto with bad file_op -> 400 {'detail': 'Markdownまたはテキストファイルを指定してください'}
conversations after: 26 (before 26) -> message saved? False
```

`design.md`「プロジェクトチャット処理フロー」は `⑤b 自走モード：即座にファイル書き込み → ⑥ messageをチャットに表示` となっており、書き込みの成否にかかわらず message は表示される流れになっている。

これは稀なエッジケースではない。T6-1 の制約（新規は直下のみ・`.md`/`.txt` のみ・除外ディレクトリ不可）はかなり厳しく、**LLM がファイル名を1つ外しただけで会話が丸ごと消える**。ユーザーから見ると「送信したのにエラーだけ出て、質問も回答も履歴に残っていない」状態になる。

**修正案**: `apply_auto_file_operation()` を例外送出ではなく結果返却に変え、失敗しても 200 で `message` を返す。レスポンスに `file_op_error`（またはモードを `confirm` に落として `file_op` をそのまま返す）を足せば、UI 側で「ファイル操作は適用できませんでした」と併記できる。

---

### 中2: Ollama 停止時に 503 ではなく 500「インデックス更新または検索に失敗しました」が返る

`backend/api/chat.py:413-424`

`search()` は Embedding のために Ollama を呼ぶ。Ollama が落ちていると接続エラーになるが、`except Exception` が一括で 500 に潰してしまう。API実測:

```
Ollama HTTP 500 の場合  → 502 {'detail': 'fake ollama exploded'}         ← 正しい
Ollama 完全停止の場合   → 500 {'detail': 'プロジェクトのインデックス更新または検索に失敗しました'}
```

普通のチャット（`/normal-chat`）は同じ状況で 503 `Ollamaに接続できません` を返す。`requirements.md:89` は

> Ollamaが起動していない場合はUI上にわかりやすいエラーを表示する

を機能要件として挙げており、プロジェクトチャットだけこれを満たしていない。フロントは 500 と「インデックス更新または検索に失敗しました」という文言からは Ollama 起動を促す案内を出せない。

**修正案**: `search()` の呼び出しを `httpx.HTTPError`（langchain-ollama が送出する接続系例外）で個別に捕捉して 503 `Ollamaに接続できません` を返し、それ以外を 500 に落とす。

---

### 中3: 「JSONだが期待した形ではない」応答が、生のJSONのままチャットに表示される

`backend/api/chat.py:143-147`

```python
def parse_project_chat_output(content: str) -> ProjectChatOutput:
    try:
        return ProjectChatOutput.model_validate_json(content)
    except ValueError:
        return ProjectChatOutput(message=content)
```

リクエストで `format: "json"` を指定しているため、**Ollama はほぼ必ず JSON を返す**。つまり実際に多いのは「JSON ですらない」ケースではなく「JSON だが shape が違う」ケースで、そのときこのフォールバックは生の JSON 文字列をそのまま `message` として表示してしまう。API実測:

| LLMの応答 | ユーザーに表示される `message` |
|---|---|
| `{"message": 42, "file_op": null}` | `{"message": 42, "file_op":` … |
| `{}` | `{}` |
| `[1, 2, 3]` | `[1, 2, 3]` |
| `{"file_op": {"action":"create","filename":"z.md",...}}` | `{"file_op": {"action": "cr` … |
| `{"message":"消します","file_op":{"action":"delete",...}}` | `{"message": "消し\` … |

最後の行が特に悪い。**日本語が `\uXXXX` にエスケープされた状態でチャット欄に出る**。`action: "delete"` のような1フィールドの逸脱で、正しく生成された日本語メッセージが読めない文字列に化ける。

加えて `{"file_op": {...}}` のように `message` だけが欠けている場合、**有効な file_op が黙って捨てられる**（確認モードでもモーダルが出ない）。

`implementation_plan.md` T6-2 は「JSON パース失敗時のフォールバック処理（`message` のみ表示）」と定めており、生JSONの丸出しはこれを満たしていない。

**修正案**: 2段構えにする。まず `json.loads()` し、dict なら `message` が `str` のときだけそれを採用、`file_op` は個別に検証して不正なら捨てる。dict ですらない・`message` が取れない場合に限って現在のフォールバックへ落とす。

---

### 軽微1: `index_project` の失敗が呼び出し側に届かない

`index_project()` は内部で `except Exception` して `fail_indexing()` するだけで、例外を送出しない。したがって `post_project_chat` の `try/except Exception`（chat.py:413-424）は**インデックス更新の失敗では絶対に発火しない**。実質 `search()` 専用のハンドラになっている。

実測（読み取り不可のサブディレクトリを置いた状態で送信）:

```
chat: 200  message=（通常の応答）
index-status: {'status': 'error', 'progress': 100}
```

インデックスが不完全なまま、ユーザーには何も知らせずに回答が返る。エラーメッセージが「インデックス更新または検索に失敗しました」と両方に言及しているのは実態と食い違っている。挙動としては graceful degradation で妥当なので、文言を `search` 側に寄せるか、`index_project` の結果（`has_errors`）を受け取ってレスポンスに含めるかを選びたい。

### 軽微2: 同一会話への同時送信でメッセージの並び順が壊れる

`backend/services/chat_history.py` の `save_chat_messages()` は `max(sequence) + 1` をトランザクション外の読み取りで決めるため、並行する複数の保存が同じ値を取る。実測（同じ `conversation_id` に4並列で送信）:

```
codes: [200, 200, 200, 200]
order: [('u','seed'), ('a','A'), ('u','U2'), ('u','U0'), ('u','U1'), ('u','U3'),
        ('a','A'), ('a','A'), ('a','A'), ('a','A')]
```

ユーザー発言4件が固まった後にAI応答4件が続く形になり、会話として読めなくなる。`get_conversation_messages()` は `ORDER BY sequence` なので、この並びは次ターンの `get_conversation_history()` 経由でそのまま Ollama にも渡る。

同じロジックは `save_normal_chat()` にも元からあるため T6-2 固有の退行ではないが、今回 `save_chat_messages()` として切り出した箇所が修正の自然な置き場所になっている（会話単位のロックか、`sequence` に一意制約＋リトライ）。UI が送信中にボタンを無効化すれば実際には踏みにくいので、優先度は低い。

### 軽微3: 抽出した `save_chat_messages()` を `save_normal_chat()` が使っていない

`save_chat_messages()` は新規に切り出されたが、`save_normal_chat()` には同一のロジック（`max(sequence)+1` → `add_all` で user/assistant 2件）がそのまま残っている。完全な重複であり、軽微2の修正を入れる際に2箇所直す必要が生じる。

### 軽微4: 大量のファイルを追加した直後の初回送信が無言でブロックする

差分インデックス更新は送信のたびに完了を待つ設計（`implementation_plan.md` T6-2 手順1）どおりに実装されている。定常状態の実測オーバーヘッドは十分小さい。

| プロジェクトのファイル数 | 変更あり（初回） | 変更なし |
|---|---|---|
| 100 | 0.76s | 0.02s |
| 500 | 13.04s | 0.03s |

問題は「変更あり」の初回だけで、この間 API は応答を返さない。上記はスタブ埋め込みでの値で、実 Ollama では T5-1 の実測（約40 files/秒）から400ファイルで約10秒かかる。T6-3 で送信中に `GET /projects/{id}/index-status` の進捗を出すなどの配慮がないと、ユーザーには固まったように見える。

### 軽微5: レスポンスに `conversation_id` を追加した点がドキュメント未反映

`implementation_plan.md` T6-2 手順7 は `JSON 返却: { message, file_op, mode }` と定めているが、実装は `conversation_id` を加えた4フィールドを返す。UI 側で必須の情報なので追加自体は妥当だが、`AGENTS.md` §11 に従い `implementation_plan.md`（および `design.md` のAPI表）を更新しておきたい。

---

### 観察: RAGコンテキストが System Prompt へ生のまま挿入される（MVPでは許容、認識のみ）

`build_rag_context()` はファイル内容をそのまま連結し、`build_project_system_prompt()` が **system ロール**に埋め込む。実測した System Prompt:

```
あなたはローカルプロジェクトを支援するAIアシスタントです。回答は必ずJSONオブジェクトのみで返してください。
形式: {"message": ..., "file_op": null または {...}}
新規作成のfilenameはプロジェクトフォルダ直下の.mdまたは.txtにしてください。既存ファイルを編集する場合、
filenameはプロジェクトフォルダからの相対パスにしてください。ファイル操作が不要ならfile_opはnullにしてください。

関連ファイル:
--- meeting.md ---
# Meeting
プロジェクトの締切は3月末です。

--- fresh_note.md ---
# 新しいメモ
これは新規に追加した内容です。
```

区切りは `--- <path> ---` で、ファイル側から同じ文字列を書けば区切りを偽造できる。自走モードではファイル内容が `file_op` を誘導しうるが、最終的な書き込み範囲は T6-1 が `.md`/`.txt`・プロジェクト配下・除外ディレクトリ外に絞っているため、被害はプロジェクトフォルダ内のメモ上書きに限定される。

完全ローカル・自分のファイルという前提のMVPでは許容範囲。将来的には RAG コンテキストを system ではなく user ロールに置くほうが一般に安全である、という程度の認識で足りる。

---

### 問題なしを確認した点（実測）

**確認モード / 自走モードのゲート（`AGENTS.md` 7章）**

- 確認モードで `file_op: {"action":"create","filename":"new.md"}` を返させても **`new.md` は作成されなかった**。`file_op` はレスポンスに含まれるのみ
- 自走モードの正常系は 204 相当で書き込み成功（`auto.md` の内容 `AUTO` を確認）
- 書き込み経路は `if request_data.mode == "auto"` の1箇所だけで、ゲートを迂回する分岐は無い

**T6-1 の境界がそのまま効いている**

- `create ../outside/secret.md` → 400、検証後も `outside/secret.md` は `secret` のまま
- `edit .git/config` → 400、内容は `cfg` のまま
- 自走モードから T6-1 のサービス関数を直接呼んでおり、`/files/apply` と同じ検証を通る

**会話の分離**

- 他プロジェクトの `conversation_id` を指定 → 404 `会話が見つかりません`
- 存在しない `conversation_id` → 404
- 普通のチャットの会話は `project_id IS NULL` なので `get_project_conversation()` の絞り込みに掛からず、プロジェクトチャットから触れない

**会話の継続と履歴**

- 同一 `conversation_id` の2ターン目が正しく同じ会話に積まれる: `[('user','1回目'), ('assistant','OK'), ('user','2回目'), ('assistant','2番目の返答')]`
- 3ターン目に Ollama へ送られたロール列: `['system','user','assistant','user','assistant','user']`
- 保存される assistant メッセージはパース後の `message` なので、履歴にJSONが混入しない（フォールバック時を除く）

**差分インデックス更新**

- アプリ外で作成した `fresh_note.md` が、次の送信の System Prompt に反映されることを確認（`--- fresh_note.md ---` として出現）
- System Prompt のファイル名指示（直下・`.md`/`.txt`・編集は相対パス）が T6-1 の受け入れ条件と一致しており、RAGメタデータの `file_path` をそのまま使える
- `search()` は `asyncio.to_thread` 経由（T5-2 レビューの申し送り対応済み）
- 5並列送信 → 全て 200、インデックス状態は `done/100` を維持

**その他**

- Ollama が HTTP 500 を返した場合 → 502 + Ollama のエラーメッセージをそのまま `detail` に載せる（`/normal-chat` と同じ挙動）
- `black --check` 20ファイル変更なし、`ruff check` All checks passed
- 外部通信の追加なし。Ollama 以外への通信はゼロ（`AGENTS.md` 9章）
- ビジネスロジックは `services/`、`api/` はルーティングと変換に専念（`code_style.md`）
- 型ヒント完備、Pydantic でリクエスト/レスポンス検証、制御構文のネストは2階層以内

---

### 運用上の指摘

- **ブランチ `feature/t6-project-chat-api` にコミットが1件も無い**（先端が `develop` = `784f767` のまま）。`AGENTS.md` 3章に従い `T6-2: プロジェクトチャットAPIを実装` の形式でコミットしてからマージすること。T6-1 でも3回連続で同じ指摘をしている
- impl.md 記載の `/private/tmp/lowork-t6-2-verify.7S3z8n` が残存している（T6-1 の `/private/tmp/lowork-t6-1-verify.9QHq1e` も未削除）

### 後続タスクへの申し送り

- **T6-3**: 中1が未修正だと、自走モードでファイル操作が弾かれた瞬間にチャットがエラーだけ出して何も残らない。UI 側での握り潰しではなく API 側での修正が必要
- **T6-3**: 軽微4のとおり、ファイルを大量に追加した後の初回送信は数秒〜十数秒ブロックする。送信中に `GET /projects/{id}/index-status` をポーリングして進捗を出すと体感が大きく変わる
- **T6-3**: 送信中は送信ボタンを無効化すること（軽微2の並び順崩れを実質的に防げる）
- **T7-1**: 確認モードのレスポンス `file_op` は `{action, filename, content}` の3フィールドで、そのまま `POST /files/apply` に `project_id` を足して転送できる形になっている
- **T7-1**: 中3が未修正だと、`file_op` が形として少しでも崩れた応答では file_op が `null` になりモーダルが出ない（かつチャット欄に生JSONが出る）

### 検証環境の後始末

- 検証用プロジェクト2件は `DELETE /projects/{id}` 経由で削除（`GET /projects` → `[]`）
- 隔離DB・隔離ChromaDB・テスト用フォルダ（500ファイルの一括生成分、権限0の一時ディレクトリを含む）はスクラッチパッドごと削除済み
- 検証用サーバーと Ollama スタブは停止済み（ポート 8080 / 11435 に残存プロセスなし）
- 実 DB `backend/data/chat.db` は未更新（タイムスタンプ Aug 12 14:48 のまま）
- 実 Ollama には一切アクセスしていない（スタブを `127.0.0.1:11435` に立てて `OLLAMA_BASE_URL` で切り替え）

---

## 第2回レビュー（2026-08-12）— 敵対的検証

### 判定: **承認**（軽微3件は任意 / うち1件はT6-3で対応）

第1回の中3件と軽微2件が修正されている。今回は修正の効果確認に加えて、**修正が持ち込んだ副作用**（`asyncio.Lock` による採番の直列化が普通のチャットに与える影響、多段パースの新しい抜け道、`except ConnectionError` が実際に機能するか）を重点的に攻撃した。

### 第1回指摘の対応状況

| # | 指摘 | 検証結果 |
|---|---|---|
| 中1 | 自走モードの失敗で回答ごと消える | **解消** |
| 中2 | Ollama停止時に503でなく500 | **解消** |
| 中3 | 壊れたLLM応答で生JSONが表示される | **解消** |
| 軽微1 | `index_project` の失敗が届かない | **未対応**（再確認） |
| 軽微2 | 同時送信でメッセージ順が壊れる | **解消** |
| 軽微3 | `save_chat_messages` の重複 | **解消** |
| 軽微4 | 大量追加後の初回送信がブロック | 未対応（T6-3 で対応する前提） |
| 軽微5 | レスポンス形式がドキュメント未反映 | **解消** |

---

### 中1 → 解消

`apply_auto_file_operation()` が `str | None` を返す形に変わり、失敗しても会話が中断しなくなった。第1回とまったく同じ6ケースを再実行:

```
200  create run.sh               msg='重要な回答テキスト' err='Markdownまたはテキストファイルを指定してください'
200  create notes/x.md           msg='重要な回答テキスト' err='新規ファイルはプロジェクトフォルダ直下の名前で指定してください'
200  edit .git/config            msg='重要な回答テキスト' err='編集対象にできないディレクトリが指定されています'
200  edit missing.md             msg='重要な回答テキスト' err='編集対象のファイルが見つかりません'
200  create existing.md          msg='重要な回答テキスト' err='同名のファイルがすでに存在します'
200  create ../outside/secret.md msg='重要な回答テキスト' err='プロジェクトフォルダ内の安全なパスを指定してください'

conversations 0 -> 6   （6件すべて保存された）
```

第1回では 400/404/409 でメッセージが消え、会話数も 26→26 のままだった。正常系（`auto.md` = `AUTO`、`file_op_error` は `None`）も維持されている。

### 中2 → 解消（ただし成立している理由は非自明）

Ollama を完全に停止した状態で実測:

```
[a] ファイル変更なしで送信 : 503 {'detail': 'Ollamaに接続できません'}
[b] 新規ファイルありで送信 : 503 {'detail': 'Ollamaに接続できません'}
```

第1回の 500「プロジェクトのインデックス更新または検索に失敗しました」から、`/normal-chat` と同じ 503 に揃った。`requirements.md:89` を満たす。

補足として、`except ConnectionError`（組み込み例外）が効く理由を確認した。`httpx.ConnectError` は組み込み `ConnectionError` のサブクラスではない。

```
httpx.ConnectError MRO: ConnectError → NetworkError → TransportError → RequestError → HTTPError → Exception
issubclass(httpx.ConnectError, ConnectionError): False
```

にもかかわらず動作するのは、`ollama` パッケージが接続失敗を組み込み `ConnectionError` に変換しているためである。

```
ollama/_client.py:145: raise ConnectionError(CONNECTION_ERROR_MESSAGE) from None
ollama/_client.py:738: raise ConnectionError(CONNECTION_ERROR_MESSAGE) from None
```

**動作は正しいが、間接依存パッケージの内部実装に依存している**。`except ConnectionError` の行に「`ollama` パッケージが接続失敗を組み込み `ConnectionError` に変換する」旨の1行コメントを添えておくと、将来 httpx を直接扱うよう変わったときの取りこぼしを防げる（`code_style.md` は「複雑なロジックにのみコメント」としており、ここは該当すると考える）。

エラーの切り分けも妥当だった。Ollama は生きていて embedding だけが 500 を返す場合は 503 ではなく 500 になる。

```
embedding 500 で送信: 500 {'detail': 'プロジェクトの検索に失敗しました'}
Ollama が chat で 500 : 502 {'detail': 'fake ollama exploded'}
```

### 中3 → 解消

`parse_project_chat_output()` が多段パースになり、**13パターンすべてで生JSONの露出がなくなった**。

| LLMの応答 | 表示される message | file_op |
|---|---|---|
| `これはただのテキストです` | `これはただのテキストです` | None |
| `{"file_op": {...}}`（message欠落） | `ファイル操作を提案しました。` | **create:z.md（拾えるようになった）** |
| `{"message":"消します","file_op":{"action":"delete"}}` | `消します` | None |
| `{"message":"ok","file_op":"create a file"}` | `ok` | None |
| `{"message":"ok","file_op":{"action":"create","filename":"a.md"}}`（content欠落） | `ok` | None |
| `{"message": 42}` / `{}` / `[1,2,3]` / `"just a string"` / `null` / `{"message":{"text":"hi"}}` | `Ollamaから有効な応答を取得できませんでした。` | None |

第1回で問題にした `消し…` のエスケープ露出は消え、`action: "delete"` のような1フィールドの逸脱でも日本語メッセージが正しく残る。message が欠けていても有効な `file_op` を拾うようになった点も改善。

### 軽微2 → 解消

`save_messages_and_commit()` が `asyncio.Lock`（会話ID単位）で採番とコミットを直列化した。同一会話へ6並列送信して実測:

```
codes [200, 200, 200, 200, 200, 200]
order [('u','seed'),('a','OK'),('u','U1'),('a','OK'),('u','U4'),('a','OK'),
       ('u','U0'),('a','OK'),('u','U3'),('a','OK'),('u','U2'),('a','OK'),('u','U5'),('a','OK')]
user/assistant が交互に並んでいる: True
```

第1回の `u,u,u,u,a,a,a,a` という崩れ方は再現しなくなった。到着順は入れ替わるが、user と assistant のペアは必ず隣接する。

ロックはセッションを開いた**後**に取得され、ロック保持中にDB I/Oを行う構造だが、ロックを持つコルーチンは必ずコネクションも保持済みで自力で完了できるため、コネクションプール枯渇によるデッドロックは成立しない。

### 軽微3 → 解消 / 軽微5 → 解消

`save_normal_chat()` が `save_messages_and_commit()` を使うようになり、重複が解消した。普通のチャットの回帰も確認:

```
1ターン目 → conversation_id を返して完了
2ターン目 → 同じ会話に追記: [('u','1回目'),('a',…),('u','2回目'),('a',…)]
```

`design.md`（`{ message, file_op, file_op_error, mode, conversation_id }` の追記と「編集の filename は相対パス」への訂正）と `implementation_plan.md` 手順7 も更新済み。

---

### 軽微1（未対応・任意）: `index_project` の失敗は依然として呼び出し側に届かない

エラーハンドリングが「インデックス更新」と「検索」の2ブロックに分割され、メッセージも `プロジェクトのインデックス更新に失敗しました` / `プロジェクトの検索に失敗しました` に分かれた。ただし `index_project()` は内部で全例外を握って `fail_indexing()` するだけで例外を送出しないため、**インデックス側のブロック（`except ConnectionError` / `except Exception` の両方）は到達しないままである**。実測:

```
読めないサブディレクトリを置いて送信
  chat: 200  message=OK           ← 通常どおり回答が返る
  index-status: {'status': 'error', 'progress': 100}
```

Ollama 停止時に 503 が返るのも、インデックス側ではなく `search()` 側のハンドラが拾っているためである（変更ファイルが無い場合でもクエリの embedding で必ず Ollama を呼ぶため）。

挙動としては graceful degradation で妥当なので急ぎではないが、`index_project()` から `has_errors` を返してレスポンスに含めるか、到達しないブロックを整理するかのどちらかにしておきたい。

### 軽微2（新規・任意）: 空のメッセージがそのまま保存・表示される

Ollama が空文字を返した場合、および `{"message": ""}` の場合、`message: ''` がそのまま返り SQLite にも保存される。実測:

```
200  empty body          msg=''
200  message empty str   msg=''
```

UI には空の吹き出しが出て、初回会話ならタイトル生成にも空文字が渡る。`Ollamaから有効な応答を取得できませんでした。` と同じ扱いに寄せるのが自然（`if isinstance(message, str)` を `if isinstance(message, str) and message.strip()` にする程度）。

### 軽微3（未対応・T6-3で対応）: 大量のファイルを追加した直後の初回送信がブロックする

第1回の実測（100ファイルで 0.76s / 500ファイルで 13.04s、変更なし時は 0.02〜0.03s）から変化なし。設計どおり「更新完了を待ってから次へ」進む実装なので API 側の修正は不要だが、T6-3 で送信中に進捗を見せる配慮が要る。

---

### 問題なしを確認した点（実測）

**確認モード / 自走モードのゲート（`AGENTS.md` 7章）— 回帰なし**

- 確認モードで `create confirm_only.md` を提案させても **ファイルは作成されなかった**（`written=False`）。`file_op` はレスポンスに含まれるのみで `file_op_error` は `None`
- 自走モードの書き込み経路は `if request_data.mode == "auto"` の1箇所のみ

**T6-1 の境界 — 回帰なし**

- 自走モードから `create ../outside/secret.md` を試行 → `file_op_error` に丸め込まれ、`outside/secret.md` は `secret` のまま
- `edit .git/config` も同様に拒否され、内容は `cfg` のまま

**会話の分離・履歴**

- 他プロジェクトの `conversation_id` → 404 `会話が見つかりません`
- 2ターン目に Ollama へ渡されるロール列: `['system','user','assistant','user']`
- 保存される assistant メッセージはパース後の `message`（生JSONが履歴に混入しない）

**その他**

- `black --check` 20ファイル変更なし、`ruff check` All checks passed、`npm run build` 成功
- 外部通信の追加なし。Ollama 以外への通信はゼロ
- `conversation_locks` はプロセス内で会話IDごとに増え続けるが解放されない。`rag.py` の `project_locks` と同じ方式で、個人利用の規模では無視できる（指摘としては挙げない）

---

### 指摘の累計

| 回 | 中 | 軽微 | 判定 |
|---|---|---|---|
| 第1回 | 3 | 5 | 要修正 |
| 第2回 | 0 | 3（未対応2 + 新規1、すべて任意） | **承認** |

中3件はすべて解消済み。残る軽微は「インデックス失敗の握り潰し」「空メッセージ」「初回送信のブロック（T6-3で対応）」で、いずれもマージのブロッカーにはならない。

### マージ前の必須作業

**ブランチ `feature/t6-project-chat-api` にコミットが1件も無い。** 先端は `develop` = `784f767` のままで、以下がすべて未コミットである。

```
 M backend/api/chat.py
 M backend/services/chat_history.py
 M docs/design.md
 M docs/implementation_plan.md
```

`AGENTS.md` 3章に従い `T6-2: プロジェクトチャットAPIを実装` の形式でコミットしてからマージすること。レビュー結果（`docs/reviews/T6-2_*.md`）も併せてコミットする。T6-1 から通算5回連続で同じ指摘になっている。

`/private/tmp/lowork-t6-1-verify.9QHq1e` と `/private/tmp/lowork-t6-2-verify.7S3z8n` も残存している。

### 後続タスクへの申し送り（更新）

- **T6-3**: レスポンスは `{ message, file_op, file_op_error, mode, conversation_id }`。自走モードでは `file_op` と `file_op_error` が同時に返ることがある（提案されたが適用できなかった状態）ので、両方を見て「適用しました」「適用できませんでした」を出し分けること
- **T6-3**: 送信中は送信ボタンを無効化すること（軽微2の並び順は解決済みだが、二重送信自体は防いだほうがよい）
- **T6-3**: 軽微3のとおり、ファイル追加直後の初回送信は数秒〜十数秒かかる。`GET /projects/{id}/index-status` の進捗表示があると体感が変わる
- **T7-1**: 確認モードの `file_op` は `{action, filename, content}` の3フィールドで、`project_id` を足せばそのまま `POST /files/apply` に転送できる
- **T7-1**: `file_op` が `null` でもメッセージは必ず返るようになったので、モーダルの出し分けは `file_op !== null` の単純判定でよい

### 検証環境の後始末（第2回）

- 検証用プロジェクト2件は `DELETE /projects/{id}` 経由で削除（`GET /projects` → `[]`）
- 隔離DB・隔離ChromaDB・テスト用フォルダ（権限0の一時ディレクトリを含む）はスクラッチパッドごと削除済み
- 検証用サーバーと Ollama スタブは停止済み（ポート 8081 / 11435 に残存プロセスなし）
- 実 DB `backend/data/chat.db` は未更新（タイムスタンプ Aug 12 14:48 のまま）
- 実 Ollama には一切アクセスしていない
