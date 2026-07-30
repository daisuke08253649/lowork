# T2-3 レビュー結果

- 対象タスク: T2-3 普通のチャット画面の統合
- 対象ブランチ: `feature/t2-chat-integration`（未コミットの作業ツリーを対象にレビュー）
- レビュー日: 2026-07-30
- **判定: 要修正**

---

## 検証方法

impl.md の記載を鵜呑みにせず、実際に動かして確認した。

1. `git diff develop` および新規ファイル全文の読み取り
2. `npm run lint` / `npm run build`
3. **実バックエンド＋実Ollamaに対する疎通**: `backend/.venv/bin/uvicorn backend.main:app --port 8000` を起動し、`src/api/chat.ts` を esbuild でバンドルして `streamNormalChat` を実コードのまま実行
4. **スタブSSEサーバー**（ポート8000）による異常系の網羅: ストリーム中エラーイベント／壊れたJSON／スキーマ違反／イベントのチャンク分割／終端 `\n\n` 欠落
5. `axios` の `error.response.data` の実体を型レベルで確認

> 検証で起動したuvicornは停止済み。レビュー前の状態に戻してある。

---

## 良い点

- **ストリーミングのタイムアウト無効化は要件どおり。** `src/api/chat.ts:67` で `timeout: 0` を個別指定しており、`implementation_plan.md` T2-3 の「共有APIクライアントの5秒タイムアウトでストリーミングが切断されないようにする」を満たしている。実際に長い応答が5秒で切れないことを実機で確認。
- **SSEのチャンク分割再構築が正しい。** イベントがTCPチャンク境界で `data: {"cont` / `ent": "分割", "done": fal` / `se}\n\n` のように割れても、正しく1イベントに復元されることを確認。バッファリングの実装は妥当。
- **前回T2-2で申し送った2点が両方とも対応されている。**
  - `chatStore.updateMessage` は `map` で新しい配列を返しており、破壊的更新をしていない（`chatStore.ts:33-37`）。自動スクロールが発火しない問題は起きない。
  - `MessageList` は `shouldFollowLatestRef` により最下部付近にいるときだけ追従するようになった。
- ディレクトリ構成が `design.md` に適合（`api/` `hooks/` `store/` `pages/`）。`src/types/chat.ts` への型切り出しも、コンポーネントとストアの循環依存を避ける妥当な判断。
- 画面の出し分けが `design.md` 7章のレイアウト図どおり（新規チャット＝中央に入力欄、会話中＝上部にメッセージ一覧・下部に入力欄）。
- `AGENTS.md` 7章に適合: axiosによる直接HTTP通信のみ、Tauri `invoke()` 不使用、Ollama以外への通信なし。
- `any` 型なし。Zodによる外部入力の検証あり。`npm run lint` エラー0、`npm run build` 成功。

---

## 指摘事項

### 【重大1】バックエンドが返す日本語エラーメッセージがUIに出ず、英語の技術メッセージが表示される

`src/api/chat.ts:57-69` で `responseType: "stream"` を指定しているため、**エラー応答でも `error.response.data` はパース済みJSONではなく `ReadableStream` になる**。その結果 `getChatErrorMessage`（同 `:38-51`）の

```ts
const result = apiErrorSchema.safeParse(error.response?.data);
```

は**この経路では絶対に成功しない死んだ分岐**になっており、`error.message` へフォールバックする。

実バックエンド＋実Ollamaで確認した結果:

| ケース | バックエンドの応答 | **UIのチャットエラー欄に出る文字列** |
|---|---|---|
| 未インストールのモデルを指定 | `502 {"detail":"model 'definitely-not-installed-xyz' not found"}` | `Request failed with status code 502` |
| Ollama未起動 | `503 {"detail":"Ollamaに接続できません"}` | `Request failed with status code 503` |
| バックエンド未起動 | （応答なし） | `Network Error` |

`error.response.data` の実体も直接確認した:

```
HTTPステータス : 502
response.data の型 : [object ReadableStream] / constructor: ReadableStream
detail プロパティ  : undefined
ストリームを読むと  : {"detail":"model 'definitely-not-installed-xyz' not found"}
```

日本語のdetailはバックエンドから正しく届いているのに、フロント側で捨てている。

これは `requirements.md` 6章「エラーハンドリング: **Ollamaが起動していない場合はUI上にわかりやすいエラーを表示する**」に正面から反する。T2-1でわざわざ502と503を区別し、Ollamaのエラー本文を透過するようにした対応も、この経路では活かされていない。

> なお impl.md の「HTTPエラーとSSE内エラーを日本語のエラー表示へ反映」「存在しないモデルでは、FastAPIの502エラーと詳細メッセージが返ることを確認」という記載は、**バックエンドの応答としては正しいが、UIに表示される文字列としては成立していない**。`curl` での確認どまりになっていないか確認してほしい。

対応案: `streamNormalChat` 側でPOSTを try/catch し、AxiosErrorのボディストリームを読んで `detail` を取り出してから投げ直す。あわせてネットワークエラー用の日本語フォールバックも用意する。

```ts
async function toChatError(error: unknown): Promise<Error> {
  if (axios.isAxiosError(error) && error.response?.data instanceof ReadableStream) {
    const body = await new Response(error.response.data).text();
    const result = apiErrorSchema.safeParse(JSON.parse(body));
    if (result.success) {
      return new Error(result.data.detail);
    }
  }
  if (axios.isAxiosError(error) && !error.response) {
    return new Error("サーバーに接続できません");
  }
  return error instanceof Error ? error : new Error("メッセージの送信に失敗しました");
}
```

（`JSON.parse` は失敗しうるので、この中も安全に扱うこと。）

### 【指摘1】SSEのパース失敗時に、生のJavaScriptエラーやZodのJSONがそのままエラー欄へ出る

`src/api/chat.ts:35` は `JSON.parse` と Zod の `.parse()` をどちらもガードなしで呼んでいる。例外は `streamNormalChat` を貫通して `useChat` の catch に入り、`error.message` がそのまま `ChatError` に描画される。

スタブサーバーで実際に出る文字列を確認した:

**壊れたJSONの場合**
```
Expected property name or '}' in JSON at position 1 (line 1 column 2)
```

**スキーマ違反（`{"done": "yes"}`）の場合**
```
[
  {
    "expected": "boolean",
    "code": "invalid_type",
    "path": [
      "done"
    ],
    "message": "Invalid input: expected boolean, received string"
  }
]
```

このJSON配列が丸ごと「チャットエラー」アラート内に表示される。`requirements.md` 6章の「わかりやすいエラー」とは言えない。

対応: `parseSseEvent` を `safeParse` ＋ `JSON.parse` の try/catch にし、失敗時は固定の日本語メッセージ（例:「応答の解析に失敗しました」）へ変換する。

### 【指摘2】終端 `\n\n` が来ないままストリームが終わると、最後のイベントが黙って捨てられ、しかも「正常終了」扱いになる

`streamNormalChat` は `\n\n` 区切りが見つかったイベントだけを処理し、ループ終了後に `buffer` の残りを扱っていない。

スタブで `data: {"content": "最後", "done": true}`（終端 `\n\n` なし）を送って確認した結果:

- 最後のイベントは `onEvent` に渡されない
- それでも `streamNormalChat` は**正常に解決する**
- したがって `useChat` は `catch` に入らず、`isStreaming` を `false` にするだけ

つまり**回答が途中で切れているのに、エラー表示も何も出ない**状態になる。

現行バックエンドの `to_sse_event` は必ず `\n\n` を付けるため通常は起きないが、`done: true` を受け取らないまま終了したことを検知できない構造自体が弱い。

対応案: ループ後に `buffer` の残りが空でなければ処理するか警告する。加えて `done: true` を一度も受信せずにストリームが終了した場合はエラー扱いにする。

### 【軽微1】エラーでストリームを中断したとき、リーダーを解放していない

`streamNormalChat` は `reader.read()` のループを `onEvent` からの例外で抜けるが、`reader.cancel()` も `releaseLock()` も呼んでいない。スタブでの確認では、ストリーム中エラーイベントで抜けたあとも `stream.locked === true` のままだった。

現行バックエンドはエラーイベント送出後に自分でレスポンスを閉じる（`backend/api/chat.py` の `finally` で `aclose()`）ため実害は出にくいが、`try { ... } finally { await reader.cancel(); }` で囲んでおくのが素直。

### 【軽微2】`streamNormalChat` の制御構文が3階層になっている

`src/api/chat.ts:74-91`:

```
while (true) {                        // 1階層
  while (separatorIndex !== -1) {     // 2階層
    if (event) {                      // 3階層目 → NG
```

`code_style.md`「共通」の「制御構文のネストは2階層までを目安にする。3階層目が必要になる場合は、早期return・ガード節・関数への抽出で2階層以内に収める」に抵触する。バッファから完成イベントを取り出す内側のループを関数へ切り出すと解消できる。

### 【軽微3】`aria-live` が意図した読み上げにならない可能性が高い

`MessageList.tsx` は最新のAIメッセージに対して `aria-live={isLatestAssistantMessage && !isStreaming ? "polite" : undefined}` を付けている。つまり**ストリーミングが終わってから初めて `aria-live` が付く**。

ライブリージョンは「属性が付いている状態で内容が変化したとき」に読み上げられる仕様なので、すでに確定した内容を持つ要素に後から `aria-live` を付けても読み上げは発生しないのが一般的な挙動。「完了後に読み上げる」という impl.md の意図は達成されていない可能性が高い。あわせて、ストリーミング中は `aria-atomic` だけが付き `aria-live` がないため、この `aria-atomic` は何も効いていない。

（スクリーンリーダー実機での確認はこの環境ではできていないため、断定はしない。）

対応案: 最新AIメッセージのラッパーには常に `aria-live="polite" aria-atomic="true"` を付けたままにする。読み上げが冗長になるのが問題なら、視覚的に隠した status 要素を別に用意し、ストリーミング完了時に確定本文を流し込む形にする。

### 【軽微4】上にスクロールした状態で送信すると、自分が送ったメッセージが画面に出てこない

`shouldFollowLatestRef` はスクロール操作でしか更新されないため、ユーザーが過去ログを読むために上へスクロールしたまま送信すると、追従が無効のままになり、自分の発言もAIの返答も見えない。

「ユーザー自身が送信したときは無条件で最下部へ移動する」のが一般的な挙動。`sendMessage` 実行時に追従フラグを立て直す導線を入れるとよい。

### 【軽微5】送信前に入力欄をクリアしているため、失敗時に本文が失われる

`NormalChat.tsx:57-59` は `setInput("")` してから `sendMessage` を呼ぶ。502や接続エラーで送信に失敗すると入力内容が消えており、書き直しになる。失敗時に `setInput(message)` で戻すか、成功を確認してからクリアするのが親切。

---

## 観点別まとめ

| 観点 | 結果 |
|---|---|
| `design.md` 画面レイアウト・ディレクトリ構成 | 適合 |
| `AGENTS.md` 7章（axios直接HTTP・invoke不使用・Ollama以外への通信なし） | 適合 |
| `requirements.md` 6章（Ollama未起動時にわかりやすいエラーを表示） | **逸脱あり（重大1・指摘1）** |
| `implementation_plan.md` T2-3（SSEタイムアウト無効化・非破壊的な配列更新・最下部付近のみ追従） | 適合 |
| `code_style.md`（`any`禁止・型明示・Zod検証） | 適合 |
| `code_style.md`（制御構文2階層） | **逸脱あり（軽微2）** |
| `AGENTS.md` 10章（禁止コマンド・操作） | 抵触なし |

---

## 対応をお願いしたい項目

**必須**: 重大1（HTTPエラーの日本語detailをUIへ反映）、指摘1（パース失敗時の日本語化）、指摘2（終端欠落時の扱い）

**推奨**: 軽微1（リーダー解放）、軽微2（ネスト2階層化）、軽微4（送信時は無条件追従）

**任意**: 軽微3（`aria-live`）、軽微5（失敗時の入力復元）

修正後に再レビューを行う。

---
---

# 再レビュー（2026-07-30）

- **判定: 要修正**（前回の指摘はすべて解消。新規に指摘1件）

## 検証方法

初回と同じく、実バックエンド＋実Ollama、およびスタブSSEサーバーに対して `src/api/chat.ts` を実コードのまま実行して確認した。検証で起動したuvicornとスタブは停止済み。

## 前回指摘への対応確認

### 重大1（HTTPエラーの日本語detailがUIに出ない）→ 修正確認

`getStreamErrorDetail`（`chat.ts:93-104`）で `ReadableStream` のボディを読み出して `detail` を取り出し、`toChatError` で反映するようになった。実測結果:

| ケース | 前回のUI表示 | **今回のUI表示** |
|---|---|---|
| 未インストールのモデル（502） | `Request failed with status code 502` | **`model 'definitely-not-installed-xyz' not found`** |
| Ollama未起動相当（503） | `Request failed with status code 503` | **`Ollamaに接続できません`** |
| バックエンド未起動 | `Network Error` | **`サーバーに接続できません`** |

`requirements.md` 6章「Ollamaが起動していない場合はUI上にわかりやすいエラーを表示する」を満たす状態になった。

### 指摘1（生のJSエラー／ZodのJSONがそのまま表示される）→ 修正確認

`parseSseEvent` が `safeParse` ＋ `JSON.parse` の try/catch になり、失敗時は定数 `STREAM_PARSE_ERROR_MESSAGE` に統一された。実測:

| 入力 | 前回のUI表示 | 今回のUI表示 |
|---|---|---|
| 壊れたJSON | `Expected property name or '}' in JSON at position 1...` | **`応答の解析に失敗しました`** |
| スキーマ違反 `{"done":"yes"}` | Zodエラーの生JSON配列（複数行） | **`応答の解析に失敗しました`** |
| 途中で切れたJSON | （未検証） | **`応答の解析に失敗しました`** |

### 指摘2（終端 `\n\n` 欠落で最後のイベントが黙って捨てられる）→ 修正確認

ループ後の `if (buffer.trim())` による残バッファ処理と、`receivedDoneEvent` による完了判定が追加された。実測:

| ケース | 前回 | 今回 |
|---|---|---|
| 終端 `\n\n` なしで最後のイベント | **黙って破棄され「正常終了」** | 最後のイベントを受信し正常終了 |
| `done: true` が来ないまま終了 | **「正常終了」扱いでエラーなし** | **`応答が途中で終了しました`** |

「回答が途中で切れているのにエラーが出ない」失敗モードは解消された。

### 軽微1（リーダー未解放）→ 修正確認

`try/finally` で `reader.cancel()` ＋ `releaseLock()` を呼ぶようになった。前回 `locked: true` のままだった全ケースで、今回は **`locked: false`** を確認。

### 軽微2（制御構文3階層）→ 修正確認

`extractEvents` / `processEvents` へ切り出され、`while → if` `for → if` の2階層に収まった。`code_style.md` の規定を満たす。

### 軽微3（`aria-live` が機能しない）→ 修正確認

`ChatCompletionAnnouncement`（`MessageList.tsx:68-83`）として、常時DOMに存在する `sr-only` のライブリージョン（`role="status" aria-live="polite" aria-atomic="true"`）を用意し、完了時に確定本文を流し込む方式に変更された。ライブリージョンの正しい使い方であり、指摘した「属性を後付けしても読み上げられない」問題は解消している。`.sr-only` がビルド後CSSに出力されていることも確認済み。

### 軽微4（上にスクロールしたまま送信すると自分の発言が見えない）→ 修正確認

`wasStreamingRef` により、ストリーミング開始の立ち上がりで `shouldFollowLatestRef` を `true` に戻すようになった（`MessageList.tsx:18-21`）。

### 軽微5（失敗時に入力本文が失われる）→ 修正確認

`sendMessage` が `boolean` を返すようになり、`handleSubmit` が失敗時に `setInput(message)` で復元する。

### 回帰確認

- 正常系（実Ollama）: `{"content":"はい","done":false}` → `{"content":"","done":true}` を受信し正常終了
- SSEのチャンク分割再構築: 引き続き正しく復元される
- ストリーム中のエラーイベント: `Ollamaからの応答を処理できません`（バックエンドの日本語文言）がそのまま表示される
- `npm run lint` エラー0（警告1件は既存 `button.tsx` 由来）、`npm run build` 成功

---

## 新規指摘

### 【指摘1】送信失敗時に空のAIバブルが残り、再送すると同じ質問が二重に並ぶ

`useChat.sendMessage` は、送信前にユーザーメッセージと**空文字の"入れ物"となるAIメッセージ**をストアへ追加する（`useChat.ts:40-45`）。しかし `catch` ではエラー文言をセットするだけで、**この2件をストアから取り除いていない**（`useChat.ts:70-72`）。

軽微5の修正で入力欄が復元されるようになったことで、この副作用が表に出た。502や接続エラーのあとの画面は次の状態になる:

1. ユーザーの発言バブルが残る
2. その下に**中身が空のAIバブル**（`ChatBubble` に `content=""` が渡り、`px-4 py-3` 分の高さを持つ灰色の角丸だけが描画される）が残る
3. 入力欄には同じ本文が戻っている

この状態でそのまま再送すると、`sendMessage` は無条件に新しいメッセージを追加するため、**同じ質問のバブルが2つ、空のAIバブルも2つ**並ぶ。失敗を繰り返すほど空バブルが積み上がる。

`requirements.md` 6章が明示的に求めているエラー時の挙動そのものなので、対応してほしい。

対応案（いずれか）:
- `catch` で、追加した2件（または空のAIメッセージのみ）をストアから取り除く。`chatStore` に `removeMessage(id)` を足すのが素直
- 空のAIバブルを残す方針にするなら、そのバブル内にエラー文言を表示し、再送時は既存のユーザーメッセージを再利用して二重追加しないようにする

## その他（任意・ブロッカーではない）

- `toChatError` は `error.message` を書き換えて同じ `AxiosError` を返している（`chat.ts:110-114`）。動作は問題ないが、`stack` には旧メッセージが残るため、ログを見るときに紛らわしい。新しい `Error` を作って返すほうが素直。
- `ChatCompletionAnnouncement` は「`!isStreaming` かつ最新がAIメッセージ」で読み上げ内容を作るため、**送信失敗で空のAIメッセージが残っているときに「AIの応答: 」だけが読み上げられる**。上記【指摘1】を空メッセージ除去で直せば同時に解消する。

---

## 観点別まとめ（再レビュー時点）

| 観点 | 結果 |
|---|---|
| `requirements.md` 6章（わかりやすいエラー表示） | **適合**（重大1・指摘1が解消） |
| `implementation_plan.md` T2-3 | 適合 |
| `code_style.md`（制御構文2階層・`any`禁止・型明示） | 適合 |
| `design.md` 画面レイアウト・ディレクトリ構成 | 適合 |
| `AGENTS.md` 7章・10章 | 適合／抵触なし |
| エラー発生後のUI状態 | **要修正（新規指摘1）** |

## 対応をお願いしたい項目

**必須**: 新規指摘1（失敗時に空のAIバブルが残る／再送で二重になる）

**任意**: `toChatError` のエラー生成方法

前回の必須3件・推奨3件・任意2件はすべて対応済みであることを実測で確認した。残るのは上記1件のみなので、対応後に再レビューする。

---
---

# 再々レビュー（2026-07-30）

- **判定: 承認**（新規の必須指摘なし。任意の検討事項が2件）

## 検証方法

`useChat` を `react-dom/server` でレンダリングして `sendMessage` を取り出し、**実バックエンド＋実Ollama**、およびスタブSSEサーバーに対して実コードのまま実行、ストアの状態を直接観測した。起動したuvicorn・スタブはいずれも停止済み。

## 指摘1（失敗時に空のAIバブルが残る／再送で二重になる）→ 修正確認

`chatStore` に `removeMessages(ids)` を追加し（`chatStore.ts:27-32`）、`useChat` の `catch` で仮追加した2件を取り除くようになった（`useChat.ts:71-73`）。`filter` で新しい配列を返しており、非破壊更新の方針も保たれている。

「成功 → 失敗 → 再送」の流れでストアの中身を実測:

| 時点 | messages | error |
|---|---|---|
| 初期 | `[]` | `null` |
| 1回目送信（正常モデル）成功後 | `[["user","「はい」とだけ返して"],["assistant","はい"]]` | `null` |
| 2回目送信（未インストールのモデル）失敗後 | `[["user","「はい」とだけ返して"],["assistant","はい"]]` | `"model '...' not found"` |
| 3回目送信（再送・正常モデル）後 | 上記＋`["user","壊れる質問"]`＋AIの返答 | `null` |

**失敗後にメッセージ件数が増えていない**ことを確認。空のAIバブルは残らず、再送しても質問が二重にならない。指摘した挙動は解消している。

なお、最初の送信が失敗した場合は `messages.length === 0` に戻るため新規チャット画面が表示されるが、その分岐にもエラー表示（`NormalChat.tsx:96`）があるので、エラーが見えなくなることはない。

## 回帰確認

- `npm run lint`: エラー0（警告1件は既存 `button.tsx` 由来で本差分と無関係）
- `npm run build`: 成功
- 正常系のストリーミング、502/503/接続不能の日本語メッセージ、SSEパース失敗、`done` 未受信の検出など、前回確認した挙動に回帰なし

---

## 任意の検討事項（ブロッカーではない）

### 【任意1】途中まで生成された回答も破棄される

`removeMessages` は AIメッセージの中身にかかわらず削除するため、**ある程度まで生成が進んだあとにストリーム中エラーが起きると、生成済みの本文ごと消える**。スタブで確認:

```
[B] 途中まで生成された後にストリーム中エラーが発生した場合
  送信結果: false
  messages: []          ← "ここまでは生成できた長い回答" も一緒に消える
  error   : "Ollamaからの応答を処理できません"
```

入力本文は復元されるので再送はできるが、長文生成の終盤で失敗した場合の損失は大きい。

一方で、中途半端な回答を残さずクリーンに再送できる現在の挙動にも合理性があり、**どちらが良いかは好みの範囲**。気になる場合は「AIメッセージが空のときだけ削除し、本文があるときは残してエラーバナーを併記する（その場合は入力を復元しない）」という分岐が考えられる。MVPでは現状のままでよい。

### 【任意2】`toChatError` が `error.message` を書き換えている

前回の任意指摘のまま（`chat.ts:106-115`）。動作に問題はないが、`stack` には旧メッセージが残る。新しい `Error` を返すほうが素直。

---

## 観点別まとめ（最終）

| 観点 | 結果 |
|---|---|
| `design.md` 画面レイアウト・ディレクトリ構成 | 適合 |
| `AGENTS.md` 7章（axios直接HTTP・invoke不使用・Ollama以外への通信なし） | 適合 |
| `AGENTS.md` 10章（禁止コマンド・操作） | 抵触なし |
| `requirements.md` 6章（Ollama未起動時のわかりやすいエラー表示） | 適合 |
| `implementation_plan.md` T2-3（SSEタイムアウト無効化・非破壊的な配列更新・最下部付近のみ追従） | 適合 |
| `code_style.md`（`any`禁止・型明示・Zod検証・制御構文2階層） | 適合 |
| エラー発生後のUI状態 | 適合 |

## 結論

初回・再レビューで挙げた指摘はすべて解消され、実測で確認できた。残りは任意の検討事項2件のみで、いずれもマージのブロッカーにはしない。

`AGENTS.md` 3章の連携フローに従い、`feature/t2-chat-integration` を `develop` へマージしてよい。

これで `implementation_plan.md` Phase 2（T2-1〜T2-3）が完了となる。

---
---

# 第4回レビュー（2026-07-30）

- **判定: 承認（指摘なし）**

承認済みの状態から、任意扱いとしていた2件が追加で対応された。回帰がないことを確認する目的でレビューした。

## 検証方法

前回と同じく、`useChat` を `react-dom/server` でレンダリングして `sendMessage` を取り出し、実バックエンド＋実Ollamaおよびスタブに対して実コードのまま実行、ストアの状態を直接観測した。起動プロセスは停止済み。

## 任意1（途中まで生成された回答も破棄される）→ 対応確認

`useChat.ts` の `catch` で、AIメッセージに本文があるかを判定し、**本文があるときは残す**ようになった。あわせて `sendMessage` の戻り値が `boolean` から `SendMessageResult`（`shouldRestoreInput`）に変わり、「入力を復元するかどうか」を呼び出し側へ明示的に伝える形になった。本文を残す場合は復元しないため、再送による重複も起きない。意図が型に表れていて読みやすい。

実測:

| ケース | messages | error | shouldRestoreInput |
|---|---|---|---|
| 502（本文なし） | `[]` | `model 'xyz' not found` | `true` |
| 開始直後にSSEエラー（本文なし） | `[]` | `Ollamaからの応答を処理できません` | `true` |
| **途中まで生成後にSSEエラー** | `[["user","..."],["assistant","ここまでは生成できた"]]` | `Ollamaからの応答を処理できません` | **`false`** |
| **途中まで生成後に`done`未受信で終了** | `[["user","..."],["assistant","途中まで"]]` | `応答が途中で終了しました` | **`false`** |

本文がない場合は仮追加した2件を削除して入力を復元、本文がある場合は残して復元しないという分岐が、4ケースとも設計どおりに動いている。

## 任意2（`toChatError` が `error.message` を書き換えている）→ 対応確認

`new Error(detail)` を返す形になった（`chat.ts:109-114`）。実測:

```
[2] 未インストールのモデル(502)
   -> UI表示  :「model 'definitely-not-installed-xyz' not found」
      種別    : Error / AxiosError? false
      stack先頭: Error: model 'definitely-not-installed-xyz' not found
```

スタックの先頭が表示メッセージと一致するようになり、指摘した「`stack` に旧メッセージが残る」問題は解消。バックエンド未起動時の `サーバーに接続できません` も同様に新しい `Error` として返る。

## 回帰確認

- 正常系（実Ollama）: `{"content":"はい","done":false}` → `{"content":"","done":true}` を受信して正常終了
- 502 / 接続不能 / SSEエラー / `done` 未受信 の各メッセージに変化なし
- `npm run lint`: エラー0（警告1件は既存 `button.tsx` 由来）
- `npm run build`: 成功

## 新規指摘

なし。

## T3-1への申し送り

途中で切れたAI回答がメッセージ一覧に残るようになったため、**T3-1で会話履歴をOllamaへ渡す際、この不完全な回答も文脈として送られる**点に注意すること。実害が出るようなら、不完全なメッセージにフラグを持たせて履歴から除外する等の対応を検討する。現時点では履歴の永続化自体が未実装なので、T3-1の設計時に判断すればよい。

## 結論

任意扱いの2件も対応され、回帰もない。判定は前回の**承認**のまま変わらない。`feature/t2-chat-integration` を `develop` へマージしてよい。
