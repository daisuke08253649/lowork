# T2-1 レビュー結果

- 対象タスク: T2-1 普通のチャット API（SSE ストリーミング）
- 対象ブランチ: `feature/t2-normal-chat-api`（作業ツリーの未コミット差分を `develop` と比較）
- レビュー日: 2026-07-26
- **承認可否: 要修正** → 再レビューで **承認**（末尾「再レビュー」セクション参照）

---

## サマリー

`design.md` 4章の `POST /normal-chat` の定義どおりに実装され、正常系のストリーミングは動作している。`AGENTS.md` 7章の制約違反（Ollama以外への外部通信、`invoke()` の使用、ファイル操作関連）、10章の禁止操作への抵触はいずれもなし。前回レビューで申し送った「共通クライアントの5秒タイムアウトが SSE を切る」問題も、バックエンド側で `read=None` として正しく処理されている。

ただし **ストリーム中のエラーハンドリングが実際には機能しておらず、実装サマリーに書かれた挙動と食い違う**ため、要修正とする。

レビュー時に実行した検証は「検証結果」セクションに記載。

---

## 指摘事項

### 【要修正・重大】1. ストリーム中の例外捕捉が実際の例外型と一致しておらず、SSEエラーイベントが返らない

- 該当: `backend/api/chat.py:40,44`
- `OllamaChatChunk.model_validate_json(line)` が失敗したとき送出されるのは **pydantic の `ValidationError`**。これは `ValueError` のサブクラスだが **`json.JSONDecodeError` のサブクラスではない**。したがって `except (json.JSONDecodeError, httpx.HTTPError)` では捕捉できない。

  ```
  malformed JSON  -> pydantic_core.ValidationError
                       isinstance JSONDecodeError: False
                       isinstance ValueError      : True
  error line      -> pydantic_core.ValidationError
                       isinstance JSONDecodeError: False
                       isinstance ValueError      : True
  ```

- **実際に再現させた結果**（`httpx.MockTransport` で Ollama の応答を差し替え）:

  | ケース | 結果 |
  |---|---|
  | 正常系 | `data: {"content": "こん", "done": false}` → `data: {"content": "", "done": true}` |
  | Ollamaが `{"error":"model not found"}` 行を返す | **生成器が `ValidationError` を送出**。受信済みイベントは1件目のみで、エラーイベントは届かない |
  | 壊れたJSON行 | **生成器が `ValidationError` を送出**。同上 |

- **影響**: 実装サマリーの「ストリーム中の接続・JSONエラーはSSEエラーイベントとして返却し」が機能していない。Ollama が生成途中に `{"error": ...}` 行を返すケース（モデルのアンロード、メモリ不足、生成中の異常終了）で、`{"error": ..., "done": true}` が届かず**ストリームが途中で切れる**。T2-3 の UI は `done: true` を終了条件にする実装になるはずなので、**応答が生成途中で固まったまま復帰しない**可能性が高い。
- **修正**: `except (ValueError, httpx.HTTPError)` にする。`backend/api/ollama.py:37,46` は既に `ValueError` を捕捉しており、そちらが正しいパターン。`json.dumps` は引き続き使うので `import json` はそのまま残る。

### 【要修正】2. Ollama がエラーステータスを返した場合も「Ollamaに接続できません」になる

- 該当: `backend/api/chat.py:74-76`
- `response.raise_for_status()` が投げる `httpx.HTTPStatusError` も `httpx.HTTPError` のサブクラスなので、接続失敗とまとめて 503「Ollamaに接続できません」に潰されている。
- **実際に再現させた結果**（未インストールのモデル名を指定）:

  ```
  Ollama直接        -> 404 {"error":"model 'definitely-not-installed-xyz' not found"}
  POST /normal-chat -> 503 {"detail":"Ollamaに接続できません"}
  ```

- **影響**: Ollama は起動しているのに「接続できません」と表示され、ユーザーは原因（モデル未インストール）にたどり着けない。`requirements.md`（89行目）「Ollamaが起動していない場合はUI上にわかりやすいエラーを表示する」の趣旨からも、両者を混同すべきではない。
- T2-2 の `ModelSelector` はインストール済みモデルを出すので頻度は下がるが、一覧取得後にモデルが削除された場合や、`/ollama/available-models` のキャッシュ（T8-1）とずれた場合に踏む。
- **修正案**: `httpx.HTTPStatusError` を先に捕捉して分岐する。ストリーミングレスポンスなので `await response.aread()` してから本文の `error` を取り出し、Ollama のメッセージをそのまま返すと親切。接続失敗系（`httpx.TransportError`）のみ 503「Ollamaに接続できません」に残す。

  ```python
  try:
      response = await client.send(ollama_request, stream=True)
      response.raise_for_status()
  except httpx.HTTPStatusError as exc:
      await exc.response.aread()
      await exc.response.aclose()
      await client.aclose()
      raise HTTPException(status_code=502, detail=<Ollamaのerrorメッセージ>) from exc
  except httpx.HTTPError as exc:
      await client.aclose()
      raise HTTPException(status_code=503, detail="Ollamaに接続できません") from exc
  ```

### 【軽微】3. `except ... as exc` の `exc` が未使用

- 該当: `backend/api/chat.py:44`
- `as exc` で束縛しているが本体で使っていない。Ruff のデフォルトルールセットで `F841` に該当する。例外の原因を握り潰しているので、ログ出力に使うか `as exc` を外すかのどちらかにする。
- 併せて: `code_style.md` は「フォーマッタは `Black`、Lint は `Ruff`」と定めているが、`backend/requirements.txt` にどちらも入っていない。T1-2 でフロント側の ESLint / Prettier が整ったので、バックエンド側も揃えておくと片手落ちにならない。

### 【軽微】4. 503 を返す経路で streaming response が明示的に閉じられていない

- 該当: `backend/api/chat.py:74-76`
- `client.send(..., stream=True)` が成功したあと `raise_for_status()` で失敗した場合、`await client.aclose()` は呼ばれるが `await response.aclose()` は呼ばれない。`client.aclose()` が接続プールごと閉じるため実害は出にくいが、レスポンスを開いたまま握っている状態ではある。
- 指摘2の修正で `HTTPStatusError` を分岐させる際に、`await response.aclose()` も併せて入れると明快になる。

### 【参考・T3-1への申し送り】5. 会話履歴が Ollama に渡っていない

- 該当: `backend/api/chat.py:66`
- `messages` には今回のユーザー発話1件だけが入り、`conversation_id` は受け取るだけで未使用。**T2-1 のスコープとしてはこれで正しい**（履歴は T3-1）。
- ただし `requirements.md`「普通のチャット: RAG・ファイル操作なしで Ollama と自由に会話できる」を満たすにはマルチターンの文脈が必要で、T3-1 では SQLite への保存だけでなく **保存済みメッセージを `messages` 配列に積んで Ollama に渡す**実装が要る。`implementation_plan.md` T3-1 の作業内容にその記述がないため、`AGENTS.md` 11章に従って追記しておくと漏れない。

---

## 検証結果（レビュー時に実行）

| 検証 | 結果 |
|---|---|
| 正常系ストリーミング（`gemma4:e4b`） | `200 text/event-stream` / `data: {"content": "はい", "done": false}` → `data: {"content": "", "done": true}` ✅ |
| リクエストバリデーション（`message` 空文字） | `422` ✅ |
| Ollama未起動を模擬（閉じたポート） | `503 {"detail":"Ollamaに接続できません"}` ✅ |
| 未インストールモデルを指定 | `503 {"detail":"Ollamaに接続できません"}` ❌（指摘2。実際は Ollama が 404 を返している） |
| ストリーム中に `{"error":...}` 行 | 生成器が `ValidationError` を送出、SSEエラーイベントなし ❌（指摘1） |
| ストリーム中に壊れたJSON行 | 生成器が `ValidationError` を送出、SSEエラーイベントなし ❌（指摘1） |
| OpenAPI paths | `['/ollama/status', '/ollama/models', '/normal-chat', '/']` ✅ |

## レビュー観点別の所見

| 観点 | 結果 |
|---|---|
| `design.md` 4章 APIエンドポイント定義 | OK（`POST /normal-chat`。`/chat/` 配下ではないパスを正確に守っている） |
| `design.md` 5章 普通のチャット処理フロー | OK（①送信 → ②Ollamaへストリーミング → ③トークンを順次返却。④のSQLite保存は T3-1 スコープ） |
| `design.md` リクエスト仕様 `{conversation_id, message, model}` | OK |
| `design.md` 2章 ディレクトリ構成 | OK（`backend/api/chat.py`） |
| `AGENTS.md` 7章: Ollama以外への外部通信禁止 | OK（`backend/config.py` の `OLLAMA_BASE_URL` のみ。新規依存の追加もなし） |
| `AGENTS.md` 7章: Rust側にロジックを書かない | OK（`src-tauri/` に変更なし） |
| `AGENTS.md` 7章: パストラバーサル対策 | 該当なし（ファイル操作なし） |
| `AGENTS.md` 7章: 確認/自走モードのゲート | 該当なし |
| `AGENTS.md` 10章: 禁止コマンド・操作 | 抵触なし |
| `requirements.md`: エラーハンドリング | **一部NG**（指摘1・2） |
| `code_style.md`: Python の型ヒント必須 | OK（`to_sse_event` / `stream_ollama_response` / `post_normal_chat` すべて注釈あり） |
| `code_style.md`: I/O は async/await で統一 | OK |
| `code_style.md`: Pydantic でのバリデーション | OK（`NormalChatRequest` に `Field(min_length=1)`、Ollama応答も `OllamaChatChunk` で検証） |
| `code_style.md`: 制御構文のネスト2階層まで | OK（`async for` + `if` の2階層まで） |
| `code_style.md`: マジックナンバーの定数化 | OK（`backend/config.py` を参照。T1-2 の共通化を正しく再利用している） |
| `code_style.md`: Black / Ruff | 未導入（指摘3） |
| `implementation_plan.md`: タスク粒度・依存関係 | OK（依存の T0-3 は完了済み。T2-1 の作業内容をちょうど満たし、範囲外の実装なし） |

## 良かった点

- **`read=None` によるストリーミングタイムアウトの無効化**。前回レビューで T2-1/T2-3 に申し送った「5秒タイムアウトが SSE を切る」問題を、バックエンド側でも正しく処理している。`connect` / `write` / `pool` は5秒を維持しており、接続段階のハングは防げているというバランスが良い
- **Ollama 固有のフィールドを素通しせず `{content, done}` に正規化している**。UI 側が Ollama のレスポンス形式に結合しないので、T2-3 の実装が Ollama のバージョン差異に振られにくい
- `finally` で `response.aclose()` と `client.aclose()` を必ず呼んでおり、クライアント切断でストリームが中断された場合もリソースが解放される
- 空 content かつ `done` でないチャンクをスキップして、無駄な SSE イベントを出さない
- `X-Accel-Buffering: no` / `Cache-Control: no-cache` など、ストリーミングがバッファリングで止まらないためのヘッダが入っている
- `backend/config.py` を素直に再利用しており、T1-2 で整えた構成が活きている

---

## 修正依頼まとめ（Codex向け）

1. **[必須]** `backend/api/chat.py:44` の `except (json.JSONDecodeError, httpx.HTTPError)` を `except (ValueError, httpx.HTTPError)` に修正する。`model_validate_json` が投げるのは `ValidationError`（`ValueError` のサブクラス）で、現状は捕捉できていない
2. **[必須]** `backend/api/chat.py:74-76` で `httpx.HTTPStatusError` を分岐させ、Ollama がエラーステータスを返した場合は「接続できません」ではなく Ollama のエラー内容を返す。接続失敗系のみ 503 に残す
3. **[推奨]** `backend/api/chat.py:44` の未使用の `as exc` を解消する（ログ出力に使うか削除）
4. **[推奨]** 指摘2の修正に合わせて、エラー経路で `await response.aclose()` も呼ぶ
5. **[推奨]** `backend/requirements.txt` に `black` / `ruff` を追加する（`code_style.md` の規定。T1-2 のフロント側整備と対にする）
6. **[推奨]** `implementation_plan.md` T3-1 に「保存済みメッセージを `messages` 配列に積んで Ollama に渡す」旨を追記する（指摘5）

修正後、`docs/reviews/T2-1_impl.md` に対応内容を追記のうえ、再レビューを依頼してください。あわせて、**指摘1・2の修正が効いていることを確認できる異常系の動作確認**（未インストールモデルを指定したときのレスポンス）も動作確認欄に追加してほしい。

---
---

# 再レビュー（2026-07-26）

- 対象: `feature/t2-normal-chat-api` 作業ツリー（未コミット差分）を `develop` と比較
- **承認可否: 承認**

## 指摘事項への対応確認

| # | 指摘 | 対応 | 確認 |
|---|---|---|---|
| 1 | ストリーム中の例外型が不一致でSSEエラーイベントが返らない | `except (ValueError, httpx.HTTPError)` に修正 | ✅ 再現テストで解消を確認 |
| 2 | Ollamaのエラーステータスが 503「接続できません」に潰れる | `httpx.HTTPStatusError` を分岐。`get_ollama_error_message()` で本文の `error` を取り出し 502 で返す。接続失敗系のみ 503 に残した | ✅ |
| 3 | 未使用の `as exc` | `except (ValueError, httpx.HTTPError):` から `as exc` を削除 | ✅ |
| 4 | エラー経路で `response.aclose()` が未呼び出し | `await exc.response.aclose()` を追加 | ✅ |
| 5 | `black` / `ruff` 未導入 | `backend/requirements.txt` に追加 | △（下記「新たに気付いた点」参照） |
| 6 | T3-1 への申し送りをドキュメントに反映 | `implementation_plan.md` T3-1 に「指定された会話の保存済みメッセージを時系列順に取得し、Ollamaへ渡す`messages`配列へ反映する」を追記 | ✅ |

## 検証結果（レビュー時に実行）

**ストリーム中のエラー処理**（`httpx.MockTransport` で Ollama の応答を差し替え）— 前回失敗していた2ケースが解消:

| ケース | 前回 | 今回 |
|---|---|---|
| 正常系 | `{"content":"こん",...}` → `{"content":"","done":true}` | 同左 ✅ |
| Ollamaが `{"error":...}` 行を返す | ❌ `ValidationError` 送出、イベントなし | ✅ `data: {"error": "Ollamaからの応答を処理できません", "done": true}` |
| 壊れたJSON行 | ❌ `ValidationError` 送出、イベントなし | ✅ 同上 |

**エンドポイント全体**:

| 検証 | 結果 |
|---|---|
| 未インストールモデルを指定 | `502 {"detail": "model 'definitely-not-installed-xyz' not found"}` ✅（前回は 503「Ollamaに接続できません」。Ollama のメッセージがそのまま届くようになった） |
| Ollama未起動を模擬（閉じたポート） | `503 {"detail":"Ollamaに接続できません"}` ✅（502 と正しく区別されている） |
| 正常系ストリーミング（`gemma4:e4b`） | `200 text/event-stream` / `data: {"content": "はい", "done": false}` → `data: {"content": "", "done": true}` ✅ |
| リクエストバリデーション（`message` 空文字） | `422` ✅ |

## 新たに気付いた点（いずれも承認を妨げない）

### 【軽微】1. `black` / `ruff` が `requirements.txt` にあるだけで、venv に入っていない

- 該当: `backend/requirements.txt`, `backend/.venv/`
- `pip list` で確認したところ **`black` も `ruff` もインストールされていない**（`backend/.venv/bin/` にも実行ファイルなし）。つまり追加はされたが**一度も実行されていない**状態。
- 対応: `backend/.venv/bin/pip install -r backend/requirements.txt` を実行し、`ruff check backend` と `black --check backend` が通ることを確認してほしい。`code_style.md` どおり警告はブロッカーにしないが、少なくとも一度は回して現状を把握しておきたい。
- 併せて、フロント側に `npm run lint` / `format:check` があるのと対になるよう、実行コマンドを `T2-1_impl.md` の動作確認欄か README に残しておくと以降のタスクで迷わない。

### 【軽微】2. `get_ollama_error_message` に指摘1とまったく同じ構図の取りこぼしがある

- 該当: `backend/api/chat.py:37`
- `json.loads(body)` は `body` が不正な UTF-8 の場合 **`UnicodeDecodeError`** を送出する。これは `ValueError` のサブクラスだが `json.JSONDecodeError` のサブクラスではないため、現在の `except json.JSONDecodeError` では捕捉できない。

  ```
  不正JSON(bytes)  -> JSONDecodeError      JSONDecodeError=True  ValueError=True
  不正UTF-8        -> UnicodeDecodeError   JSONDecodeError=False ValueError=True
  ```

- 影響は小さい（Ollama が不正な UTF-8 を返すことは実質ない。踏んだ場合は 502 ではなく 500 になる）が、**指摘1で直したのと同じ落とし穴**なので揃えておきたい。
- 対応: `except json.JSONDecodeError:` を `except ValueError:` にする（1語）。`json.loads` に対する `ValueError` 捕捉は `backend/api/ollama.py` の書き方とも一貫する。

## レビュー観点別の所見（前回からの差分のみ）

| 観点 | 結果 |
|---|---|
| `requirements.md`: エラーハンドリング（Ollama関連の失敗をUIにわかりやすく伝える） | **OK**（接続不可=503、Ollama側のエラー=502＋原メッセージ、ストリーム中の異常=SSEの `{error, done:true}` の3系統に整理された） |
| `code_style.md`: Black / Ruff | 依存には追加されたが未インストール・未実行（新規指摘1） |
| `AGENTS.md` 11章: 仕様変更のドキュメント反映 | OK（`implementation_plan.md` T3-1 への追記が適切な位置に入っている） |
| `AGENTS.md` 7章 / 10章 | 抵触なし（差分は `backend/api/chat.py` と依存・ドキュメントのみ。外部通信の追加なし） |

## 良かった点（今回の修正分）

- **エラーの種類を3系統に整理できている**。接続不可（503）／ Ollama がエラー応答を返した（502 + Ollama の原文）／ ストリーム中の異常（SSE の `{error, done: true}`）の切り分けが明確で、T2-3 の UI 側で出し分けやすい形になった
- 特に **502 で Ollama のメッセージ（`model '...' not found`）をそのまま透過している**のが良い。ユーザーが原因にたどり着ける
- `get_ollama_error_message()` が本文のパース失敗と `error` キー欠落の両方にフォールバック文言を用意しており、ここで新たな例外を生まない作りになっている
- ストリーム中断時の `{"error": ..., "done": true}` に `done: true` が入っているため、T2-3 の UI が「`done` を待つ」実装のままでも正しく終了できる

## 結論

**承認**。`AGENTS.md` 3章の連携フローに従い、`feature/t2-normal-chat-api` を `develop` にマージしてよい。

新規指摘2件はいずれも任意対応だが、**軽微1（`black` / `ruff` の実インストールと実行）はマージ前後どちらでもよいので一度回しておくこと**を勧める。軽微2は1語の修正なので、ついでに直しておくと `backend/api/` 全体でエラー捕捉の書き方が揃う。

---
---

# 再々レビュー（2026-07-26）

- 対象: `feature/t2-normal-chat-api` 作業ツリー（未コミット差分）を `develop` と比較
- **承認可否: 承認（指摘なし）**

## 対応確認

| # | 指摘 | 対応 | 確認 |
|---|---|---|---|
| 軽微1 | `black` / `ruff` が requirements.txt にあるだけで未インストール | `backend/.venv/bin/pip install -r backend/requirements.txt` で導入（`black 26.5.1` / `ruff 0.16.0`） | ✅ |
| 軽微2 | `get_ollama_error_message` が `UnicodeDecodeError` を取りこぼす | `backend/api/chat.py:37` を `except ValueError:` に修正 | ✅ |

## 検証結果（レビュー時に実行）

**Lint / フォーマッタ**（今回初めて実際に実行できた）:

```
ruff check backend  -> All checks passed!
black --check backend -> All done! 6 files would be left unchanged.
```

指摘どおりインストールされ、**警告・エラーともにゼロ**。`code_style.md` の「フォーマッタは Black、Lint は Ruff（デフォルトルールセット）」を満たしている。

**`get_ollama_error_message` の異常系**（`httpx.MockTransport`）:

| 入力 | 結果 |
|---|---|
| `{"error":"boom"}` | `'boom'` ✅ Ollama のメッセージを透過 |
| 不正JSON | `'Ollamaでエラーが発生しました'` ✅ |
| **不正UTF-8** | `'Ollamaでエラーが発生しました'` ✅（前回は `UnicodeDecodeError` が漏れて 500 になっていた） |
| `error` キーなし（`[1,2,3]`） | `'Ollamaでエラーが発生しました'` ✅ |

**エンドポイント全体（回帰確認）**:

| 検証 | 結果 |
|---|---|
| OpenAPI paths | `['/ollama/status', '/ollama/models', '/normal-chat', '/']` ✅ |
| 正常系ストリーミング（`gemma4:e4b`） | `200 text/event-stream` / `data: {"content": "はい", "done": false}` → `data: {"content": "", "done": true}` ✅ |
| 未インストールモデルを指定 | `502 {"detail": "model 'definitely-not-installed-xyz' not found"}` ✅ |
| Ollama未起動を模擬 | `503 {"detail":"Ollamaに接続できません"}` ✅ |
| リクエストバリデーション（`message` 空文字） | `422` ✅ |
| ストリーム中に `{"error":...}` 行 | `data: {"error": "Ollamaからの応答を処理できません", "done": true}` ✅ |
| ストリーム中に壊れたJSON行 | 同上 ✅ |

前回までに指摘したケースはすべて解消し、回帰もない。

## 新規の指摘

**なし。**

`backend/api/` 全体でエラー捕捉が `ValueError` 系に統一され、`ollama.py` と `chat.py` で書き方が揃った。エラー応答も 422（入力不正）／502（Ollama側のエラー＋原文透過）／503（接続不可）／SSE の `{error, done:true}`（ストリーム中の異常）の4系統に整理されており、T2-3 の UI 実装で出し分けやすい。

## 結論

**承認**。前回・前々回の指摘はすべて解消され、新たな問題も見つからなかった。`AGENTS.md` 3章の連携フローに従い、`feature/t2-normal-chat-api` を `develop` にマージしてよい。

T2-1 から次工程への申し送りは以下の2点（いずれも既にドキュメントへ反映済み）。

- **T2-3**: SSE 受信は共通 `apiClient` の5秒タイムアウトを適用しない（`implementation_plan.md` T2-3 に記載済み）
- **T3-1**: 保存済みメッセージを `messages` 配列に積んで Ollama へ渡し、会話文脈を復元する（`implementation_plan.md` T3-1 に記載済み）
