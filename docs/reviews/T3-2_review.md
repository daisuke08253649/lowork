# T3-2 レビュー結果

対象: T3-2 チャット履歴 UI
ブランチ: `feature/t3-chat-history-ui`（`develop` = `d142a06` との差分 + 未追跡ファイル `.env.example`）
レビュー日: 2026-07-31

## 判定

**要修正**

重大1件・中2件です。UI・API連携の中核部分（会話一覧の取得、会話の復元、`conversation_id` の引き継ぎ、削除）は実サーバーとの通しで正しく動作することを確認しています。指摘はいずれも周辺の作り込みに関するものです。

---

## 指摘事項

### 重大1: `.env` が無い環境でフロントエンドの通信が全滅する

**該当箇所**: `src/api/client.ts:3` / `.gitignore:45` / `src/vite-env.d.ts:4`

```diff
-const API_BASE_URL = "http://127.0.0.1:8000";
+const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
```

`.env` は `.gitignore` の対象（`!.env.example` で `.env.example` だけ除外）なので、リポジトリを新しくcloneした環境・別マシンには `.env` が存在しません。そして **README の「セットアップ」に `.env` を作る手順がありません**（`npm install` → backend venv → Tauriのパス確認 → `npm run tauri dev` の4ステップのみ）。

**実測（Vite自身の `loadEnv` を `.env` の無いディレクトリに対して実行）**

```
VITE_* : {}
VITE_API_BASE_URL = undefined
```

ビルド時に `import.meta.env.VITE_API_BASE_URL` は `undefined` へ置換されます。その結果 axios は `baseURL: undefined` で生成され、

```
リクエスト先URL: undefined + undefined
結果            : ERR_INVALID_URL
```

となります（WebView上ではアプリ自身のoriginへ相対解決され、全リクエストが404）。Ollamaモデル取得・チャット送信・履歴取得のすべてが失敗し、画面には「Ollamaモデルの取得に失敗しました」「チャット履歴の取得に失敗しました」とだけ出るため、**原因が `.env` の不在であることに気付けません**。

問題を見えにくくしている要因が2つあります。

- `src/vite-env.d.ts` が `readonly VITE_API_BASE_URL: string` と宣言しているため、型の上では常に `string` 扱いになり、`tsc` でも検出できない
- **バックエンドは `os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434")` のように既定値を持っており、`.env` が無くても動く**。フロントエンドだけ既定値がなく、非対称になっている

**修正案**（いずれか、できれば両方）

```ts
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";
```

- 型宣言も `readonly VITE_API_BASE_URL?: string;` に合わせる
- README の「セットアップ」に `cp .env.example .env` の手順を追加する

バックエンドと同じく「`.env` が無ければローカル既定値」で動くようにすれば、`.env.example` は上書き用の参考値という位置づけになり、破綻しません。

### 中1: 新規会話のタイトルが「新しいチャット」のまま更新されない

**該当箇所**: `src/hooks/useChat.ts:177`（`sendMessage` 末尾の `await loadConversations(true)`）

T3-1 のタイトル生成は**バックグラウンドタスク**で、SSEの完了イベントとは非同期に走ります（`backend/api/chat.py` の `schedule_title_generation`）。一方フロントエンドはストリーム終了直後に一覧を再取得するため、生成が終わる前の値を掴みます。

**実測（実サーバー + 実Ollama。フロントの `getChatConversations()` をそのまま呼んで検証）**

```
[3] 送信直後の一覧
   title="新しいチャット"

[4] 60秒待ってから再取得
   title="日本の首都は東京"
   → 送信直後と60秒後でタイトルが違う: true
```

`loadConversations(true)` は送信のたびに走るので、同じ会話に2通目を送るか、別の会話で送信するか、アプリを再起動すれば正しいタイトルに変わります。しかし **「新しいチャットを作って1通送った直後」という最も自然な状態では、サイドバーに常に「新しいチャット」と表示されます**。T3-1 で実装した会話タイトル自動生成が、UI上ほとんど見えません。

**修正案**（MVPの範囲で軽いもの）

- 新規会話（`is_new_conversation` 相当）のときだけ、数秒後にもう一度 `loadConversations(true)` を呼ぶ
- または、タイトル生成完了後にバックエンドが更新後のタイトルを返せるようにし、フロントは該当会話だけ差し替える

どちらを採るかは実装しやすさで判断して構いませんが、「1通目送信後にタイトルが出ない」状態は解消してください。

### 中2: 会話が増えるとサイドバーの履歴に到達できなくなる

**該当箇所**: `src/components/layout/Sidebar.tsx:81-91`

```tsx
<section className="min-h-0 flex-1 px-3 py-4" aria-labelledby="history-heading">
  ...
  <div className="mt-3 space-y-1">
```

`section` にも内側の `div` にも `overflow-y-auto` がありません。`min-h-0 flex-1` によって `section` はコンテンツより小さく縮みますが、あふれた分はスクロールできません。さらに `App.tsx:13` のルート要素が `h-screen overflow-hidden` なので、**あふれた履歴はクリップされ、スクロールバーも出ず、恒久的に操作できなくなります**。

会話1行は `Button` の既定サイズ `h-8`（32px）+ `space-y-1`（4px）= 36px です。ヘッダー（約88px）・ナビ（128px）・見出しと余白（約60px）を差し引くと、高さ800pxのウィンドウで **14件程度**から溢れます。実利用ですぐ到達する件数です。

この項目は T1-1 のレビューで「任意」として挙げていたものですが、履歴が実データになった T3-2 で実害のある不具合になりました。`section` か内側の `div` に `overflow-y-auto` を足すだけで解消します。

---

### 軽微1: サイドバーがストリーミング中にトークンごと再描画される

**該当箇所**: `src/components/layout/Sidebar.tsx:23-31` / `src/hooks/useChat.ts:35-40`

`Sidebar` が `useChat()` を呼ぶため、フックが内部で張っている `messages` の購読も一緒に付きます。ストリーミング中は `updateMessage` がトークンごとに新しい配列を作るので、`Sidebar` は `messages` を一切使っていないのに毎トークン再描画されます。

ローカル1ユーザーのアプリなので体感上の問題は出にくいですが、履歴一覧用のフック（`useChatHistory` 等）に分けるか、`Sidebar` 側で必要な状態だけ `useChatStore` から個別に購読する形にすると素直です。

### 軽微2: 会話削除に確認がない

**該当箇所**: `src/components/layout/Sidebar.tsx:115-127`

ホバーで現れるゴミ箱アイコンのワンクリックで、会話とメッセージが復元不能に削除されます。`implementation_plan.md` は T4-2 のプロジェクト削除には「確認モーダル付き」と明記している一方、T3-2 の会話削除には書いていないため意図的な省略と判断し、指摘は軽微に留めます。方針として問題なければ現状のままで構いません。

### 軽微3: 不要な `event.stopPropagation()`

**該当箇所**: `src/components/layout/Sidebar.tsx:49`

削除ボタンの親 `div` には `onClick` がなく（会話選択は隣の `Button` 自身が持っている）、伝播を止める必要がありません。害はありませんが、「親にクリックハンドラがある」という誤読を招きます。

### 軽微4: `.env` 化によりオフライン要件の担保が構造から運用へ移った

**該当箇所**: `backend/config.py:9`

`OLLAMA_BASE_URL` はこれまでハードコードで、`AGENTS.md` 7章「Ollama以外の外部LLM APIを呼び出さない（オフライン要件）」がコード上構造的に担保されていました。`.env` 化により、設定次第で外部ホストを向けられます。開発者本人が管理する設定ファイルなので実害の可能性は低く、`.env.example` の既定値も `127.0.0.1` なので修正必須とはしませんが、要件の担保方法が変わった点として記録します。

---

## スコープについて

`.env` への設定集約は T3-2 の元スコープ（`chatStore` / `useChat` / サイドバー / 会話復元 / 会話削除）に含まれていませんでした。Codex は `implementation_plan.md` の T3-2 に作業内容を追記しており、`AGENTS.md` 11章「実装中に設計・仕様を変更した場合は `design.md` または `implementation_plan.md` を更新する」の手順自体は守られています。

ただし `AGENTS.md` 2章「過剰な抽象化・将来を見越した拡張性への投資は避ける」に照らすと、完全ローカル動作で値が変わらないMVPにおいて設定の外出しは必要性が薄く、実際に重大1のリスクを持ち込んでいます。重大1を修正すれば実害はなくなるので取り下げを求めはしませんが、今後同種の判断をする際は「MVPのスコープに忠実に」を優先してください。

---

## 良かった点・確認できた点

### 実サーバーでの通し確認（uvicorn + 実Ollama。フロントエンドの `src/api/chat.ts` をそのままバンドルして実行）

| 確認項目 | 結果 |
|---|---|
| `GET /chat/conversations` のZodスキーマ検証 | ✅ 通過 |
| 新規送信でSSEから `conversation_id` を受け取れるか | ✅ `ae15cb31-a9ed-49a8-bbae-f61c3b001378` |
| 同じ会話へ2通目（履歴が継続するか） | ✅ 「最初の質問は何でしたか？」→「日本の首都はどこ？」と正答 |
| `GET /chat/conversations/{id}/messages` のZodスキーマ検証と順序 | ✅ `user → assistant → user → assistant` |
| `DELETE /chat/conversations/{id}` と一覧からの消滅 | ✅ |

Zodスキーマについては、`z.string().uuid()` と `z.string().datetime()`（zod 4.4.3）が T3-1 の実レスポンス形式 `"2026-07-31T11:04:38.828839Z"`（マイクロ秒精度・`Z` 付き）を問題なく受け付けることを実データで確認しました。ここが通らないと履歴機能が丸ごと死ぬ箇所なので重点的に見ています。

### 設計・実装面

- `chatStore` の状態追加（`activeConversationId` / `conversations` / `isHistoryLoading` / `hasLoadedHistory`）と `clearMessages` での `activeConversationId` リセットが整合している
- `loadConversations` の二重実行ガード（`isHistoryLoading || (hasLoadedHistory && !force)`）が、`Sidebar` と `NormalChat` の両方が `useChat()` を呼ぶ構成でも、React StrictModeの二重実行でも正しく効く。`setHistoryLoading(true)` が最初の `await` より前にあるため、後続の呼び出しが確実に弾かれる
- `loadConversation` / `deleteConversation` がストリーミング中はフック側でもガードされ、ボタン側の `disabled={isStreaming}` と二重に守られている
- 会話行が `div` + 2つの `Button` で構成され、インタラクティブ要素の入れ子になっていない。削除ボタンに `aria-label={...を削除}` があり、`opacity-0` でもフォーカス時に見える（`focus-visible:opacity-100`）
- APIレスポンスのsnake_caseを `toChatConversation` / `toChatMessage` でcamelCaseへ変換し、`src/types/chat.ts` の型に寄せている。`code_style.md` のディレクトリ責務分離に沿っている
- `get_database_url()` の相対パス正規化を確認（相対 → プロジェクトルート基準の絶対パス、絶対パス指定はそのまま、非SQLite URLは素通し）。既存の `backend/data/chat.db` を正しく指すことも確認済み

### セキュリティ観点（`AGENTS.md` 7章・9章・10章）

- React → FastAPI は引き続き axios の直接HTTP。Tauri `invoke()` の使用なし
- 新規の外部通信なし。通信先は FastAPI と Ollama のみ
- `.env` は `.gitignore` 対象のまま。`!.env.example` で除外されたのは `.env.example` のみで、実 `.env` が追跡対象に入っていないことを `git status` で確認
- `.env.example` に秘密情報は含まれない（ローカルURLとタイムアウト値のみ）
- ファイル書き込み・パストラバーサルに関わる変更なし

### Lint / ビルド

- `npm run lint`: エラー0、警告1（既存の shadcn `Button` 由来）
- `npm run build`: 成功
- `ruff check` / `black --check`: T3-1 のレビュー時から変更なく成功

検証で起動した uvicorn は停止済み、検証用に作成した会話は `DELETE /chat/conversations/{id}` 経由で削除済みです（`chat.db` への直接操作は行っていません）。

---

## 修正時のおすすめ順序

1. **重大1**: `src/api/client.ts` に既定値を戻す（1行）+ README にセットアップ手順を追記
2. **中2**: `Sidebar` の履歴セクションに `overflow-y-auto`（1クラス）
3. **中1**: 新規会話作成後のタイトル再取得
4. 軽微1〜3は余力があれば

---

# 第2回レビュー（2026-07-31）

初回の指摘（重大1・中2・軽微4件）すべてに対応されていることを確認しました。

## 判定

**承認**

指摘した内容はすべて修正され、実測でも解消を確認しています。以下に挙げる4点はいずれも動作を壊さない軽微な項目で、マージをブロックするものではありません。ただし**任意1（タイトルポーリングの予算）だけは実測値が予算の上限ぎりぎり**なので、目を通しておいてください。

---

## 指摘への対応確認

### 重大1: `.env` が無い環境での通信断 → 修正済み

```ts
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";
```

Vite が `.env` 不在時に行う置換（`undefined`）を再現してバンドルし、実際の `apiClient` を読み出した結果:

```
.env なし相当（Viteが undefined に置換）→ baseURL = "http://127.0.0.1:8000"
```

型宣言も `readonly VITE_API_BASE_URL?: string;` に変わり、README にも手順「### 2. 環境変数ファイルの作成 / `cp .env.example .env`」が追加されました（以降の番号も繰り上げ済み）。バックエンドと同じ「`.env` が無ければローカル既定値」に揃っています。

### 中1: 新規会話のタイトルが更新されない → 修正済み

`sendMessage` の末尾で、新規会話のときだけ `waitForGeneratedTitle` を起動し、タイトルが既定値の間だけ5秒間隔・最大12回（60秒）一覧を再取得する形になりました（`useChat.ts:99-113`）。ポーリング中の再取得は `reportError = false` で呼ばれるため、失敗してもチャット画面にエラーが出ません。会話が削除されていれば `!conversation` で即座に打ち切られます。

実サーバー + 実Ollamaでの実測（ストリーム完了を起点とした、タイトルが既定値から変わるまでの時間）:

| モデル | ストリーム完了まで | 送信直後のタイトル | タイトル確定まで | 60秒予算 |
|---|---|---|---|---|
| `gemma4:e4b` | 5.2s | `"新しいチャット"` | **1.0s** → `"日本の最高峰は富士山"` | 余裕あり |
| `gemma4:12b` | 13.5s | `"新しいチャット"` | **56.3s** → `"日本最高峰に関するやり取り"` | ぎりぎり間に合う |

どちらも予算内に収まりましたが、`gemma4:12b` は最後（12回目）のポーリングで拾っている状態です。後述の「任意1」を参照してください。

### 中2: 履歴一覧がスクロールできない → 修正済み

```diff
-<section className="min-h-0 flex-1 px-3 py-4">
+<section className="flex min-h-0 flex-1 flex-col px-3 py-4">
   <h2 ...>チャット履歴</h2>
-  <div className="mt-3 space-y-1">
+  <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
```

`section` を flex コンテナにしたうえで、リスト側に `min-h-0 flex-1 overflow-y-auto` を付ける形です。見出しは固定され、リストだけが独立してスクロールします。実際に `Sidebar` を描画して `overflow-y-auto` を持つ要素が履歴リストに1つ存在することを確認しました。

### 軽微1〜4 → いずれも対応済み

| 指摘 | 対応 |
|---|---|
| 軽微1: サイドバーがトークンごと再描画 | `Sidebar` から `useChat()` を外し、`useChatStore` から `activeConversationId` / `conversations` / `isHistoryLoading` / `isStreaming` だけを個別購読。履歴操作はモジュール関数（`loadChatConversation` / `removeChatConversation` / `startNewChat`）を直接呼ぶ形に変更。`messages` の購読が無くなったのでストリーミング中の再描画は起きない |
| 軽微2: 削除の確認 | 指摘どおり現状維持（プランに明記がなく意図的な省略） |
| 軽微3: 不要な `stopPropagation()` | 削除済み。`MouseEvent` の import も除去 |
| 軽微4: オフライン要件の担保 | `get_ollama_base_url()` でスキームとホストを検証するようになった |

軽微4の検証結果:

```
'http://127.0.0.1:11434'   -> OK  'http://127.0.0.1:11434'
'http://localhost:11434/'  -> OK  'http://localhost:11434'   （末尾スラッシュも正規化）
'http://[::1]:11434'       -> OK  'http://[::1]:11434'
'http://example.com:11434' -> 拒否
'https://api.openai.com'   -> 拒否
(未設定)                    -> OK  'http://127.0.0.1:11434'
```

`.env` 経由でも外部LLM APIへ向けられなくなり、`AGENTS.md` 7章のオフライン要件がコード上で担保されました。指摘した以上の対応で、良い判断だと思います。

---

## 任意で対応（今回の判定には影響しません）

### 任意1: タイトルポーリングの60秒予算が実測値のほぼ上限

**該当箇所**: `src/hooks/useChat.ts:35-36`

```ts
const GENERATED_TITLE_POLL_INTERVAL_MS = 5_000;
const GENERATED_TITLE_POLL_ATTEMPTS = 12;   // 合計60秒
```

上の実測表のとおり、`gemma4:12b` はストリーム完了から **56.3秒**でタイトルが確定しました。予算60秒に対して残り3.7秒です。しかもこの計測は、直前のチャットでモデルがウォームな状態でのものです。初回の質問と回答が長ければタイトル生成のプロンプトも長くなり、60秒を超えます。

超えた場合はポーリングが静かに打ち切られ、**次に何かを送信するかアプリを再起動するまでタイトルが「新しいチャット」のまま**になります。つまり中1の修正前と同じ状態に戻ります。

`GENERATED_TITLE_POLL_ATTEMPTS` を 24（=120秒）程度に上げておけば、実測値に対して十分な余裕ができます。ポーリング中の再取得はエラーを表示しないので、伸ばしても副作用はありません。

### 任意2: 一覧の再取得中に「読み込み中...」がリストの上に割り込む

**該当箇所**: `src/components/layout/Sidebar.tsx:88-95`

`conversations.map(...)` が `isHistoryLoading` で分岐していないため、既にリストが表示されている状態で再取得が走ると、「読み込み中...」がリストの**上に追加で**表示されます。実際に `Sidebar` を3つの状態で描画して確認しました。

```
A: 初回ロード中（履歴0件）   → チャット履歴 / 読み込み中...
B: ロード完了（3件）         → チャット履歴 / 日本の首都は東京 / Pythonの非同期処理 / 新しいチャット
C: 3件表示中に再取得         → チャット履歴 / 読み込み中... / 日本の首都は東京 / Pythonの非同期処理 / 新しいチャット
```

ケースCは、メッセージ送信のたびに1回、さらにタイトルポーリング中は5秒ごとに最大12回発生します。そのつどリスト全体が1行分下にずれるので、ちらつきとして目に付きます。「読み込み中...」の条件を `isHistoryLoading && conversations.length === 0` にすれば解消します。

### 任意3: `useChat()` に誰も使っていない状態が残っている

**該当箇所**: `src/hooks/useChat.ts:22-32, 216-227`

`Sidebar` がストアを直接購読する形になったため、`useChat()` の利用者は `NormalChat` だけになりました。しかし `NormalChat` が使うのは `{ error, isStreaming, messages, sendMessage }` の4つで、`activeConversationId` / `conversations` / `isHistoryLoading` / `deleteConversation` / `loadConversation` / `newChat` は誰も使っていません。

`useChat()` は今も `conversations` と `isHistoryLoading` を購読しているので、**一覧が再取得されるたびに `NormalChat` が再描画されます**（タイトルポーリング中は5秒ごと）。軽微1で `Sidebar` について直したのと同じ構図が `NormalChat` 側に残っている形です。`UseChatResult` から未使用の6項目を削れば、購読も一緒に消えて素直になります。

### 任意4: 履歴の初回読み込みが `NormalChat` のマウントに依存している

**該当箇所**: `src/hooks/useChat.ts:129-131`

初回の `loadChatConversations()` は `useChat()` の `useEffect` にあり、`useChat()` を呼ぶのは `NormalChat` だけです。現状は起動時のパスが `/` でありワイルドカードも `/` へリダイレクトするため必ずマウントされ、問題は起きません。ただしサイドバーの表示内容がメイン領域のコンポーネントに依存する構造なので、今後ルーティングが変わると壊れます。`App` か `Sidebar` 側に置くほうが安全です。

### その他（対応不要）

- `OLLAMA_BASE_URL=` のように**空文字を設定した場合**は検証に引っかかり、`ValueError` で uvicorn が起動しません（未設定なら既定値にフォールバックします）。設定ミスを早期に知らせる挙動として妥当ですが、Tauriサイドカーとして起動する都合上、画面には「サーバーに接続できません」としか出ず、理由はサイドカーの標準エラー出力にしか残りません。頻度は低いので対応不要と判断しますが、挙動として記録しておきます

---

## 回帰確認

| 確認項目 | 結果 |
|---|---|
| `npm run lint` | エラー0、警告1（既存の shadcn `Button` 由来）✅ |
| `npm run build` | 成功 ✅ |
| `ruff check` / `black --check` | いずれも成功 ✅ |
| `/normal-chat` の送信と `conversation_id` の受け取り | ✅ |
| `GET /chat/conversations` / `DELETE /chat/conversations/{id}` | ✅ |
| 履歴一覧の Zod スキーマ検証 | ✅ |

初回レビューで確認済みの項目（会話復元、2ターン目の履歴継続、`loadChatConversations` の二重実行ガード、`get_database_url()` の相対パス正規化、`.env` が追跡対象に入っていないこと）にも変化はありません。`loadChatConversations` の二重実行ガードは、`Sidebar` が `useChat()` を使わなくなったことで初回ロードの呼び出し元自体が1箇所に減り、より単純になっています。

検証で起動した uvicorn は停止済み、作成した会話は `DELETE /chat/conversations/{id}` 経由で削除済みです（`chat.db` への直接操作は行っていません）。

`AGENTS.md` 3章の連携フローに従い、`feature/t3-chat-history-ui` を `develop` にマージして問題ありません。これで Phase 3（T3-1・T3-2）が完了します。

---

# 第3回レビュー（2026-07-31）

第2回で「任意」とした4件すべてに対応されたため、回帰確認を目的にレビューしました。

## 判定

**承認（指摘なし）**

---

## 任意項目への対応確認

### 任意1: タイトルポーリングの予算 → 対応済み。**実測で必要だったことが裏付けられました**

```ts
const GENERATED_TITLE_POLL_ATTEMPTS = 24;   // 5秒 × 24回 = 120秒
```

回帰確認の通しで `gemma4:12b` を使ったところ、タイトル確定まで **75秒（15回目のポーリング）** かかりました。

```
15回目（75秒後）でタイトル確定: "日本最長河川に関するやり取り"
→ 24回(120秒)の予算に対する余裕: 9回
```

第2回の実測は56.3秒でしたが、今回は75秒です。**修正前の60秒予算だったらタイトルは反映されずに終わっていました**。指摘が机上の懸念ではなく実際に踏む条件だったことが確認できたので、この拡張は妥当です。120秒に対しては9回分の余裕があります。

### 任意2: 再取得中の「読み込み中...」の割り込み → 対応済み

```diff
-{isHistoryLoading && (
+{isHistoryLoading && conversations.length === 0 && (
   <p className="px-2 text-sm text-muted-foreground">読み込み中...</p>
 )}
```

第2回と同じ3状態で `Sidebar` を描画して比較しました。

| 状態 | 第2回 | 今回 |
|---|---|---|
| A: 初回ロード中（0件） | 読み込み中... | 読み込み中... |
| B: ロード完了（3件） | 3件 | 3件 |
| C: 3件表示中に再取得 | **読み込み中... + 3件** | **3件のみ** |

ケースCで一覧の縦位置が動かなくなりました。初回ロード時の「読み込み中...」は従来どおり出ます。

### 任意3: `useChat()` の未使用購読 → 対応済み

`useChat()` の購読が3つだけになりました。

```
const error = useChatStore((state) => state.error);
const isStreaming = useChatStore((state) => state.isStreaming);
const messages = useChatStore((state) => state.messages);
```

`UseChatResult` も `{ error, isStreaming, messages, sendMessage }` の4項目に戻り、`NormalChat` が実際に使う分と一致しました。会話一覧が再取得されても `NormalChat` は再描画されません。

### 任意4: 初回読み込みの置き場所 → 対応済み

`useEffect(() => { void loadChatConversations(); }, [])` が `Sidebar` へ移りました。`Sidebar` は `App.tsx` で `<Routes>` の外にあり常時マウントされるため、履歴の読み込みがメイン領域のルーティングに依存しなくなりました。呼び出し元が1箇所になったことで、二重実行ガードの前提も単純になっています。

---

## 回帰確認

実サーバー（uvicorn + 実Ollama `gemma4:12b`）に対し、フロントエンドの実コード（`src/api/chat.ts` と `src/hooks/useChat.ts` のエクスポート関数）をそのままバンドルして通しで実行しました。

| 確認項目 | 結果 |
|---|---|
| Sidebarマウント相当の初回ロード（`force` なし） | ✅ `hasLoadedHistory` が立つ |
| 新規会話の送信と `conversation_id` の受け取り | ✅ |
| 送信直後のサイドバー表示 | `["新しいチャット"]`（想定どおり） |
| タイトルポーリングでの反映 | ✅ 75秒後に確定 |
| 2ターン目で履歴が継続するか | ✅ 「最初の質問は？」→「日本一長い川。」 |
| `loadChatConversation` での復元 | ✅ `user → assistant → user → assistant` の順で4件、`activeConversationId` も設定 |
| `removeChatConversation` | ✅ messages 0件・`activeConversationId` null・一覧空・エラーなし |
| `npm run lint` | エラー0、警告1（既存の shadcn `Button` 由来）✅ |
| `npm run build` | 成功 ✅ |
| `ruff check` / `black --check` | いずれも成功 ✅ |
| `.env` が追跡対象に入っていないこと | ✅ |

第1回・第2回で確認済みの項目（Zodスキーマの実データ検証、`.env` 不在時のフォールバック、`OLLAMA_BASE_URL` のローカル制限、履歴一覧の `overflow-y-auto`、`get_database_url()` の相対パス正規化）にも変化はありません。

検証で起動した uvicorn は停止済み、作成した会話は `removeChatConversation`（= `DELETE /chat/conversations/{id}`）経由で削除済みです。`chat.db` への直接操作は行っていません。

判定は第2回の承認から変わりません。`feature/t3-chat-history-ui` を `develop` にマージして問題ありません。
