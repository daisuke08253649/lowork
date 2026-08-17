# T7-2 レビュー結果

## 第1回レビュー（2026-08-17）— 敵対的検証

**判定: 承認**（軽微3件。いずれも機能をブロックしない）

`implementation_plan.md` T7-2 の必須要件3項目はすべて実装され、実測で動作を確認した。差分は2ファイル・約30行と小さく、確認/自走モードのゲート（`AGENTS.md` 7章）も維持されている。

### 検証環境

| 項目 | 内容 |
|---|---|
| バックエンド | `127.0.0.1:8000`（隔離DB `$SCRATCH/data/chat.db`・隔離Chroma。`backend/data/chat.db` は未使用） |
| フロントエンド | Vite `localhost:1420`（`backend/main.py` の `allow_origins` に合わせる） |
| Ollama | スクリプト化スタブ `127.0.0.1:11435`（実Ollamaは未使用） |
| 作業ディレクトリ | スクラッチ配下に `projA` / `projB` / `outside.txt`。検証後にプロジェクトは `DELETE /projects/{id}`（204×2）で削除済み |
| レビュー対象 | 作業ツリーの未コミット差分（`src/store/projectStore.ts`, `src/pages/ProjectChat.tsx`） |
| zustand | 5.0.14（`persist` は同梱ミドルウェア。新規依存の追加なし） |

---

### 必須要件の検証結果（すべて充足）

| 要件（implementation_plan.md T7-2） | 実測 |
|---|---|
| `projectStore` に実行モード（`confirm` \| `auto`）を追加 | ✅ `executionMode` / `setExecutionMode` を追加。初期値 `confirm` |
| モードを localStorage に保存（アプリ再起動後も維持） | ✅ トグル直後に `lowork-project-settings` = `{"state":{"executionMode":"auto"},"version":0}` が書かれ、リロード後も `自走モード` のまま復元 |
| トグルボタンと状態を連動 | ✅ ラベル・`variant`・`aria-pressed` の3つとも `executionMode` に追従。送信時の `mode` も連動（下記） |

送信リクエストの実測:

| 画面上のモード | `POST /project-chat` の body | 結果 |
|---|---|---|
| 自走モード | `"mode":"auto"` | モーダルなし・即時書き込み（`projA/auto1.md`, `projA/third.md`, `projB/fourth.md` をファイル実体で確認） |
| 確認モード | `"mode":"confirm"` | モーダル表示・キャンセルで `confirm1.md` は未作成（ゲート維持） |

**ハイドレーションは同期**であることを確認した。zustand 5.0.14 の `persist` は `toThenable`（`node_modules/zustand/esm/middleware.mjs:305`）でストレージが同期の場合そのまま同期実行するため、ストア生成時点で復元が完了する。実測でも `hasHydrated() === true` かつ初回描画から `自走モード` で、**起動直後に一瞬 `確認モード` が見える（フラッシュ）ことはない**。ファイル書き込みのゲート表示としてこれは重要な性質。

`src-tauri/tauri.conf.json` に `incognito` 等のストレージを揮発化する設定はないため、バンドル版（WKWebView）でも localStorage は永続する。ただし本検証はChrome上で行っており、**Tauriアプリの実再起動での確認は未実施**。

---

### セキュリティ・プライバシー検証

| ケース | 結果 |
|---|---|
| localStorageに保存される内容 | ✅ 検証中に観測した書き込みはすべて `{"state":{"executionMode":...},"version":0}` のみ。`partialize` により書き出しキーが `executionMode` に限定され、プロジェクト名・**フォルダパス**（ユーザーのローカルパス）は保存されない |
| 既存の `theme` キーとの衝突 | ✅ キー名が異なり相互に影響なし。普通のチャット画面も正常に描画 |
| 確認/自走ゲートの迂回（AGENTS.md 7章） | ✅ 迂回経路なし。送信中はトグルが `disabled` で、飛行中のクリックはモードを変えない（実測: `disabled:true`、クリック後もストアは `auto` のまま） |
| 外部通信の追加 | ✅ なし。差分にネットワーク呼び出しの追加は含まれない |

---

### 指摘事項

#### 軽微1: localStorageから復元した値を検証していない（`code_style.md` 15行目・`themeStore.ts` の前例からの逸脱）

`persist` の `partialize` は**書き込み側しか制限しない**。読み出し側は zustand の既定 `merge`（`{...currentState, ...persistedState}`）がそのまま展開するため、localStorageの内容は無検証でストアに入る。`code_style.md` 15行目は「実行時まで形が保証されない値は `unknown` で受けてスキーマ検証を通す」と定めており、`JSON.parse()` を経由するlocalStorageの値はこれに該当する。同じリポジトリ内の `themeStore.ts:11` は `localStorage.getItem("theme") === "dark" ? "dark" : "light"` と検証済みで、新しい実装だけがこの前例から外れている。

実測した挙動:

| localStorageの内容 | 実測結果 |
|---|---|
| `{"state":{"executionMode":"pwned"},"version":0}` | ストアは `"pwned"` を保持。**ボタンは「確認モード」と表示**（`=== "auto"` 判定のため見た目はフェイルセーフ）だが、送信body は `"mode":"pwned"`。バックエンドが 422（`Input should be 'confirm' or 'auto'`）を返し、画面には「Request failed with status code 422」とだけ出る。ユーザーは原因を知る手段がなく、トグルを1回押すまでチャットが送れない |
| `{"state":{"projects":[{...}],"setExecutionMode":null},"version":0}` | 偽のプロジェクトがストアに注入され、`setExecutionMode` が `null` で上書きされてトグルが `Uncaught TypeError: setExecutionMode is not a function` で機能停止 |
| `{not json at all`（壊れたJSON） | ✅ クラッシュせず既定の `confirm` で起動し、初回トグルで正常な値に自己修復する |

**重要な前提**: バックエンドの `mode: Literal["confirm", "auto"]`（`backend/api/chat.py:59`）が 422 で弾くため、**不正値が「自走モード扱い」に倒れることはない**。ファイル書き込みゲートは破れていないので重大度は軽微に留まる。ローカルアプリでありlocalStorageへの外部からの書き込み経路も現状はない。将来のスキーマ変更・手動編集・データ破損への保険という位置づけ。

修正案（`merge` を1つ足すだけで上記3ケースすべてに効く）:

```ts
function toExecutionMode(value: unknown): ExecutionMode | null {
  return value === "auto" || value === "confirm" ? value : null;
}

// persist options
merge: (persistedState, currentState) => ({
  ...currentState,
  executionMode:
    toExecutionMode((persistedState as { executionMode?: unknown } | undefined)?.executionMode)
    ?? currentState.executionMode,
}),
```

#### 軽微2: `"confirm" | "auto"` が名前付き型になっていない（7箇所に重複）

`src/store/projectStore.ts:8,13` / `src/hooks/useChat.ts:33,41` / `src/api/chat.ts:59,75` / `src/pages/ProjectChat.tsx:267` の7箇所で同じユニオンをインラインで書いている（うち2箇所が今回の追加）。`themeStore.ts:3` は `export type Theme = "light" | "dark";` と名前付きでエクスポートしており、そちらが本リポジトリの前例。軽微1の検証関数を書く際にも型名が必要になるため、`export type ExecutionMode = "confirm" | "auto";` を切って各所から参照する形にまとめるのが自然。単独では任意。

#### 軽微3: 「実行モードはアプリ全体で共有・永続」という設計判断が `design.md` に記録されていない（`AGENTS.md` 11章）

実装計画書は「localStorage に保存（アプリ再起動後も維持）」としか書いておらず、**モードのスコープ（プロジェクト単位かアプリ全体か）は design.md に記述がない**。今回の実装はアプリ全体で1つの値を共有する。実測での帰結:

- プロジェクトAで自走モードに切り替える → **プロジェクトBへ移動してもトグルは「自走モード」のまま**
- そのままBで送信すると、Bでは一度も自走モードを選んでいないのに `projB/fourth.md` が確認なしで書き込まれた（実測）

T7-1までは `useState` のローカル状態だったため、プロジェクトを切り替えるたびに `確認モード` に戻っていた。今回その安全側の挙動が意図的に外れる。実装計画書の要求（再起動後も維持）に沿っており仕様違反ではないが、**ファイル書き込みゲートのスコープが変わる決定**であり、`design.md` 8章「その他の設計決定事項」の表に1行追加しておくべき類の判断（`AGENTS.md` 11章）。

> 例: `| 実行モード（確認/自走）のスコープ | プロジェクト単位ではなくアプリ全体で共有し、localStorageに永続する |`

---

### 検証メモ（指摘ではない）

- **ダブルクリック**: `onClick` が `executionMode` をレンダー時のクロージャから読むため、同一タスク内で `.click()` を2回ディスパッチすると2回とも同じ値を読み、正味1回分しかトグルされない（実測: `auto` → `confirm` で止まる）。ただし**実ユーザーのダブルクリックはReactが離散イベントを同期フラッシュするため正しく2回反映される**（実測: `confirm` → `auto` → `confirm`）。実害はないためクロージャ読みのままで問題ない。T7-1 軽微1と同じ構図だが、あちらと違い非同期処理を挟まないので競合状態にはならない。
- 実行モードは全プロジェクトで共有されるため、`[projectId]` のリセットeffect（T7-1で追加）はモードをリセットしない。これは意図どおり。
- `persist` はストアの任意のstate更新のたびに `setItem` を呼ぶ（`setProjects` 等でも書き込みが走る）。書き込み量は数十バイトで実用上の問題なし。
- ProjectChat画面に直接URLで入るとプロジェクト一覧が未ロードで見出しが「プロジェクト」になる（`project?.name ?? "プロジェクト"`）。T7-2以前からの挙動で、本タスクの差分とは無関係。

---

### 静的チェック

| 項目 | 結果 |
|---|---|
| `npm run lint` | ✅ 0 error（既存の `src/components/ui/button.tsx` の warning 1件のみ） |
| `npm run build` | ✅ 成功 |
| `npx prettier --check`（変更2ファイル） | ✅ 整形済み |
| `git diff --check` | ✅ クリーン |

---

### マージ前に対応が必要なこと（運用）

**`feature/t7-mode-state` にコミットが1件もない。** `git log develop..feature/t7-mode-state` が空で、変更はすべて作業ツリーの未コミット状態にある（T6-1から通算10回連続）。`AGENTS.md` 3章の連携フローに従い、`T7-2: モード状態管理の仕上げ` の形式でコミットすること。

コミットさえ行えば、コード面ではマージして差し支えない。軽微1〜3はいずれも次のタスクと並行して対応してよい（軽微1と軽微2は同時に直すのが自然）。

---

### 次のタスク

`implementation_plan.md` の依存関係では Phase 7 はここで完了。次は **Phase 8: T8-1（PCスペック取得 + モデル一覧スクレイピング API）**（T0-3・T1-1完了後・他フェーズと並行可）。

---

## 第2回レビュー（2026-08-17）— 敵対的検証

**判定: 承認**（第1回の軽微3件は解消または部分対応。新規は任意2件）

第1回の指摘に対する修正を実測で確認したうえで、**修正そのものを攻撃**した。`merge` バリデータには21パターンの不正ペイロードを投入し、いずれも安全側に倒れることを確認した。

### 検証環境

| 項目 | 内容 |
|---|---|
| バックエンド | `127.0.0.1:8000`（隔離DB・隔離Chroma。`backend/data/chat.db` は未使用・タイムスタンプ変化なし） |
| フロントエンド | Vite `localhost:1420` |
| Ollama | スクリプト化スタブ `127.0.0.1:11435`（実Ollamaは未使用） |
| レビュー対象 | 作業ツリーの未コミット差分（`src/store/projectStore.ts`, `src/pages/ProjectChat.tsx`, `src/types/project.ts`, `docs/design.md`） |

---

### 第1回指摘への対応状況

| 指摘 | 対応 | 実測での確認 |
|---|---|---|
| 軽微1: localStorageの復元値が無検証 | ✅ 解消 | `merge` + `toExecutionMode` を追加。下表の21パターンすべてで安全側に倒れる |
| 軽微2: `"confirm" \| "auto"` の重複 | 🔺 部分対応 | `src/types/project.ts` に `ExecutionMode` を新設しstore側は採用。ただし5箇所はインラインのまま（後述） |
| 軽微3: モードのスコープが未記録 | ✅ 解消 | `design.md` 8章に「実行モード（確認 / 自走）のスコープ ｜ アプリ全体で共有し、localStorageに永続する」を追加。実挙動と記述が一致することを確認 |

#### 軽微1の修正への攻撃（21パターン）

ストアモジュールをクエリ付き `import()` で都度新規評価し、ハイドレーション結果を直接観測した。

| 投入したlocalStorageの内容 | 復元後の `executionMode` | 副作用 |
|---|---|---|
| `{"executionMode":"auto"}` / `"confirm"` | `auto` / `confirm` | 正常 |
| `"pwned"` / `"AUTO"` / `" auto"` / `1` / `null` / `{}` / `["auto"]` | すべて **`confirm`** | なし |
| `{"executionMode":"auto","projects":[…],"hasLoadedProjects":true}` | `auto` | **projects の注入は不成立**（`projects.length === 0`） |
| `{"executionMode":"auto","setExecutionMode":null,"setProjects":null}` | `auto` | **関数の上書きは不成立**（`typeof setExecutionMode === "function"`） |
| `{"executionMode":"auto","__proto__":{"polluted":true}}` | `auto` | **プロトタイプ汚染なし**（`({}).polluted === undefined`） |
| `state: null` / `state: "auto"` / `state` キーなし / `[1,2,3]` / `"hello"` / 空文字 / 壊れたJSON | すべて `confirm` | 例外ゼロ・アプリは正常起動 |
| `version: 7`（不一致） | `confirm` | zustandが `console.error` を1件出力（後述） |
| `version: "0"`（文字列） | `auto` | zustandの判定が `typeof === "number"` のためマイグレーション分岐を通らず採用。値自体は検証済みなので安全 |

**21パターンで例外はゼロ**、不正値はすべて**より制約の強い `confirm`（確認モード）**に倒れる。ファイル書き込みゲートを守る方向へフォールバックしており、フェイルセーフの向きが正しい。

E2Eでも確認した。`{"executionMode":"pwned"}` を仕込んでリロード → ボタンは「確認モード」、送信bodyは **`"mode":"confirm"`（200）**、プレビューモーダルが開く。第1回で発生した 422 と「Request failed with status code 422」の行き止まりは再現しない。

さらに、**不正エントリは次のstate更新で自動修復される**ことも確認した。`"pwned"` を残したままプロジェクト一覧を開くと `setProjects` の書き込みが走り、localStorage が `{"state":{"executionMode":"confirm"},"version":0}` に上書きされた。壊れた値が残り続けることはない。

#### 修正が壊していないことの確認

| ケース | 実測 |
|---|---|
| 正常系（`auto` を保存してリロード） | ✅ ボタン・`aria-pressed`・ストアとも `auto`、`hasHydrated() === true`、送信body `"mode":"auto"`、モーダルなしで `projA/n2.md` を即時作成 |
| 確認モードのゲート | ✅ `"mode":"confirm"` 送信 → モーダル表示 → キャンセルで `n1.md` は未作成、通知と「プレビューを開く」は残る（T7-1の挙動を維持） |
| 送信中のトグル | ✅ `disabled: true`。クリックも `Enter` キーもモードを変えない |
| プロジェクト横断（SPA遷移） | ✅ Aで自走モード → 一覧 → B と画面遷移してもトグルは「自走モード」のままで、Bで `projB/n3.md` が確認なしに作成された。design.md の新しい記述どおりの挙動 |
| ハイドレーション後の手動 `persist.rehydrate()` | ✅ projects（2件）と関数を保持したままモードだけ更新。`merge` が `...currentState` を土台にしているため、実行中の状態を巻き戻さない |
| コンソールエラー | ✅ version不一致で出る1件を除いてゼロ |

---

### 新規の指摘

#### 軽微A（任意）: `docs/design.md` 全体がPrettierで再整形され、差分が約200行に膨らんでいる

内容の追加は 8章の1行だけだが、テーブル区切り行の整列とコードフェンス前の空行追加でファイル全体が書き換わっている。**この整形はプロジェクトのツールが生成したものではない**——`package.json` の `format` / `format:check` の対象は `src/**/*.{ts,tsx}` と一部のルートファイルのみで、`docs/*.md` は含まれない（`.prettierignore` にも記載なし）。エディタのformat on saveによるものと思われる。

内容の欠落がないことは検証済み。空白・パイプ・区切り行を正規化して比較したところ、差分は**テーブル区切り行のみ＋追加された1行**で、本文の欠落・改変はなかった。

リポジトリ内でも `implementation_plan.md` / `code_review.md` / `code_style.md` は既にPrettier整形済み、`requirements.md` / `AGENTS.md` は未整形と混在しており、整形自体を禁じるルールはない。ただしT7-2の差分としては、レビュー時のノイズとマージコンフリクトの面を無駄に広げている。**ドキュメント整形は別コミットに分ける**のが望ましい。

#### 軽微B（任意）: `docs/reviews/T7-2_impl.md` がレビュー対応後に更新されていない

「変更ファイル」が `src/store/projectStore.ts` と `src/pages/ProjectChat.tsx` の2つのままで、実際に変更した `src/types/project.ts` と `docs/design.md` が載っていない。修正内容の記載もない。T7-1では impl.md に「レビュー指摘への対応（2026-08-16）」節を追記していたので、同じ形に揃えるべき。

#### 軽微2の残り（任意・第1回からの継続）

`ExecutionMode` 型は新設されたが、参照しているのは `src/store/projectStore.ts` だけで、`src/hooks/useChat.ts:33,41` / `src/api/chat.ts:59,75` / `src/pages/ProjectChat.tsx:267` の5箇所は `"confirm" | "auto"` のインラインのまま。型の恩恵が最も効くAPI境界が未適用なので、次に触るときに置き換えるとよい。

---

### 検証メモ（指摘ではない）

- `toExecutionMode` は使用箇所より後ろで宣言されているが、**関数宣言なので巻き上げられ**、モジュール評価時（＝ストア生成＝ハイドレーション）に呼ばれても正しく動く。実測で確認済み。将来 `const toExecutionMode = (v) => …` に書き換えるとTDZエラーでハイドレーションが壊れるので注意。
- `version` 不一致時、zustandは `State loaded from storage couldn't be migrated since no migrate function was provided` を `console.error` に出し、保存値を捨てて既定値に戻す（実測）。現状 `version` は 0 固定なので発生しないが、将来スキーマを変えるなら `migrate` の追加が必要。
- 不正値からのフォールバックは、ユーザーが保存した「自走モード」を黙って「確認モード」に戻す方向に働く。通知は出ないが、危険側ではなく安全側に倒れる挙動なのでMVPではこれでよい。
- Tauri実アプリの再起動でのlocalStorage永続は今回も未検証（Chrome上でのリロード・新規ロードで確認）。`src-tauri/tauri.conf.json` に揮発化設定がないことは第1回で確認済み。

---

### 静的チェック

| 項目 | 結果 |
|---|---|
| `npm run lint` | ✅ 0 error（既存warning 1件のみ） |
| `npm run build`（`tsc && vite build`） | ✅ 成功。`merge` の型付けも通る |
| `npm run format:check` | ✅ すべて整形済み |
| `git diff --check` | ✅ クリーン |

---

### マージ前に対応が必要なこと（運用）

**`feature/t7-mode-state` にコミットが1件もない状態が続いている。** `git log develop..feature/t7-mode-state` は空のままで、4ファイルすべてが未コミットの作業ツリーにある（T6-1から通算11回連続）。`T7-2: モード状態管理の仕上げ` の形式でコミットすること。軽微Aを踏まえるなら、`docs/design.md` の整形分を別コミットに分けると差分が読みやすくなる。

コミットさえ行えば、コード面ではマージして差し支えない。軽微A・B と軽微2の残りはいずれも任意で、次のタスクと並行して対応してよい。
