# T1-1 レビュー結果

- 対象タスク: T1-1 共通レイアウト（左サイドバー）の実装
- 対象ブランチ: `feature/t1-layout`（作業ツリーの未コミット差分を `develop` と比較）
- レビュー日: 2026-07-26
- **承認可否: 要修正** → 再レビューで **承認**（末尾「再レビュー」セクション参照）

---

## サマリー

レイアウト・ルーティング・テーマ基盤はおおむね設計通りに実装されており、`AGENTS.md` 7章「アーキテクチャ上、常に守るべき制約」への抵触、外部通信の混入、`any` の使用はいずれもなし。`npm run build`（`tsc && vite build`）がレビュー時に再実行して成功することも確認済み。

ただし **テーマ切り替えUIの配置が `design.md` の仕様と食い違っている** ため、要修正とする。修正量は小さい。

---

## 指摘事項

### 【必須】1. テーマ切り替えボタンをサイドバーに置いているのは `design.md` からの逸脱

- 該当: `src/components/layout/Sidebar.tsx:55-64`, `src/App.tsx`（`theme` / `onThemeChange`）
- `design.md` 7章に「テーマ: ライト / ダーク切り替え対応。**設定画面のトグルで切り替え**」と明記されている。また同6章「共通左サイドバー（全画面）」のレイアウト図は `[新しいチャット][プロジェクト][設定]` + チャット履歴の構成で、テーマトグルは含まれない。設定画面のレイアウト図側に「テーマ [ライト / ダーク]」の行がある。
- `implementation_plan.md` の T1-1 の作業内容も「ダーク/ライトテーマ切り替えの**基盤**（CSS変数 + Tailwind dark mode）」であり、トグルUIの設置は T8-2「設定画面の実装」のスコープ。
- 影響: このままだと T8-2 で設定画面にトグルを実装したときに、同じ機能のUIが2箇所に存在することになる。
- 対応: サイドバー下部のテーマ切り替えボタンを削除する。切り替え機構（`dark` クラス付与 + localStorage 永続化）自体は T1-1 のスコープ内なので残してよい。

### 【必須】2. テーマ状態が `App.tsx` のローカル state に閉じており、T8-2 から触れない

- 該当: `src/App.tsx:19-27`
- 指摘1の対応でトグルを設定画面に移すと、`Settings.tsx` から同じ状態を読み書きする必要がある。`design.md` 2章のディレクトリ構成ではグローバル状態は `src/store/`（Zustand）で管理する方針で、`zustand` は既に依存に入っている（`src/store/` は空のまま）。
- 対応: テーマ状態を `src/store/` の Zustand ストア（例: `themeStore.ts`）か `src/hooks/useTheme.ts` に切り出し、`dark` クラス付与と localStorage 保存もそこに集約する。`App.tsx` は初期化のみ担当する形が素直。
- 補足: `AGENTS.md` 4章の「過剰な抽象化を避ける」方針は理解しているが、これは2画面から参照される状態であり、切り出しは過剰投資には当たらないと判断した。

### 【推奨】3. `App.css` から shadcn/ui 生成のトークンを削除しているのはスコープ外の変更

- 該当: `src/App.css`
- 削除されているトークン: `--chart-1`〜`--chart-5`、`@theme inline` 内の `--color-chart-*`、`--font-heading`、`--radius-2xl` / `--radius-3xl` / `--radius-4xl`
- 現時点で `src/` 内からの参照はゼロ（grep で確認）なのでビルドは通るが、今後 shadcn MCP で `base-nova` スタイルのコンポーネント（T7-1 の `DiffPreview` で使う Dialog、`ProjectCard` で使う Card など）を追加した際に、これらのトークンを参照していると見た目が崩れる。shadcn の init が生成したトークンはそのまま残すのが安全。
- 一方で、Tauriテンプレート由来の不要CSS（`.logo` / `.container` / 生の `button`・`input` スタイル / `prefers-color-scheme` ブロックなど）の削除は妥当かつ必要な整理。ここは問題なし。
- `@custom-variant dark (&:is(.dark *))` → `(&:where(.dark, .dark *))` の変更も、Tailwind CSS v4 の推奨形かつ `.dark` 要素自身にも当たるようになる改善で、問題なし。

### 【推奨】4. ダークテーマ選択時に初回描画でライトテーマがちらつく（FOUC）

- 該当: `src/App.tsx:23-26`
- `dark` クラスの付与が `useEffect` 内のみなので、localStorage に `dark` が保存されている場合、初回ペイントはライトテーマで描画されてから切り替わる。
- 対応案: `index.html` に localStorage を読んで `documentElement.classList.add('dark')` するインラインスクリプトを置く、または `getInitialTheme()` をモジュールスコープで評価してその場でクラスを付与する。

### 【推奨】5. `min-h-screen` の二重指定 — T2 以降のスクロール設計で破綻しやすい

- 該当: `src/App.tsx`（ルート `flex min-h-screen`）、`src/pages/NormalChat.tsx:5` / `ProjectList.tsx:5` / `Settings.tsx:5`（各 `min-h-screen`）
- 現状のプレースホルダーでは問題ないが、T2-3 でメッセージ一覧の内部スクロールを実装するとき、この構成だとページ全体がスクロールしてサイドバーごと流れてしまう形になりやすい。
- 対応案: ルートを `h-screen overflow-hidden`、`MainPanel` を `flex-1 overflow-y-auto`、各ページを `h-full` にしておくと T2 以降が楽になる。今のうちに直しておくことを勧める。

### 【参考】6. `BrowserRouter` は本番バンドル時に注意が必要

- 該当: `src/main.tsx`
- MVP完成条件は `npm run tauri dev`（devUrl = `http://localhost:1420`）なので現時点で実害はなく、修正不要。
- 将来 `tauri build` でバンドル配布する場合、カスタムプロトコル配信下では `BrowserRouter` のリロード・ディープリンクが index.html にフォールバックせず動かないことがある。その時点で `HashRouter` / `MemoryRouter` への切り替えを検討する。

---

## T1-1 のスコープ外だが気になった点（今回の修正対象ではない）

- **ESLint / Prettier 未導入**: `code_style.md` に「ESLint + Prettier を導入する」「`@typescript-eslint/no-explicit-any` を有効化し、この項目のみコミット・マージをブロックする」とあるが、リポジトリに設定ファイルが存在しない（T0-2 の積み残しと思われる）。T1-1 の差分に `any` はないため今回の判定には影響しないが、どこかのタイミングで導入が必要。
- **Tauri サイドカー未設定**: `src-tauri/tauri.conf.json` に `externalBin` の記述がなく、`src-tauri/src/` にもサイドカー起動処理が見当たらない（T0-4 が未完の可能性）。T1-1 の依存は T0-2 のみなので着手順としては問題ないが、T1-2（Ollama 接続確認 API + UI）で FastAPI との疎通が必要になるため、その前に確認しておくこと。

---

## レビュー観点別の所見

| 観点 | 結果 |
|---|---|
| `design.md` のディレクトリ構成との一致 | OK（`src/components/layout/`, `src/pages/` とも設計書通り。ファイル名も一致） |
| `design.md` の画面仕様との一致 | **NG**（テーマトグルの配置。指摘1） |
| `design.md` の API 定義・データ設計 | 該当なし（この差分にAPI通信はない） |
| `AGENTS.md` 7章: `invoke()` 不使用 | OK（`App.tsx` から `@tauri-apps/api/core` の import が削除され、ルーティングはフロント内で完結） |
| `AGENTS.md` 7章: Rust側にロジックを書かない | OK（`src-tauri/` に変更なし） |
| `AGENTS.md` 7章: Ollama 以外への外部通信禁止 | OK（追加依存は `react-router` のみ。分析ツール等の混入なし。フォントは `@fontsource` でローカルバンドル済み） |
| `AGENTS.md` 7章: パストラバーサル対策 | 該当なし（ファイル操作なし） |
| `AGENTS.md` 7章: 確認/自走モードのゲート | 該当なし |
| `AGENTS.md` 10章: 禁止コマンド・操作 | 抵触なし（DB直接操作・`rm -rf`・`sudo`・`main` への直接コミット等いずれもなし） |
| `code_style.md`: `any` 禁止 | OK（`Theme` union 型で明示。`any` / 不用意な `unknown` なし） |
| `code_style.md`: 関数コンポーネント + Hooks のみ | OK |
| `code_style.md`: ファイル命名（PascalCase.tsx） | OK |
| `code_style.md`: Tailwind + shadcn/ui のみ、個別CSSファイルを作らない | OK（`App.css` は Tailwind のエントリポイントで新規作成ではない。ページ固有CSSの追加なし） |
| `code_style.md`: 制御構文のネスト2階層まで | OK（`navigationItems.map` の1階層のみ） |
| `requirements.md`: エラーハンドリング要件 | 該当なし（Ollama 未起動時の警告バナーは T1-2 のスコープ） |
| `implementation_plan.md`: タスク粒度・依存関係 | 依存（T0-2）は満たしている。粒度は指摘1・3の分だけ T1-1 の範囲を超えている |

## 良かった点

- `aria-label` / `aria-labelledby` / `aria-hidden` を適切に付与しており、アクセシビリティへの配慮がある
- `location.pathname` による現在地のハイライト（`variant="secondary"`）が実装されており、ナビゲーションとして必要な状態表現ができている
- 未知ルートの `<Route path="*" element={<Navigate to="/" replace />} />` によるフォールバックが入っている
- Tauriテンプレート由来の不要CSS・不要コンポーネントの掃除が丁寧
- `MainPanel` が `children` を受けるだけの薄いラッパーに留まっており、過剰な抽象化がない

---

## 修正依頼まとめ（Codex向け）

1. **[必須]** `Sidebar.tsx` からテーマ切り替えボタンを削除する（トグルUIは T8-2 の設定画面に置く）
2. **[必須]** テーマ状態（`dark` クラス付与 + localStorage 永続化）を `src/store/themeStore.ts`（Zustand）または `src/hooks/useTheme.ts` に切り出し、`App.tsx` からローカル state を除去する
3. **[推奨]** `App.css` から削除した shadcn 生成トークン（`--chart-1`〜`--chart-5` とその `@theme inline` 定義、`--font-heading`、`--radius-2xl/3xl/4xl`）を復元する
4. **[推奨]** ダークテーマ時の初回描画ちらつきを解消する（初期描画前に `dark` クラスを付与）
5. **[推奨]** ルートを `h-screen overflow-hidden`、`MainPanel` を `flex-1 overflow-y-auto`、各ページを `h-full` に変更し、T2 以降の内部スクロール実装に備える

修正後、`docs/reviews/T1-1_impl.md` に対応内容を追記のうえ、再レビューを依頼してください。

---
---

# 再レビュー（2026-07-26）

- 対象: `feature/t1-layout` 作業ツリー（未コミット差分）を `develop` と比較
- **承認可否: 承認**

## 指摘事項への対応確認

| # | 指摘 | 対応 | 確認 |
|---|---|---|---|
| 1 | サイドバーのテーマ切り替えボタンを削除 | `Sidebar.tsx` からトグルボタンと `Moon`/`Sun` の import を削除。`SidebarProps` も撤廃し props なしコンポーネントに | ✅ |
| 2 | テーマ状態を store に切り出し | `src/store/themeStore.ts` を新規作成。Zustand で `theme` / `setTheme` を保持し、`dark` クラス付与と localStorage 保存を `applyTheme()` に集約。`App.tsx` のローカル state は除去 | ✅ |
| 3 | shadcn 生成トークンの復元 | `--chart-1`〜`--chart-5`（`:root` / `.dark` 両方）、`@theme inline` の `--color-chart-*`、`--font-heading`、`--radius-2xl/3xl/4xl` をすべて復元 | ✅ |
| 4 | ダークテーマ初回描画のちらつき解消 | `index.html` の `<head>` に localStorage を読んで `dark` クラスを付与するインラインスクリプトを追加。初回ペイント前に適用される | ✅ |
| 5 | スクロール構成の見直し | ルートを `flex h-screen overflow-hidden`、`MainPanel` を `flex-1 overflow-y-auto`、各ページを `min-h-full` に変更 | ✅ |

必須2件・推奨3件ともに、指摘の意図どおりに対応されている。

## 追加確認

- `npm run build`（`tsc && vite build`）をレビュー時に再実行して成功を確認（1884 modules transformed）
- `src/` 内に `any` の使用なし
- `AGENTS.md` 7章の制約への抵触なし（`invoke()` 不使用、`src-tauri/` に変更なし、追加の外部通信なし、ファイル操作なし）
- `AGENTS.md` 10章の禁止コマンド・操作への抵触なし
- `design.md` 2章のディレクトリ構成に準拠（`src/store/themeStore.ts` は設計書の `src/store/` 配下）
- `index.html` の `lang="ja"` 化・`<title>` の `lowork` への変更は、指摘外だが妥当な修正

## 今回の修正で新たに気付いた点（いずれも承認を妨げない）

### 【推奨・T3-2で対応でも可】サイドバーのチャット履歴エリアに `overflow-y-auto` がない

- 該当: `src/components/layout/Sidebar.tsx:39`
- ルートが `h-screen overflow-hidden` になったことで、T3-2 で履歴一覧に実データが入ったとき、画面高を超えた分が**スクロールできずに切れる**。修正前の `min-h-screen` 構成ではページ全体が伸びていたため顕在化しなかった副作用。
- 対応: `<section className="min-h-0 flex-1 px-3 py-4">` に `overflow-y-auto` を追加する（1語）。今入れておくと T3-2 で悩まずに済む。

### 【参考】`App.tsx` の `import "@/store/themeStore";` は副作用専用インポート

- 該当: `src/App.tsx:8`
- テーマ初期化（モジュールスコープの `applyTheme(initialTheme)`）を走らせるためだけのインポートで、エディタの「未使用インポートの削除」や将来のリファクタで無言で消えて初期化が飛ぶ可能性がある。
- ただし初回描画前の適用は `index.html` のインラインスクリプトが担っており、T8-2 で `Settings.tsx` が `useThemeStore()` を使えばモジュールは自然に読み込まれるため、実害はほぼない。
- 対応案（任意）: `themeStore.ts` から `initTheme()` を明示的に export して `main.tsx` から呼ぶ、あるいはこのインポート自体を削除する。今回は現状のままでよい。

### 【参考】`docs/reviews/T1-1_impl.md` の「変更ファイル」一覧が未更新

- 今回追加・変更された `index.html` と `src/store/themeStore.ts` が一覧に載っていない（対応内容の本文には記載あり）。次回以降、修正時は一覧側も更新しておくとレビュー時の突き合わせが楽になる。

## 前回から引き続き残っている、T1-1 スコープ外の宿題

1. **ESLint / Prettier 未導入**（`code_style.md` の「ESLint + Prettier を導入する」「`no-explicit-any` を有効化」が未実施）。T1-1 の差分に `any` はないため承認には影響しない。
2. **Tauri サイドカー未設定**（`tauri.conf.json` に `externalBin` なし、`src-tauri/src/` に起動処理なし）。T1-2 で FastAPI 疎通が必要になるため、着手前に T0-4 の完了確認を。
3. **`BrowserRouter` の本番バンドル時の挙動**。MVP完成条件は `npm run tauri dev` なので現時点で実害なし。`tauri build` での配布を検討する段階で `HashRouter` / `MemoryRouter` への切り替えを再検討する。

## 結論

**承認**。`AGENTS.md` 3章の連携フローに従い、`feature/t1-layout` を `develop` にマージしてよい。上記「今回の修正で新たに気付いた点」はいずれも任意対応で、マージのブロッカーではない。

