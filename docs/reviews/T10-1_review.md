# T10-1 レビュー結果（設定・チャットUIの操作性改善の敵対的検証）

## 第1回レビュー（2026-09-08）— 敵対的検証

**判定: 要修正**（要修正1件、軽微6件）

`docs/fix.md` に挙がった6つの要望は**すべて実装され、実測でも意図どおり動く**。Enterで改行・Shift+Enterで送信、IME変換中の誤送信ガード、送信ボタンの横長化、プロジェクトチャットの見出し変更、新規会話ボタンの移動、カテゴリ絞り込み、判定不能モデルの無効化 — 全部そのとおりになっていることを実ブラウザで確認した。T9-1で直したファイル操作フローの回帰もない。

ただし「判定不能モデルをダウンロード不可にする」という変更には、要望を出した時点では見えていなかったであろう副作用が1つある。**このアプリ自身がRAGに使う `nomic-embed-text` が、設定画面からダウンロードできなくなった**。他に導入経路がないため、新しいマシンにセットアップした場合プロジェクト機能が一切使えない状態から抜け出せない。ここだけ直せば承認できる。

### 検証環境

| 項目 | 内容 |
|---|---|
| 対象 | `feature/t10-ui-refinements` の作業ツリー差分（`develop` からのコミットは0件。後述の所見1参照） |
| バックエンド | `127.0.0.1:8000`（隔離DB・隔離Chroma）。追加検証用に `127.0.0.1:8001` を一時起動 |
| Ollama | 実物。`gemma4:12b`（ファイル操作の検証）/ `smollm2:135m`（キーボード操作の検証） |
| UI | Chromeで `http://localhost:1420`（実マウス・実キーボード） |
| モデル一覧 | 実データ239モデル・表示540行（`GET /ollama/available-models`） |
| 実測RAM | 24.0 GiB |

`backend/data/chat.db` はタイムスタンプ不変（Aug 18 21:09）。検証で書き込んだファイルはスクラッチのプロジェクトフォルダ内のみ。

---

## 要修正

### 要修正1: 判定不能を一律ダウンロード不可にしたため、アプリ必須のEmbeddingモデル `nomic-embed-text` が入手できない

`src/pages/Settings.tsx:127-129` で `available` / `warning` 以外を無効化した結果、`unknown`（判定不能）もグレーアウトされる。実測（設定画面のDOM）:

```
nomic-embed-text  必要メモリ: 判定不能  判定不能  [ダウンロード] → disabled: true
```

このモデルは他でもない**このアプリがRAGに使うモデル**である。

- `docs/design.md:120` — `| Embeddingモデル | nomic-embed-text（Ollama API経由） |`
- `backend/config.py:14` — `OLLAMA_EMBEDDING_MODEL = os.environ.get("OLLAMA_EMBEDDING_MODEL", "nomic-embed-text")`
- `backend/services/rag.py:28` — `OllamaEmbeddings(model=OLLAMA_EMBEDDING_MODEL, ...)`

そして**バックエンドにモデルの自動pullは存在しない**（`backend/` 全体を `pull` でgrepしても、該当するのは `POST /ollama/pull` の実装と一覧解析だけ）。つまり設定画面が唯一の導入経路であり、そこが塞がった。

Embeddingモデルが無いとどうなるかを、別インスタンス（ポート8001、`OLLAMA_EMBEDDING_MODEL=not-installed-embed`）で実測した:

```
GET /projects/{id}/index-status → {"status":"error","progress":0}
ollama._types.ResponseError: model "not-installed-embed" not found, try pulling it first (status code: 404)
```

プロジェクトのインデックス作成が失敗し、RAG（T5〜T6の中核機能）が丸ごと使えない。**新しいMacにこのアプリを入れた開発者本人が、アプリのUIだけでは復旧できない**状態になる。

なお、この挙動は `T8-1_review.md:93` で

> サイズ不明（`required_memory_gb is None`）は `unavailable` ではなく**判定不能を表す別の値**にし、UI側でグレーアウトせずに扱う（少なくともEmbeddingモデルはDL可能にする）

と明示的に決めた判断の反転にあたる。`docs/design.md` も同時に書き換えられているので「ドキュメント未更新」ではないが、同じ `design.md` の中で「4章: Embeddingモデルは `nomic-embed-text`」と「6章: サイズ情報がないEmbeddingモデルはダウンロードを許可しない」が正面から矛盾している。

**影響範囲の実測**（`fix.md` の要望が意図した以上に広い）:

| 指標 | 実測値 |
|---|---|
| 無効化された行 | 540行中145行（27%）が判定不能で新たに無効化 |
| 全variantが無効になったモデル | 33件 |
| その中身（一部） | `nomic-embed-text`, `nomic-embed-text-v2-moe`, `gemma3n`(E2B/E4B), `mixtral`, `llama4`, `kimi-k2.6`, `kimi-k3`, `glm-5.3`, `deepseek-v4-pro` |

`gemma3n:e2b` / `gemma3n:e4b` は「省メモリで動くこと」を売りにしたモデルだが、その `E` 表記をパーサーが読めないという理由だけで禁止される。実際、**開発機に導入済みで現に動いている `gemma4:e4b` も判定不能で無効**になっている（実測）。「RAM不足だから止める」という要望の趣旨と逆の結果になっているケースがある。

**対応案**（いずれか）:

1. アプリが必要とするEmbeddingモデル（`OLLAMA_EMBEDDING_MODEL` の値）だけは常にダウンロード可能にする。可能なら「このモデルはプロジェクト機能に必要です」と明示する。最小の修正で、要望の趣旨（大きすぎるモデルを踏ませない）は保てる
2. 判定不能は押せるが、押すと「必要メモリを判定できません。続行しますか？」の確認を挟む（`ProjectList.tsx:169-187` の削除確認と同じ `AlertDialog` が使える）
3. 1と2の併用

「サイズ情報がないモデルを一律許可」（`model.labels` が空の27件）は避けたほうがよい。`goliath`・`mistral-large-3`・`deepseek-v4-pro` のような巨大モデルも同じ条件に入り、要望の意図から外れる。

---

## 軽微

### 軽微1: Kimiカテゴリは3行すべてダウンロード不可で、開いても何もできない

`kimi-k2.6` / `kimi-k2.7-code` / `kimi-k3` の3モデルはいずれもサイズ表記がなく判定不能。カテゴリを選ぶと3行が並び、**3つとも無効**（実測: rows 3 / disabled 3）。要修正1を直せば自然に解消するが、要望で名指しされたカテゴリが空振りになっている点は共有しておきたい。

カテゴリ別の実測:

| カテゴリ | 表示行数 | うち無効 | モデル数 |
|---|---|---|---|
| すべて | 540 | 239 | 239 |
| Qwen | 76 | 33 | 16 |
| Kimi | 3 | **3** | 3 |
| GPT | 6 | 4 | 2 |
| Gemma | 22 | 10 | 5 |

### 軽微2: カテゴリが接頭辞一致のみで、239モデル中213件（89%）がどのカテゴリにも属さない

`src/pages/Settings.tsx:91-96` の `matchesCategory` は `model.name.toLowerCase().startsWith(category)`。`design.md` にも「接頭辞と大文字・小文字を区別せず照合」と書かれているので実装と仕様は一致しているが、結果として:

- `llama` 系・`deepseek` 系・`mistral` 系・`phi` 系など**213モデルは「すべて」からしか辿れない**。「その他」カテゴリがない
- Gemma系のうち `codegemma` / `translategemma` / `embeddinggemma` / `shieldgemma` / `medgemma` / `medgemma1.5` / `functiongemma` の7件はGemmaカテゴリに出ない（接頭辞ではないため）。同様に `codeqwen` もQwenに出ない

`fix.md` の「例：すべて, Qwen, kimi, gpt, gemma」はあくまで例示なので、実装がこの5つに限定されているのは判断としてあり得る。ただ**絞り込みが効くのは全体の11%**なので、「その他」の追加か、家族名を部分一致に緩める（`includes`）かは検討の余地がある。部分一致にすると `embeddinggemma` などが拾える一方、`codeqwen` のように別系統も混ざるので、どちらを取るかは好みの範囲。

### 軽微3: 判定不能で無効化されたボタンに理由の説明がない

無効化されたボタンには `title` も `aria-describedby` も無い（実測: `title: null`）。ユーザーからは「灰色のバッジと押せないボタン」しか見えず、RAM不足（赤）との区別がつかない。バッジの文言が「判定不能」なだけに、なぜ押せないのかが伝わらない。要修正1の対応案2（確認ダイアログ）を採るなら不要になる。

### 軽微4: カテゴリバーのARIA

`src/pages/Settings.tsx:410` は `<div className="flex flex-wrap gap-2" aria-label="モデルカテゴリ">`。実測で `role` は付いておらず、`aria-label` は暗黙ロールを持たない `div` では支援技術に読まれないことが多い。`role="group"` を足すと確実。

また5つのうち1つだけが選択される単一選択なので、`aria-pressed`（トグル）より `role="radiogroup"` + `aria-checked`、あるいはタブとして扱うほうが意味に合う。テーマ切替（`Settings.tsx:334`）が同じ `aria-pressed` パターンなので既存との一貫性はあり、実害は小さい。

### 軽微5: Enterが改行になったことで、長文入力が会話画面を覆い隠す

`Textarea` は `field-sizing-content min-h-16`（`src/components/ui/textarea.tsx:10`）で、**max-heightが無い**。41行入力した時点の実測:

```
textarea height: 838px / viewport 889px
textarea top: 61px（メッセージ一覧は完全に画面外）
```

添付のスクリーンショットのとおり、入力欄だけで画面が埋まる。80行まで伸ばすと送信ボタン自体が画面外（top -759px）に出る。`<main>` が `overflow-y-auto` なのでスクロールすれば戻れるが、書いている最中はキャレット追従で常に下に引っ張られる。

max-heightが無いこと自体は既存（従来もShift+Enterで同じことは起きた）だが、**Enterが改行キーになったことで長文入力が主経路になった**ので、今回の変更で顕在化しやすくなった。`MessageInput` 側で `className="max-h-[40vh]"` を渡す程度で足りる。

あわせて、**Shift+Enterで送信することを知らせるUIが画面上にない**（プレースホルダは「メッセージを入力...」のまま）。Enter送信は他のチャットアプリと共通の作法なので、逆にした以上どこかに一言あると迷わない。上の「送信ボタンが画面外に出る」ケースでは、Shift+Enterを知らないと詰まる。

### 軽微6: 「該当モデルなし」のメッセージが空テーブルの下に出る、かつ実質到達不能

`src/pages/Settings.tsx:448-452` の `filteredModels.length === 0` の分岐は、ヘッダーだけのテーブルを描画した**後ろ**にメッセージを出す。ただし `availableCategories`（同434行）が0件のカテゴリのボタン自体を出さないため、この分岐に入るのは `models` が空で `error` も無いときだけ。`GET /ollama/available-models` は解析結果が空なら502を返す（`backend/api/ollama.py:93`）ので、その状態は実質起こらない。害はないが、出すならテーブルと差し替えるほうが自然。

---

## 回帰チェック（実測でPASS）

| 確認項目 | 結果 |
|---|---|
| Enterで改行 | `line1` + Enter + `line2` → 値が `"line1\nline2"`、送信されず（URL・画面とも不変） |
| Shift+Enterで送信 | 普通のチャット・プロジェクトチャットの両方で送信・ストリーミング・入力欄クリアを確認 |
| IME変換中のShift+Enter | `isComposing: true` のkeydownを実発火 → 送信されず、`preventDefault` もされない（変換確定を邪魔しない） |
| 送信ボタンのクリック | `type="submit"`（Base UI Buttonでも維持）でform submitが発火し送信成功 |
| 送信ボタンの形状 | 96×40px、`scrollWidth 94 = clientWidth 94` でテキスト溢れなし。横長化の要望を満たす |
| 見出しの出し分け | `/`・`/projects`・`/settings` → 「チャット履歴」、`/projects/:id` → 「プロジェクトチャット履歴」。`matchPath` 由来なので一覧の中身と常に一致する |
| 新規会話ボタンの位置 | ボタン top 443 / モデル選択 top 487、左端はどちらも596pxで揃う。要望どおりモデル選択・モード切替の上 |
| 新規会話ボタンの動作 | 会話中にクリック → URLが `?conversation=` 無しに戻り、メッセージがクリアされ空状態へ。送信中は `disabled` |
| **T9-1回帰**: 新規会話の1通目でのファイル操作提案（確認モード） | 提案通知とプレビューが残り、「適用する」で `note-t10.md`（66バイト）を作成。ファイルツリーにも反映。第4回で見つけた「通知が消える」現象は再発せず |
| ファイル書き込み範囲 | プロジェクトフォルダ内のみ。フォルダ外への書き込みなし |
| カテゴリ切替中のダウンロード進捗 | 進捗パネルはテーブルの外（`Settings.tsx:367`）にあり、絞り込みを変えても消えない |
| バックエンドログ | Traceback 0件 / 5xx 0件 |
| ブラウザコンソール | エラー0件 |
| `npm run build` (tsc含む) | 成功、エラー0 |
| `npm run lint` | error 0 / warning 1（`ui/button.tsx` の既存warning） |
| `npx prettier --check`（変更6ファイル） | All matched files use Prettier code style |
| `git diff --check` | 問題なし |

`AGENTS.md` 7章のアーキテクチャ制約（axios直通信・Tauriの役割・Ollama以外への通信禁止・ファイル操作の範囲・確認/自走モードのゲート）に触れる変更は今回の差分に**無い**。差分はUIの表示ロジックとドキュメントのみで、バックエンドは1行も変わっていない。

---

## その他の所見（判定には含めない）

1. **ブランチにコミットが無い**。`feature/t10-ui-refinements` の HEAD は `develop` と同一（`04a2bd7`）で、T10-1の変更はすべて未コミットの作業ツリー差分。`code_review.md` の手順1はCodexが実装を「コミットする」前提なので、マージ前にコミットが必要。
2. `docs/fix.md` が未追跡で、`T10-1_impl.md` の変更ファイル一覧にも載っていない。開発者自身のメモであれば意図どおりだが、コミットするかどうかは判断が要る。
3. `design.md` の設定画面のASCIIモックアップにカテゴリ絞り込みの行が反映されていない。プロジェクトチャット画面のモックアップも同様（新規会話ボタンの位置は直後の文章で補足されている）。文章で説明されているので実害はない。
4. `implementation_plan.md` の「タスク依存関係サマリー」の図はT8-2で止まっており、T9-1もT10-1も載っていない。今回に始まった話ではない。

---

## マージ前に対応が必要なこと

- **要修正1**: `nomic-embed-text`（＝`OLLAMA_EMBEDDING_MODEL`）が設定画面からダウンロードできる状態に戻す。判定不能を押せなくする要望自体は維持したまま、対応案1（必須Embeddingモデルの例外）か対応案2（確認ダイアログ）で解決できる。

軽微1〜6はマージのブロッカーにしない。軽微5の `max-h` だけは1行で入るので、要修正1と一緒に入れておくと後で困らない。

---

## 第2回レビュー（2026-09-08）— 敵対的検証

**判定: 承認**（要修正0件、軽微6件）

第1回の要修正1は**実測で完全に解消**した。`nomic-embed-text` はボタンが有効になっただけでなく、クリックから `POST /ollama/pull` → 進捗100% →「ダウンロードが完了しました」まで通ることを確認した。例外は狙いどおり1行だけに効いており、無効行は239→238に減っただけで他は変わっていない。軽微4（ARIA）と軽微5（入力欄の最大高さ・キー操作の案内）も解消した。

`develop` へマージしてよい。ただし対応された軽微3（ツールチップ）は**画面上に出てこない**うえ、文言が94行で事実と違う。害はないが、直すつもりで入れたものが効いていないので、次のついででよいから直したい。

### 検証環境

| 項目 | 内容 |
|---|---|
| 対象 | `feature/t10-ui-refinements` の作業ツリー差分（コミットは依然0件） |
| バックエンド | `127.0.0.1:8000`（隔離DB・隔離Chroma）。例外の範囲を調べる目的で `OLLAMA_EMBEDDING_MODEL=llama3.1` の一時起動も実施 |
| Ollama | 実物。`gemma4:12b` / `smollm2:135m` |
| UI | Chromeで `http://localhost:1420`（実マウス・実キーボード） |
| モデル一覧 | 実データ239モデル・表示540行 |
| 実測RAM | 24.0 GiB |

`backend/data/chat.db` はタイムスタンプ不変（Aug 18 21:09）。

---

## 第1回指摘の対応状況

| 第1回の指摘 | 状態 | 実測での確認 |
|---|---|---|
| 要修正1: `nomic-embed-text` が入手できない | **解消** | 行のボタンが `disabled: false`。クリック→pull→100%→「ダウンロードが完了しました」まで実測。無効行は239→238で、例外が効いたのは当該1行のみ |
| 軽微1: Kimiカテゴリが3行とも無効 | 未対応 | 3行/3行無効のまま。要修正1の例外はEmbeddingモデル限定なので対象外。ブロッカーではないと第1回で明示済み |
| 軽微2: 接頭辞一致でカテゴリが11%しかカバーしない | 未対応 | 同上。判断としては妥当 |
| 軽微3: 無効理由の説明がない | **対応されたが効いていない** | 下記の軽微1参照 |
| 軽微4: カテゴリバーのARIA | **解消** | `role="group"` + `aria-label="モデルカテゴリ"` を実測で確認。単一選択に `aria-pressed` を使う点は第1回同様、実害なしと判断 |
| 軽微5: 長文入力で送信操作が画面外へ | **解消** | 81行入力しても入力欄は356px（=40vh）で止まり内部スクロール。送信ボタンは画面内（top 517 / bottom 557）、会話も見えたまま。プレースホルダに「Enterで改行、Shift+Enterで送信」が入り、1行に収まって見切れない |
| 軽微6: 該当0件時の表示 | 未対応 | 同上。実質到達不能なので害はない |

---

## 軽微

### 軽微1: 追加したツールチップが表示されず、しかも文言が94行で事実と違う

`src/pages/Settings.tsx:160-164` で無効ボタンに `title` を付けたが、2つ問題がある。

**(a) 出てこない。** 無効なButtonには `disabled:pointer-events-none`（`ui/button.tsx:7`）が効く。実測:

```
getComputedStyle(button).pointerEvents → "none"
document.elementFromPoint(ボタン中心) → TD（ボタンではない）
```

親の `<td>` に `title` は無いので、ホバーしても何も出ない。実際に無効ボタンの上へマウスを置いて3秒待ち、ツールチップが現れないことをスクリーンショットでも確認した。`title` を `<td>`（またはボタンを包む `<span>`）側に付ける必要がある。

**(b) 文言が状況と合っていない。** `title` は `!isDownloadable` のとき常に「必要メモリを判定できないためダウンロードできません」になるので、**RAM不足（赤・ダウンロード不可）の94行にも同じ文が付く**。実測:

```
llama3.1:70b  必要メモリ: 約40GB  ダウンロード不可
  title = "必要メモリを判定できないためダウンロードできません"
```

必要メモリは判定できている（40GBと表示されている）。足りないのはRAMのほう。`variant.compatibility.status` で文言を出し分けたい。

### 軽微2: 必須Embeddingモデルの例外が、判定不能だけでなくRAM不足も素通しする

`design.md` は「判定不能…ただし、バックエンドの`OLLAMA_EMBEDDING_MODEL`に設定したプロジェクト機能必須のEmbeddingモデルだけは例外としてダウンロードを許可する」と、**判定不能に対する例外**として書いている。一方 `Settings.tsx:139-142` は

```ts
const isDownloadable =
  variant.compatibility.status === "available" ||
  variant.compatibility.status === "warning" ||
  isRequiredEmbeddingModel(variant.pull_model, embeddingModel);
```

で、互換性ステータスを問わず素通しする。さらに `isRequiredEmbeddingModel` は `:` の前だけを比較するので、**同じベース名のvariant全部**が例外になる。

`OLLAMA_EMBEDDING_MODEL=llama3.1` でバックエンドを起動して実測（24GiBのマシン）:

| 行 | バッジ | ボタン |
|---|---|---|
| `llama3.1` | 判定不能 | 有効（意図どおり） |
| `llama3.1:70b` | **ダウンロード不可**（約40GB） | **有効** |
| `llama3.1:405b` | **ダウンロード不可**（約231.4GB） | **有効** |

既定の `nomic-embed-text` はサイズ表記が無くvariantも1つなので、**現状の設定では発現しない**（実測でも例外が効いたのは1行だけ）。`.env` で別のEmbeddingモデル（`qwen3-embedding` など、サイズ表記のあるもの）を指定し、かつRAMが足りないマシンで顕在化する。`status === "unknown" && isRequiredEmbeddingModel(...)` に絞れば設計書の記述と一致する。

### 軽微3: 判定不能なのに押せる行に、押せる理由の表示がない

`nomic-embed-text` は灰バッジ「判定不能」のまま、隣の `llama3.2`（同じ灰バッジ）は無効、という並びになる。挙動としては正しいが、見た目だけでは理由がわからない。「プロジェクト機能に必要なモデルです」のような一言があると親切（軽微1(a)を直すなら同じ仕組みで入れられる）。

### 軽微4〜6（第1回からの持ち越し・未対応）

第1回の軽微1（Kimiカテゴリが3行とも無効）、軽微2（接頭辞一致で239モデル中213件がどのカテゴリにも属さない）、軽微6（該当0件時のメッセージが空テーブルの下に出る／実質到達不能）は変わっていない。いずれもブロッカーではないと第1回で明示しているので、対応しないという判断でよい。

---

## 回帰チェック（実測でPASS）

| 確認項目 | 結果 |
|---|---|
| `GET /ollama/available-models` の新フィールド | `embedding_model: "nomic-embed-text"` を返す。`OLLAMA_EMBEDDING_MODEL=llama3.1` で起動すると `"llama3.1"` に変わる（環境変数を正しく反映） |
| Zodスキーマ | `embedding_model: z.string()` を追加。`getAvailableModels` の戻り値型変更に伴う呼び出し側の追従漏れなし（利用箇所は `Settings.tsx` のみ） |
| 必須Embeddingモデルの実ダウンロード | `nomic-embed-text` をクリック → `POST /ollama/pull 200` → 進捗100% →「ダウンロードが完了しました」 |
| 無効化の範囲 | 540行中238行が無効（第1回は239行）。差分はちょうど例外1行 |
| Enterで改行 | `aaa` + Enter → 値が `"aaa\n"`、送信されない |
| Shift+Enterで送信 | 普通のチャット・プロジェクトチャットの両方で送信成功 |
| IME変換中のShift+Enter | `isComposing: true` のkeydownを実発火 → 送信されず、`preventDefault` もされない |
| 入力欄の最大高さ | `max-height: 355.6px`（=40vh）、`overflow-y: auto`。81行入力で高さ356pxのまま内部スクロール |
| 送信ボタンの位置 | 81行入力後も画面内（top 517 / bottom 557、viewport 889）。会話も表示されたまま |
| プレースホルダ | 「メッセージを入力...（Enterで改行、Shift+Enterで送信）」が1行に収まり見切れなし |
| カテゴリ絞り込み | すべて540 / Qwen76 / Kimi3 / GPT6 / Gemma22。第1回と同じ |
| 見出しの出し分け | プロジェクトチャットで「プロジェクトチャット履歴」 |
| 新規会話ボタンの位置 | ボタン top 443 / モデル選択 top 487、左端はどちらも596pxで一致 |
| **T9-1回帰**: 新規会話1通目のファイル操作（確認モード） | 提案通知とプレビューが残り、「適用する」で `note-r2.md`（34バイト）を作成。ファイルツリーにも反映 |
| ファイル書き込み範囲 | プロジェクトフォルダ内のみ |
| バックエンドログ | Traceback 0件 / 5xx 0件 |
| ブラウザコンソール | エラー0件 |
| `npm run build`（tsc含む） | 成功、エラー0 |
| `npm run lint` | error 0 / warning 1（`ui/button.tsx` の既存warning） |
| `npx prettier --check`（変更7ファイル） | All matched files use Prettier code style |
| `ruff check` / `black --check`（`backend/api/ollama.py`） | どちらもPASS |
| `git diff --check` | 問題なし |

`AGENTS.md` 7章の制約に触れる変更はない。バックエンドの変更は `AvailableModelsResponse` に既存の設定値を1つ足しただけで、新しい外部通信もファイル操作の経路変更も無い。

---

## マージ前に対応が必要なこと

なし。`develop` へマージしてよい。

軽微1（ツールチップが出ない・文言が違う）と軽微2（例外のスコープ）は、どちらも数行で直る。次に設定画面を触るときにまとめて入れるのが良さそう。

第1回の所見1（**ブランチにコミットが無い**。`feature/t10-ui-refinements` の HEAD は `develop` と同一で、変更はすべて未コミットの作業ツリー差分）は解消していない。マージの前にコミットが必要。
