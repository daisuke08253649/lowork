# T2-2 レビュー結果

- 対象タスク: T2-2 チャット UI コンポーネントの実装
- 対象ブランチ: `feature/t2-chat-ui`（未コミットの作業ツリーを対象にレビュー）
- レビュー日: 2026-07-30
- **判定: 要修正**

---

## 検証方法

impl.md の記載だけでなく、実際の差分・実行結果に基づいて確認した。

1. `git diff develop -- package.json` および新規ファイル全文の読み取り
2. `npm run lint` / `npm run build`
3. `react-markdown@10.1.0` を `ChatBubble` と同一の `components` 設定で `react-dom/server` により静的レンダリングし、出力HTMLを確認（XSS・リンク・画像・コードブロックの実出力）
4. ビルド済みCSSを使った検証用ページを `dist/`（gitignore対象）に一時配置し、Chromeで実表示を目視確認（検証後に削除済み）

---

## 良い点

- **XSS対策は正しい。** `react-markdown` に `rehype-raw` を入れていないため生HTMLはエスケープされる。実出力で確認済み。
  - `<script>alert(1)</script>` → `&lt;script&gt;alert(1)&lt;/script&gt;`
  - `[click](javascript:alert(1))` → `<a href="">click</a>`（`defaultUrlTransform` により無害化）
  - impl.md の「AI本文を安全にMarkdown表示」という記述は妥当。
- ディレクトリ配置が `design.md` 3章のフロントエンド構成と完全に一致している（`components/chat/`, `components/common/`, `components/ui/`）。
- `any` 型なし。`ChatBubbleProps` 等の props 型が明示されており `code_style.md` に準拠。
- Tauri `invoke()` の使用なし、Ollama以外のAPI呼び出しなし（`AGENTS.md` 7章に適合）。
- `npm run lint` はエラー0（警告1件は既存の `button.tsx` 由来で本差分とは無関係）、`npm run build` 成功。
- Enter送信 / Shift+Enter改行、`canSubmit` による空文字送信の抑止、`aria-label` の付与など、基本的な作り込みは丁寧。

---

## 指摘事項

### 【重大1】Markdownの画像記法が、レンダリング時に外部ホストへ自動でHTTPリクエストを送る

`ChatBubble` は `img` を上書きしていないため、AI応答に画像記法が含まれると外部URLをそのまま `<img src>` として描画する。実出力:

```
入力: ![x](https://example.com/track.png)
出力: <link rel="preload" as="image" href="https://example.com/track.png"/>
      <p ...><img src="https://example.com/track.png" alt="x"/></p>
```

`<img>` はユーザー操作なしに読み込まれる。さらに `src-tauri/tauri.conf.json` は `"csp": null` のため、WebView側でも遮断されない。

これは以下に抵触する:
- `requirements.md` 6章「オフライン動作: 完全ローカルで動作すること」「プライバシー: 外部サーバーへのデータ送信なし」
- `AGENTS.md` 9章「完全ローカル動作が絶対要件。新規に外部サーバーへの通信を追加しない」

現時点（普通のチャット）ではローカルLLMのハルシネーションによる画像URL程度だが、**Phase 5以降のプロジェクトチャットではRAGでユーザーのノート本文がプロンプトに入る**ため、生成された画像URLのパスやクエリにノート由来の文字列が混入すると、そのまま外部ホストへの送信経路になる。UIコンポーネントの段階で塞いでおきたい。

対応案（いずれか）:
- `components` に `img: () => null` を追加し、画像を描画しない（MVPとしては最も単純・確実）
- 画像を描画するなら、`src` が相対パス／ローカルファイルのときのみ許可し、それ以外は alt テキストへフォールバックする

### 【重大2】Markdownリンクをクリックすると、アプリのWebViewが外部サイトへ遷移する

`a` も上書きしていないため、`<a href="https://example.com/evil">click</a>` がそのまま出力される（実出力で確認）。`target` / `rel` もない。

Tauri（macOSはWKWebView）ではブラウザのアドレスバーも戻るボタンもないため、**クリックした瞬間にアプリ画面が外部サイトに置き換わり、ユーザーが元の画面に戻る手段がなくなる**。同時に【重大1】と同じくオフライン要件にも反する。

対応案（いずれか）:
- `a` を上書きして、リンクをクリック不可のテキスト（`<span>`）として描画する（MVPとして最小）
- 外部リンクを開く体験が必要なら `@tauri-apps/plugin-opener` で既定ブラウザに委譲し、WebView自体は遷移させない

なお `javascript:` は `react-markdown` 側で無害化されているので、この点は追加対応不要。

### 【指摘1】IME変換確定のEnterで誤送信される（日本語入力で必ず踏む）

`src/components/chat/MessageInput.tsx:29-36`

```ts
function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (canSubmit) {
      onSubmit();
    }
  }
}
```

IME変換中に変換候補を確定するEnterでも `keydown` は発火し、この分岐に入って送信されてしまう。`requirements.md` 6章で **UI言語は日本語固定**と定めている以上、日本語入力は例外ケースではなく通常フローであり、「変換確定しようとしたら未確定の文章が送信された」が日常的に起きる。

対応: 変換中を除外するガードを入れる。

```ts
function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
  // IME変換中のEnterは確定操作なので送信しない
  if (event.nativeEvent.isComposing) {
    return;
  }
  if (event.key === "Enter" && !event.shiftKey) {
    ...
  }
}
```

### 【指摘2】コードブロックがバブルの外へはみ出す

`src/components/chat/ChatBubble.tsx:36-40` は `code` のみを上書きしているが、フェンス付きコードブロックは `<pre><code>` として描画され、`<pre>` は未スタイル。`<pre>` のUA既定は `white-space: pre`（折り返しなし）で `overflow-x` の指定もないため、長い行がバブルの `max-w-[80%]` を突き抜ける。

Chromeでの実表示で確認済み。AIバブル（角丸の灰色背景）の右端よりコード行が明確に外側までせり出し、背景の外に文字が浮いた状態になる。AI応答にコードブロックが含まれるのは日常的なので、実害が大きい。

また、`code` の上書きがインラインとブロックの両方に適用されるため、コードブロックの `<code>` にもインライン用の `px-1 py-0.5 rounded` が当たってしまっている。

対応: `pre` を上書きして `overflow-x-auto` を持たせ、インラインとブロックでスタイルを分ける。

```tsx
pre: ({ children }) => (
  <pre className="mb-2 overflow-x-auto rounded-lg bg-foreground/10 p-3 last:mb-0">
    {children}
  </pre>
),
```
（このとき `code` 側は、`<pre>` 配下では padding/背景が二重にならないよう調整する）

### 【指摘3】インラインコードの背景がAIバブルでほぼ見えない

`src/components/chat/ChatBubble.tsx:37` の `bg-background/15` は「背景色の15%」。`--background` はライトテーマで `oklch(1 0 0)`（白）なので、`bg-muted`（`oklch(0.97 0 0)`＝ほぼ白の灰色）のAIバブル上に白15%を重ねてもコントラストがほぼゼロになる。

Chromeでの実表示で確認済み。同じクラスでも、ダークな `bg-primary` のユーザーバブルでは背景が明確に見えるのに対し、**AIバブルでは背景が視認できず、地の文と区別がつかない**。インラインコードが出るのは主にAI応答側なので、意図と逆の結果になっている。

対応: バブルの地色に対して差が出るトークンにする（例: `bg-foreground/10`）。両バブルで見え方を確認すること。

### 【軽微1】自動スクロールが無条件のため、ストリーミング中に過去ログを読めない

`src/components/chat/MessageList.tsx:18-23` は `messages` が変わるたび無条件に最下部へ移動する。T2-3でSSEストリーミングを繋ぐと1トークンごとに発火するため、ユーザーが上にスクロールしても即座に引き戻されて過去の発言を読み返せない。

対応: 「すでに最下部付近にいるときだけ追従する」判定を入れる（`scrollHeight - scrollTop - clientHeight` が閾値以下のときのみスクロール）。T2-3と同時対応でもよい。

### 【軽微2】`aria-live` の付与位置

`MessageList.tsx:29-30` はスクロールコンテナ全体に `role="log" aria-live="polite"` を付けている。ストリーミング中は内容が高頻度で書き換わるため、スクリーンリーダーが全体を繰り返し読み上げる可能性がある。MVPでは許容範囲だが、`aria-live` は追加される最新メッセージ単位に付ける方が素直。

---

## 申し送り（T2-3で対応する前提のため、本レビューでは指摘としない）

- `MessageList` の `useEffect` の依存は `[messages]`（配列の参照）。T2-3で `chatStore` がストリーミング中のメッセージを**同一配列を破壊的に更新する形**で持つと自動スクロールが発火しない。ストア側は必ず新しい配列を返す実装にすること。
- `ChatMessage` 型が `MessageList.tsx` にある。T2-3で `chatStore.ts` と共有するので、そのタイミングで定義場所を見直すとよい（`design.md` に `src/types/` の記載はないため、現状の配置のままでも規約違反ではない）。
- 各コンポーネントはまだどこからも import されていない（`src/pages/NormalChat.tsx` への統合はT2-3のスコープ）。実装計画書のタスク粒度どおりで問題なし。

---

## 観点別まとめ

| 観点 | 結果 |
|---|---|
| `design.md` ディレクトリ構成・UIレイアウト | 適合 |
| `AGENTS.md` 7章（Tauri invoke不使用・Ollama以外の外部API不使用） | 適合 |
| `AGENTS.md` 9章 / `requirements.md` 6章（完全ローカル動作・外部送信なし） | **逸脱あり（重大1・重大2）** |
| `code_style.md`（`any`禁止・型明示・ネスト2階層・CSSファイル不作成） | 適合 |
| `requirements.md` 6章（UI言語＝日本語固定） | **考慮漏れあり（指摘1: IME）** |
| `implementation_plan.md` のタスク粒度・依存関係 | 適合（T1-1完了後に着手、T2-3のスコープに踏み込んでいない） |
| `AGENTS.md` 10章（禁止コマンド・操作） | 抵触なし |

---

## 対応をお願いしたい項目

**必須**: 重大1（画像の外部通信）、重大2（リンクによるWebView離脱）、指摘1（IME誤送信）、指摘2（コードブロックのはみ出し）、指摘3（インラインコードの不可視）

**任意**: 軽微1（T2-3と同時対応でも可）、軽微2

修正後に再レビューを行う。

---
---

# 再レビュー（2026-07-30）

- **判定: 承認（軽微な指摘1件）**

## 検証方法

1. `src/components/chat/` 配下および `ModelSelector.tsx` の全文を再読
2. `ChatBubble` と同一の `components` 設定で `react-dom/server` により静的レンダリングし、実出力HTMLを確認
3. `npm run build` 後、生成CSSに該当ユーティリティが実際に出力されているかを確認
4. `App.css` のトークン値（oklch）から、コード背景と各バブル地色の実効コントラストを数値計算
5. `npm run lint` / `npm run build`

## 必須指摘への対応確認

### 重大1（画像の外部通信）→ 修正確認

`ChatBubble.tsx:26` に `img: () => null` を追加。実出力で確認:

| 入力 | 出力 | 外部URL残存 | `<img>` |
|---|---|---|---|
| `![x](https://example.com/track.png)` | `<p class="mb-2 last:mb-0"></p>` | なし | なし |
| 参照形式 `![alt][ref]` + `[ref]: https://evil.example/pixel.gif` | `<p class="mb-2 last:mb-0"></p>` | なし | なし |
| 生HTML `<img src="https://example.com/raw.png">` | テキストとしてエスケープ | （表示のみ） | なし |

前回確認された `<link rel="preload" as="image" href="...">` も出力されなくなった。参照形式・生HTMLを含め、レンダリング起因の外部リクエストは発生しない。オフライン要件への抵触は解消。

### 重大2（リンクによるWebView離脱）→ 修正確認

`ChatBubble.tsx:25` に `a: ({ children }) => <span>{children}</span>` を追加。全ケースで `href=` が出力されないことを確認。

- `[公式サイト](https://example.com/evil)` → `<span>公式サイト</span>`
- `<https://example.com/evil>`（autolink） → `<span>https://example.com/evil</span>`

autolink 形式ではURL文字列自体は表示されるが、クリック不能なテキストなので遷移は起きない。WebViewが外部サイトに置き換わる問題は解消。

### 指摘1（IME誤送信）→ 修正確認

`MessageInput.tsx:30-32` に `event.nativeEvent.isComposing` のガードを追加。`Enter` 判定より前に置かれているため、変換確定のEnterは `onSubmit()` に到達しない。位置・条件とも適切。

### 指摘2（コードブロックのはみ出し）→ 修正確認

`ChatBubble.tsx:38-42` で `pre` を上書き。ビルド後のCSSに実際に出力されていることを確認:

```
.overflow-x-auto{overflow-x:auto}
.\[\&\>code\]\:rounded-none>code{border-radius:0}
.\[\&\>code\]\:bg-transparent>code{background-color:#0000}
.\[\&\>code\]\:p-0>code{padding:0}
```

`overflow-x-auto` により長い行はバブル内で横スクロールに収まる。あわせて `[&>code]` の子セレクタでインライン用の背景・角丸・余白が `<pre>` 配下では打ち消されるため、前回指摘した「インライン用スタイルがコードブロックにも二重に当たる」問題も解消されている。

### 指摘3（インラインコードが不可視）→ 修正確認（ただし後述の軽微1あり）

`bg-background/15` → `bg-foreground/10` に変更。ビルド後のCSSで
`.bg-foreground\/10{background-color:color-mix(in oklab,var(--foreground) 10%,transparent)}`
が生成されていることを確認。報告した「AIバブルで見えない」状態は解消された。

---

## 新規指摘

### 【軽微1】インラインコード／コードブロックの背景が、今度は**ユーザーバブル**でほぼ見えない

`bg-foreground/10` はページの前景色（＝地の文の色）基準なので、`bg-muted` のAIバブルでは十分なコントラストが出るが、`bg-primary` のユーザーバブルは `--foreground` とほぼ同じ明度のため差が出ない。前回の指摘の鏡像にあたる。

`App.css` のトークン値から実効色を計算した結果（sRGB 0〜255 換算）:

| テーマ | バブル | 地色 | コード背景 | 差 |
|---|---|---|---|---|
| light | AIバブル `bg-muted` | 244.9 | 221.5 | **23.5** |
| light | ユーザー `bg-primary` | 23.1 | 21.8 | **1.3** |
| dark | AIバブル `bg-muted` | 38.1 | 59.3 | **21.2** |
| dark | ユーザー `bg-primary` | 229.0 | 231.1 | **2.1** |

ユーザーバブルでの差は 1〜2/255 で、ライト・ダークとも実質不可視。`code` と `pre` の両方に同じクラスが使われているため、どちらも同じ状態になる。

ただし**ユーザーが自分の入力にMarkdownのコード記法を使う頻度は低い**ため、影響は限定的と判断し軽微とする。

対応案: `ChatBubble` はすでに `isUser` を持っているので、バブルごとに基準色を切り替えるのが確実。

```tsx
const codeBg = isUser ? "bg-primary-foreground/10" : "bg-foreground/10";
```

上表と同じ計算で、`bg-primary-foreground/10` はユーザーバブルで light 22.7 / dark 20.6 の差となり、両テーマで視認できる。

（`bg-current/10` で currentColor 基準にする書き方も考えられるが、Tailwind v4 で当該ユーティリティが生成されるかを今回確認しきれなかったため、上記の明示的なトークン指定を推奨する。）

### 【軽微2・任意】`[テキスト](URL)` 形式でURLが完全に失われる

`a` を `span` に置き換えたことで、`[公式サイト](https://example.com)` は「公式サイト」とだけ表示され、URLを確認する手段がなくなる。遷移を防ぐ目的は達成されているが、リンク先を知りたいケースでは情報が欠落する。

気になるようなら `公式サイト (https://example.com)` のようにURLをテキストとして併記する、`title` 属性に入れる等の案がある。MVPでは現状のままでも可。

---

## 前回の軽微1・軽微2について

Codexの記載どおり、自動スクロールの改善（最下部付近にいるときのみ追従）とライブリージョンの細分化はT2-3で扱う方針で問題ない。

ただし、これまでの運用（T2-1で `implementation_plan.md` のT2-3・T3-1に申し送りを追記した例）にならい、**レビュースレッドだけに残さず `implementation_plan.md` のT2-3の作業内容に1行追記しておくこと**を推奨する。あわせて、既に本レビューに記載した「ストア側は必ず新しい配列を返すこと」も同じ箇所に含めるとよい。

## 検証結果

- `npm run lint`: エラー0（警告1件は既存 `button.tsx` 由来で本差分と無関係）
- `npm run build`: 成功
- Markdownレンダリング: XSS（生HTMLエスケープ・`javascript:` 無害化）は前回同様に維持されていることを再確認

## 結論

必須としていた5件（重大2件・指摘3件）はすべて修正され、実出力・生成CSS・数値計算で確認できた。オフライン要件への抵触は解消済み。

残る軽微1は表示上の問題で発生頻度も低いため、マージのブロッカーとはしない。`AGENTS.md` 3章の連携フローに従い、`feature/t2-chat-ui` を `develop` へマージしてよい。軽微1・軽微2はT2-3の作業と合わせて対応することを推奨する。

---
---

# 再々レビュー（2026-07-30）

- **判定: 承認（指摘なし）**

> 【番号についての注記】本ファイルには「軽微1」が2つ存在する。混同を避けるため、以下では内容で呼び分ける。
> - 初回レビューの軽微1 = **自動スクロールが無条件**（→T2-3送り）
> - 初回レビューの軽微2 = **`aria-live` の付与位置**（→T2-3送り）
> - 再レビューの軽微1 = **ユーザーバブルでコード背景が不可視**（→今回修正）
> - 再レビューの軽微2 = **`[テキスト](URL)` でURLが失われる**（→任意、未対応のまま）

## 対応確認

### 再レビュー軽微1（ユーザーバブルでコード背景が不可視）→ 修正確認

`ChatBubble.tsx:12-14` でバブルごとに基準色を切り替えるよう変更:

```tsx
const codeBackgroundClass = isUser
  ? "bg-primary-foreground/10"
  : "bg-foreground/10";
```

ビルド後のCSSに両クラスが出力されていることを確認:

```
.bg-foreground\/10{background-color:color-mix(in oklab,var(--foreground) 10%,transparent)}
.bg-primary-foreground\/10{background-color:color-mix(in oklab,var(--primary-foreground) 10%,transparent)}
```

`App.css` のトークン値から実効コントラストを再計算した結果、4通りすべてで視認可能になった（前回、ユーザーバブルは 1.3 / 2.1 だった）:

| テーマ | バブル | 使用クラス | 地色 | コード背景 | 差 |
|---|---|---|---|---|---|
| light | AIバブル `bg-muted` | `bg-foreground/10` | 244.9 | 221.5 | 23.5 |
| light | ユーザー `bg-primary` | `bg-primary-foreground/10` | 23.1 | 45.8 | **22.7** |
| dark | AIバブル `bg-muted` | `bg-foreground/10` | 38.1 | 59.3 | 21.2 |
| dark | ユーザー `bg-primary` | `bg-primary-foreground/10` | 229.0 | 208.4 | **20.6** |

`pre` と `code` の両方に同じ変数が渡されているが、`pre` 側の `[&>code]:bg-transparent` は
`.\[\&\>code\]\:bg-transparent>code{background-color:#0000}`（特異度 0-1-1）として出力されており、
`code` 自身の `.bg-primary-foreground\/10`（特異度 0-1-0）より強い。コードブロック内で背景が二重に乗ることはない。

### 実装計画書への申し送り追記 → 確認

`docs/implementation_plan.md` のT2-3 `chatStore.ts` の直下に1行追加されている:

```
- ストリーミング更新では新しいメッセージ配列を返し、ユーザーが最下部付近にいる場合のみ自動スクロールを追従させる
```

初回レビューの軽微1（自動スクロールの追従条件）と、申し送りに書いた「ストア側は必ず新しい配列を返すこと」の両方が1行に含まれている。差分はこの1行のみで、他の記述への巻き込み変更はない。

## 回帰確認

`ChatBubble` と同一の `components` 設定で、AIバブル・ユーザーバブル両方の実出力を確認。これまでの修正がすべて維持されている。

| 確認項目 | AIバブル | ユーザーバブル |
|---|---|---|
| `<img>` 要素の出力 | なし | なし |
| `href=` の出力 | なし | なし |
| 外部URLの残存 | なし | なし |
| 生HTML `<script>` の実体化 | なし（エスケープ） | なし（エスケープ） |
| `pre` の `overflow-x-auto` | あり | あり |

- `npm run lint`: エラー0（警告1件は既存 `button.tsx` 由来で本差分と無関係）
- `npm run build`: 成功

## 未対応のまま残る項目（合意済み）

| 項目 | 扱い |
|---|---|
| 初回レビュー軽微1: 自動スクロールの追従条件 | T2-3で対応（`implementation_plan.md` に記載済み） |
| 初回レビュー軽微2: `aria-live` の付与位置 | T2-3で対応 |
| 再レビュー軽微2: `[テキスト](URL)` でURLが失われる | 任意。MVPでは現状のままでよい |

## 結論

指摘した項目はすべて対応済み、または対応方針が実装計画書に記録された状態になった。新規の指摘はない。

`AGENTS.md` 3章の連携フローに従い、`feature/t2-chat-ui` を `develop` へマージしてよい。
