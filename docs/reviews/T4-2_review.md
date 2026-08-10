# T4-2 レビュー結果

対象: T4-2 プロジェクト一覧画面 + フォルダ選択
ブランチ: `feature/t4-project-ui`（`develop` = `71c8dab` との差分 + 未追跡ファイル `src/api/projects.ts`, `src/hooks/useProject.ts`, `src/store/projectStore.ts`, `src/types/project.ts`, `src/components/project/ProjectCard.tsx`, `src/components/ui/card.tsx`, `src/pages/ProjectChat.tsx`）
レビュー日: 2026-08-10

## 判定

**要修正**

主要な導線（一覧表示・カード選択→遷移・削除確認モーダル・削除実行）はいずれも実機で期待どおり動作しました。`design.md` のディレクトリ構成・API定義との整合、`AGENTS.md` 7章のアーキテクチャ制約（axios直通信、Ollama以外への通信なし、Rust側にロジックを置かない）にも逸脱はありません。

指摘の中心は**API呼び出しが失敗したときの一覧の状態**です。削除が失敗するとモーダルが開いたまま残り、さらに一覧が二度と再取得されないため、**バックエンドに存在しないプロジェクトのカードがアプリ再起動まで表示され続ける**状態を実測で再現しました。

---

## 検証環境

- バックエンド: `DATABASE_URL` をスクラッチパッドの一時DBへ向けて `uvicorn backend.main:app --port 8000` を起動（`backend/data/chat.db` には一切触れていません）
- フロントエンド: `npm run dev`（`http://localhost:1420`）を Chrome で操作
- 検証用プロジェクトは3件作成し、レビュー終了時にすべて `DELETE /projects/{id}` 経由で削除済み（最終 `GET /projects` = `[]`）

> Tauri のネイティブフォルダ選択ダイアログ（`@tauri-apps/plugin-dialog` の `open()`）は、ブラウザ実行では発火しないため**本レビューでは未検証**です。`T4-2_impl.md` の実機確認手順1〜2は開発者側で確認してください。ダイアログ以外の経路（一覧・選択・削除・エラー表示）はすべて実測しています。

---

## 指摘事項

### 中1: 削除に失敗するとモーダルが閉じず、存在しないプロジェクトが一覧に残り続ける

**該当箇所**: `src/pages/ProjectList.tsx:58-75` / `src/hooks/useProject.ts:17-30`

原因は2か所の組み合わせです。

**(a) 失敗時にモーダルを閉じず、一覧も再取得しない** — `handleDelete` は `removeProject()` の成功後に `setProjectToDelete(null)` する構造のため、失敗するとモーダルが開いたまま残ります。

```tsx
try {
  await removeProject(projectToDelete.id);
  setProjectToDelete(null);        // ← 失敗するとここに到達しない
} catch (deleteError) {
  setError(...);                   // ← エラーはモーダルの「背後」に描画される
}
```

エラー用の `<Alert>` はページ本文（`ProjectList` の `<div>` 内）にあるため、`AlertDialog.Backdrop`（`bg-black/50`）の下に隠れます。モーダル内には失敗を示す表示が一切なく、ユーザーから見ると「削除するを押しても何も起きない」状態になります。

**(b) 一覧が初回以降まったく再取得されない** — `loadProjects()` は `hasLoadedProjects` が立っていると即 return します。

```ts
if (store.isProjectsLoading || (store.hasLoadedProjects && !force)) {
  return;
}
```

`ProjectList` のマウント時 effect は `force` なしで呼ぶため、**画面を離れて戻ってきても再取得は走りません**。(a) で一覧が古いまま残ると、それを直す手段がなくなります。

**実測（バックエンドを別経路で先に削除して404を発生させたケース）**

| 手順 | 結果 |
|---|---|
| UIで「even-deeper-folder-name-here」の削除を確定 | モーダルは**開いたまま**。背後に「プロジェクトが見つかりません」 |
| キャンセルでモーダルを閉じる | カードは3件のまま（バックエンドは2件） |
| 「新しいチャット」→「プロジェクト」で画面を離れて戻る | エラー表示は消えるが、**カードは3件のまま** |
| `GET /projects` | `bc9f71d9…（日本語フォルダ）`, `42fe69b1…（notes）` の**2件のみ** |

残った幽霊カードはクリックでき、`/projects/{存在しないID}` へ遷移してしまいます。再度「削除」を押しても永久に404で、**アプリを再起動するまで消えません**。

実運用で404が出る場面は限られますが、**バックエンド（サイドカー）が落ちている・再起動中**のケースは同じ経路を通ります（`removeProject` が `ERR_NETWORK` で throw → 同じ状態）。`requirements.md` の「エラー時はUI上にわかりやすいエラーを表示する」も、モーダル背後に隠れる以上は満たせていません。

**対応（いずれか、または両方）**:
- `handleDelete` の `catch` でもモーダルを閉じる（`setProjectToDelete(null)` を `finally` に移す）か、エラーをモーダル内に表示する
- 失敗時にも `loadProjects(true)` で一覧をサーバーの状態に合わせ直す。あわせて `ProjectList` のマウント時取得を `loadProjects(true)` にするか、削除失敗時に `hasLoadedProjects` を落として次回マウントで再取得されるようにする

---

### 軽微1: 一覧の取得に失敗したときに「プロジェクトはまだありません」が同時に出る

**該当箇所**: `src/pages/ProjectList.tsx:106-119`

空状態の条件が `!isProjectsLoading && projects.length === 0` だけなので、**取得失敗（`projects` が空のまま）でも空状態カードが出ます**。

**実測（バックエンド停止中に `/projects` を開いた画面）**

```
⚠ プロジェクト一覧の取得に失敗しました
┌────────────────────────────────┐
│  プロジェクトはまだありません                  │
│  「新規」からプロジェクトフォルダを選択してください。   │
└────────────────────────────────┘
```

実際には2件登録されている状態でこの表示が出ました。エラーと「まだありません」が並ぶのは矛盾しており、ユーザーがプロジェクトを作り直そうとすると今度は409（重複）に当たります。

**対応**: 空状態の条件に `!error`（または「取得に成功したこと」を表すフラグ）を追加してください。

---

### 軽微2: `CardContent` に意味のない `sr-only` テキストが入っている

**該当箇所**: `src/components/project/ProjectCard.tsx:43`

```tsx
<CardContent className="sr-only">プロジェクトフォルダ</CardContent>
```

見出しでもラベルでもない固定文字列で、`aria-label` や `aria-describedby` から参照されてもいません。アクセシビリティツリーを読むと、カードごとに宙に浮いたテキストとして現れます。

```
button "notesを開く"
 generic "notes"
 generic "/private/tmp/claude-501/-Users-daisuke-…"
generic "プロジェクトフォルダ"     ← これ
button "notesを削除"
```

スクリーンリーダー利用者には、カードごとに「プロジェクトフォルダ」という無意味な読み上げが1回ずつ挟まります。カード名とパスは `aria-label` とテキストで十分伝わっているので、この要素は削除してください。レイアウト目的で `CardContent` が必要なら、テキストを空にするのではなくスタイルで調整してください。

---

### 軽微3: フォルダパスが先頭側だけ表示され、プロジェクトを見分けられない

**該当箇所**: `src/components/project/ProjectCard.tsx:38-40`

`truncate` は末尾を省略するため、パスが長いカードは**どれも同じ文字列に見えます**。

**実測（3件とも別フォルダ）**

```
日本語フォルダ                       even-deeper-folder-name-here      notes
/private/tmp/claude-501/-Users-…    /private/tmp/claude-501/-Users-…  /private/tmp/claude-501/-Users-…
```

プロジェクト名はフォルダのベース名から自動生成される（`useProject.ts:11-15`）ので、**同名のフォルダを別階層から2つ登録すると、名前もパスも見た目が完全に一致します**。`title` 属性でホバー時にフルパスは出ますが、一覧性としては弱いです。

`design.md` は「プロジェクト名・パス表示」としか書いていないため仕様違反ではありませんが、末尾側を残す（`direction: rtl` を使う、ホームディレクトリを `~` に短縮する、末尾2〜3階層だけ表示するなど）方が実用的です。

---

### 軽微4: 確認モーダルが `components/ui/` のコンポーネントになっていない

**該当箇所**: `src/pages/ProjectList.tsx:135-172`

`@base-ui/react/alert-dialog` のプリミティブを、`ProjectList.tsx` の中で直接組み立てて Tailwind クラスを直書きしています（`bg-black/50`, `rounded-xl bg-card p-6 … ring-1 ring-foreground/10`）。既存の `alert.tsx` / `button.tsx` / `card.tsx` / `select.tsx` / `textarea.tsx` はすべて `src/components/ui/` に置かれた shadcn/ui コンポーネントなので、この1つだけ方針が違います。

`AGENTS.md` 6章「フロントエンドのUI実装ではshadcn MCPを優先的に使い、手書きでのコンポーネント自作は最小限にする」に沿っていません。確認ダイアログは **T6-2/T6-3 の「確認モード」（ファイル書き込み前のゲート）でも必要になる**ので、ここで `src/components/ui/alert-dialog.tsx` として切り出しておく方が後のタスクが楽になります。

**対応**: shadcn MCP から alert-dialog（または dialog）を `src/components/ui/` に追加し、`ProjectList.tsx` はそれを使う形にしてください。

---

### 軽微5: `T4-2_impl.md` の「`npm run format:check` 成功」が事実と違う

**該当箇所**: `docs/reviews/T4-2_impl.md:54`

現在のブランチで実行すると失敗します。

```
$ npm run format:check
[warn] src/api/chat.ts
[warn] src/components/layout/Sidebar.tsx
[warn] Code style issues found in 2 files.
```

**ただし、これはT4-2が持ち込んだものではありません。** `develop` 時点のファイルを取り出して単体でチェックしても同じ2ファイルが warn になります。T4-2 で追加・変更されたファイル（`src/api/projects.ts`, `src/hooks/useProject.ts`, `src/store/projectStore.ts`, `src/types/project.ts`, `src/components/project/ProjectCard.tsx`, `src/components/ui/card.tsx`, `src/pages/ProjectChat.tsx`, `src/pages/ProjectList.tsx`, `src/App.tsx`）だけを対象にすると全件パスします。

`Sidebar.tsx` の指摘3件も、T4-2 の差分（`isNavigationItemActive` の追加）ではなく T3-2 由来の既存行です。**T3-2 のレビュー時に見落としていた `develop` の負債**なので、T4-2 の責任ではありません。

**対応**: このタスクのついでに `npm run format` を通して2ファイルを整形し、`T4-2_impl.md` の動作確認欄を実態に合わせてください（`format:check` は現状 develop 側の問題で落ちる、と書くのでも可）。

---

## 任意（対応しなくてもマージ可）

1. **`/projects/{id}` を直接開くとプロジェクト名が出ない** — `ProjectChat` は `projectStore.projects` から名前を引きますが、ストアを埋めるのは `ProjectList` のマウント時 effect だけです。ウィンドウをリロードして `/projects/{id}` に着地すると、`projects` が空なのでフォールバックの「プロジェクト」が表示されました（実測）。`activeProjectId` も同様に未設定になります。今は案内画面なので実害はありませんが、**T6-3 でプロジェクトチャットを実装するときは `folder_path` が必要**になるので、`ProjectChat` 側でも `loadProjects()` を呼ぶか、`GET /projects/{id}` 相当で単体取得できるようにしておくと安全です。

2. **一覧取得の失敗メッセージが固定文字列** — `ProjectList.tsx:32` は `getProjectErrorMessage` を通さず「プロジェクト一覧の取得に失敗しました」を固定で出します。作成・削除は `getProjectErrorMessage` 経由なのでバックエンド停止時に「サーバーに接続できません」と出るのに、一覧取得だけ原因がわからない表示になります。揃えると原因の切り分けがしやすくなります。

3. **`ProjectList.tsx` のimport順** — `@/api/projects`（10行目）が `@/components/...` の後ろにあり、他ファイルのアルファベット順と揃っていません。

4. **ブランチにコミットが1つもない** — `feature/t4-project-ui` の先端は `develop` と同じ `71c8dab` で、変更はすべて未コミットの作業ツリーにあります。`AGENTS.md` 3章のフロー（タスクごとにコミット、メッセージは `T4-2: …`）に沿ってコミットしてからマージしてください。

---

## レビュー観点ごとの所見

### `design.md` との整合

| 項目 | 結果 |
|---|---|
| ディレクトリ構成（`components/project/`, `pages/ProjectList.tsx`, `pages/ProjectChat.tsx`, `hooks/useProject.ts`, `store/projectStore.ts`, `api/projects.ts`） | ✅ すべて設計書どおりの配置 |
| `GET /projects` / `POST /projects` / `DELETE /projects/{id}` の利用 | ✅ T4-1 の契約どおり（`name` / `folder_path` のスネークケース送信、`detail` の表示） |
| 画面遷移「プロジェクト一覧 → プロジェクト選択 → プロジェクトチャット画面」 | ✅ カードクリックで `/projects/{id}` へ遷移することを実測 |
| 共通左サイドバー（全画面共通、3ボタン＋履歴） | ✅ プロジェクトチャット画面でも維持。ナビの選択状態も `/projects/{id}` で「プロジェクト」が点灯（実測） |
| 右サイドバーのファイルツリー・index進捗 | 対象外（T5-2） |

### `AGENTS.md` 7章（アーキテクチャ制約）

| 制約 | 結果 |
|---|---|
| React → FastAPI は axios の直接HTTP通信、`invoke()` を使わない | ✅ `src/api/projects.ts` は `apiClient`（axios）のみ。`invoke` の直接使用なし |
| Tauri はウィンドウ管理とサイドカー起動のみ、Rustにロジックを置かない | ✅ `src-tauri/src/lib.rs` の差分は `tauri_plugin_dialog::init()` の1行のみ |
| Ollama以外の外部通信を追加しない | ✅ 新規の通信先は `VITE_API_BASE_URL`（ローカルFastAPI）のみ |
| パストラバーサル対策 | 対象外（T4-1でバックエンド側が絶対パス検証・正規化済み。フロントは選択されたパスをそのまま送るだけ） |
| 確認モード/自走モードのゲート | 対象外（T6以降） |

Tauri の権限追加（`capabilities/default.json` の `dialog:default`）も、フォルダ選択に必要な最小の追加で、`fs:*` のような広い権限は含まれていません。

### `code_style.md`

| 項目 | 結果 |
|---|---|
| `any` の禁止 / 外部由来の値は `unknown` + Zod | ✅ `apiClient.get<unknown>` で受けて `projectSchema` で検証。`any` なし |
| 関数コンポーネント + Hooks のみ | ✅ |
| ファイル名規約（コンポーネント `PascalCase.tsx`、hooks/util `camelCase.ts`） | ✅ |
| 個別CSSファイルを作らない | ✅ Tailwind + shadcn/ui のみ |
| 制御構文のネスト2階層まで | ✅ 最大1階層 |
| ESLint | ✅ `npm run lint` はエラー0（既存の `button.tsx` の Fast Refresh 警告1件のみ） |
| Prettier | ⚠️ 軽微5のとおり。T4-2 の追加・変更ファイルは全件パス |

### レスポンス検証

`created_at` のスキーマ `z.string().datetime()` が、T4-1 のバックエンドが実際に返す形式を受け付けるか確認しました。

| 値 | 結果 |
|---|---|
| `2026-08-10T11:12:22.749464Z`（実際のレスポンス） | OK |
| `2026-08-10T11:12:22Z` | OK |
| `2026-08-10T11:12:22+00:00` | FAIL |
| `2026-08-10T11:12:22`（オフセットなし） | FAIL |

T4-1 で `as_utc_datetime` により必ず `Z` 付きになるので現状は問題ありません。ただし**バックエンドがオフセット表記に変わると一覧全体がパースエラーで落ちる**依存関係があります（T4-1 レビューで `Z` 形式を回帰確認済みなので、当面は維持されます）。

### 動作確認サマリー（実測）

| シナリオ | 結果 |
|---|---|
| 一覧表示（3件、日本語名・長いパス・通常パス） | ✅ カードが3列グリッドで表示。名前・パスともに正しい |
| カードクリック → `/projects/{id}` へ遷移 | ✅ 遷移し、プロジェクト名が案内画面に表示される |
| 遷移後のサイドバー選択状態 | ✅ 「プロジェクト」が選択されたまま |
| 削除確認モーダルの表示 | ✅ プロジェクト名入りの確認文が出る |
| モーダルをEscで閉じる | ✅ 閉じ、フォーカスが削除ボタンへ戻る |
| モーダルをキャンセルで閉じる | ✅ 削除されない |
| 削除実行（正常系） | ✅ モーダルが閉じ、カードが消える。`GET /projects` とも一致 |
| 削除実行（404） | ❌ 中1のとおり |
| 一覧取得の失敗（バックエンド停止） | ⚠️ 軽微1のとおり（エラー表示自体は出る） |
| ネイティブフォルダ選択 → 作成 | 未検証（ブラウザ実行のため。開発者確認をお願いします） |
| 同一フォルダの重複登録（409） | 間接確認のみ。404時にバックエンドの `detail` がそのまま表示されたので、`getProjectErrorMessage` の `detail` 抽出は動作しています |
| `npm run build`（`tsc && vite build`） | ✅ 成功 |

### `AGENTS.md` 10章（禁止コマンド）への抵触

差分にもレビュー作業にも抵触はありません。レビュー中のバックエンドはスクラッチパッドの一時DBに向けて起動し、`backend/data/chat.db` は開いていません（更新時刻に変化なしを確認）。検証用データはすべて `DELETE /projects/{id}` API 経由で削除し、SQLiteファイルへの直接操作は行っていません。起動したuvicorn・viteはいずれも停止済みです。

---
---

# 第2回レビュー（2026-08-10）

対象: 第1回の指摘（中1・軽微1〜5・任意1〜4）への対応
検証方法: 第1回と同じく、スクラッチパッドの一時DB（`t42b.db`）に向けたバックエンド + `npm run dev` を Chrome で実機操作

## 判定

**要修正**

中1（削除失敗時の状態管理）は**完全に解消**しました。軽微1・2・4・5、任意2・3も期待どおりです。

ただし**軽微3（フォルダパスの省略表示）の修正が意図と逆の結果になっており、修正前より悪化しています**。`truncate` が効かなくなって省略記号が消え、カードごとに横1000px超のスクロール領域が生まれ、削除ボタンを押すとカードの中身が横にずれてプロジェクト名が見えなくなる状態を実測しました。指摘はこの1件のみです。

---

## 前回指摘への対応状況

| # | 指摘 | 状態 |
|---|---|---|
| 中1 | 削除失敗でモーダルが閉じず、幽霊カードが残る | ✅ 解消 |
| 軽微1 | 取得失敗時に「プロジェクトはまだありません」が出る | ✅ 解消 |
| 軽微2 | `CardContent` の意味のない `sr-only` テキスト | ✅ 解消 |
| 軽微3 | パスが先頭側だけ表示され見分けられない | ❌ **未解消（悪化）** |
| 軽微4 | 確認モーダルが `components/ui/` になっていない | ✅ 解消 |
| 軽微5 | `format:check` 成功の記述が事実と違う | ✅ 解消 |
| 任意1 | `/projects/{id}` 直接オープンで名前が出ない | 未対応（任意のため問題なし） |
| 任意2 | 一覧取得の失敗メッセージが固定文字列 | ✅ 対応 |
| 任意3 | `ProjectList.tsx` のimport順 | ✅ 対応 |
| 任意4 | ブランチにコミットがない | 未対応（マージ前に対応が必要） |

---

## 指摘事項

### 中1: フォルダパスの省略表示が機能しておらず、カードが横スクロール領域になっている

**該当箇所**: `src/components/project/ProjectCard.tsx:37-44`

```tsx
<CardDescription className="mt-1" title={project.folderPath}>
  <span className="block truncate text-left [direction:rtl]" dir="rtl">
    {project.folderPath}
  </span>
</CardDescription>
```

**何が起きているか**

`truncate` を `CardDescription`（グリッドアイテム）から子の `<span>` へ移したことで、**`truncate` そのものが効かなくなりました**。

グリッドアイテムの `min-width` は既定で `auto` に解決され、その値は中身の min-content 幅になります。`white-space: nowrap` が効いているので min-content 幅 = 文字列の全長です。修正前は `CardDescription` 自身に `truncate`（= `overflow: hidden`）が付いていたため、仕様上グリッドアイテムの自動最小サイズが 0 に落ちて列幅に収まっていました。今回 `CardDescription` から `overflow: hidden` が外れた結果、**グリッドアイテムが文字列の全長まで伸び、`<span>` はその中にぴったり収まってしまう**ため、オーバーフローが発生せず省略記号が描画されません。

**実測（カード幅331px、`document.querySelectorAll('[data-slot="card-description"]')` を計測）**

| 項目 | 日本語フォルダ | even-deeper-folder-name-here |
|---|---|---|
| `span.scrollWidth` | 1059 | 1587 |
| `span.clientWidth` | 1059 | 1587 |
| `CardDescription.clientWidth` | 1059 | 1587 |
| `CardHeader.clientWidth` | 329 | 329 |
| `Card.clientWidth` | 331 | 331 |
| `span` の右端 / `Card` の右端 | 1588 / **847** | 2463 / **1193** |
| `text-overflow` | `ellipsis` | `ellipsis` |

`scrollWidth === clientWidth` なので**オーバーフローがゼロ = 省略記号は永久に出ません**。`text-overflow: ellipsis` は指定されているのに一度も発火しない状態です。テキストはカードの右端を最大741px はみ出し、`Card` の `overflow-hidden` によって**文字の途中でハードクリップ**されているだけです。

**画面上の表示**

```
修正前: /private/tmp/claude-501/-Users-daisuke-…      ← 省略記号あり、先頭から
修正後: private/tmp/claude-501/-Users-daisuke-worksp  ← 省略記号なし、先頭のスラッシュも消失
```

省略記号が消えただけでなく、`dir="rtl"` により**先頭の `/` が双方向テキストの並べ替えで行末へ飛び、絶対パスに見えなくなっています**。そして肝心の「末尾側を残す」という目的も達成されていません（オーバーフローしないので、そもそも省略が起きない）。

**副作用: 削除ボタンを押すとカードの中身が横にずれる**

各カードが `scrollWidth 1072px / clientWidth 331px` の横スクロールコンテナになったため、フォーカス移動に伴うブラウザの自動スクロールでカード内容が横に流れます。

```
削除ボタンをクリック（確認モーダルを開いた直後）の実測:
  card[0].scrollLeft = 121    ← 自発的に121pxスクロールしている
  card[0].scrollWidth = 1072 / clientWidth = 331
```

このときスクリーンショット上では、対象カードの**フォルダアイコンとプロジェクト名「日本語フォルダ」が視界外へ流れ、パスの途中（`ude-501/-Users-daisuke-workspace-saino-develop`）だけが見えている**状態でした。削除確認をしようとした瞬間に、どのプロジェクトのカードだったのか画面から消えるので、確認モーダルの意味が薄れます。トラックパッドの横スワイプでも同じようにずらせます。

なお、ページ全体の横スクロールは発生していません（`document.scrollWidth === clientWidth === 1800`）。`Card` の `overflow-hidden` で封じ込められているため、影響はカード内部に閉じています。

**対応（推奨）**

`truncate` は**グリッドアイテムである `CardDescription` 自身に戻して**ください。そのうえで末尾側を残したいなら、`overflow: hidden` を持つ要素と `direction: rtl` を同じ要素に付ける必要があります。

```tsx
<CardDescription
  className="mt-1 truncate text-left [direction:rtl]"
  title={project.folderPath}
>
  {project.folderPath}
</CardDescription>
```

ただし `direction: rtl` は先頭の `/` の位置がずれる問題が残ります（絶対パスなので必ず先頭に `/` があります）。`&lrm;`（U+200E LEFT-TO-RIGHT MARK）を先頭に補うか、**RTLを使わずアプリ側で文字列を加工する**方が確実です。

```tsx
// 例: ホームディレクトリを ~ に短縮し、深い階層は中央を省略する
// /Users/daisuke/…/scratchpad/projects/notes
```

`design.md` は「プロジェクト名・パス表示」としか定めていないため、**先頭側を省略記号付きで表示する修正前の挙動に戻すだけでも受け入れ可能**です（第1回の指摘は「そうしないと見分けづらい」という改善提案であって、仕様違反の指摘ではありませんでした）。悪化した現状を直すことを優先してください。

**補足（軽微）**: `<span>` を挟んだことで、アクセシビリティツリーにパスが**2重に**現れるようになりました。スクリーンリーダーはカードごとにフルパスを2回読み上げます。上記のとおり `<span>` を廃して `CardDescription` に直接クラスを当てれば解消します。

```
button "notesを開く"
 generic "notes"
 generic "/private/tmp/claude-501/…"     ← CardDescription
  generic "/private/tmp/claude-501/…"    ← 追加された span（重複）
```

---

## 解消を確認した項目

### 中1（第1回）: 削除失敗時の状態管理 → 解消

`handleDelete` が `finally` でモーダルを閉じ、`catch` で `loadProjects(true)` を呼ぶようになりました。さらに `ProjectList` のマウント時取得が `loadProjects(true)` に変わり、画面を開くたびにサーバーと同期されます。

**実測（第1回とまったく同じ手順を再現）**

| 手順 | 第1回 | 今回 |
|---|---|---|
| バックエンド側で先に削除 → UIで削除確定 | モーダルが開いたまま | **モーダルが閉じる** |
| エラー表示 | バックドロップの背後に隠れる | **「プロジェクトが見つかりません」が本文に表示される** |
| 削除失敗後のカード枚数 | 3枚（バックエンドは2件） | **2枚（バックエンドと一致）** |
| 画面を離れて戻る | 3枚のまま（再起動まで直らない） | **2枚のまま正常** |

幽霊カードは発生しなくなりました。

### 軽微1（第1回）: 取得失敗時の空状態 → 解消

空状態の条件に `!error` が追加されました（`ProjectList.tsx:129`）。バックエンド停止中に `/projects` を開き直したところ、エラー行のみが表示され「プロジェクトはまだありません」は出ませんでした。

あわせて**任意2も対応**され、メッセージが `getProjectErrorMessage` 経由になっています。

```
第1回: ⚠ プロジェクト一覧の取得に失敗しました  +  「プロジェクトはまだありません」カード
今回:  ⚠ サーバーに接続できません             （空状態カードなし）
```

バックエンドを復旧させてから画面を開き直すと、エラーが消えて一覧が正しく再取得されることも確認しました（`useEffect` の `.then(() => setError(null))` が効いています）。

### 軽微2（第1回）: `sr-only` テキスト → 解消

アクセシビリティツリーから `generic "プロジェクトフォルダ"` が消えました。

### 軽微4（第1回）: 確認モーダルの共通化 → 解消

`src/components/ui/alert-dialog.tsx` が追加され、`AlertDialog` / `AlertDialogContent` / `AlertDialogHeader` / `AlertDialogFooter` / `AlertDialogTitle` / `AlertDialogDescription` / `AlertDialogCancel` を公開しています。既存の `card.tsx` などと同じ `data-slot` + `cn()` の書き方に揃っており、T6-2 の確認モードからも再利用できる形になりました。`ProjectList.tsx` からは Tailwind の直書きが消えています。

実機でも、表示・キャンセル・Esc・削除実行のいずれも第1回と同じく正常でした。説明文の `{name}{" "}` が整理され、「日本語フォルダを一覧から削除します。」と自然な日本語で表示されます。

### 軽微5（第1回）: `format:check` → 解消

```
$ npm run format:check
Checking formatting...
All matched files use Prettier code style!
```

`src/api/chat.ts` と `src/components/layout/Sidebar.tsx`（develop由来の負債）も整形されました。`T4-2_impl.md` の記述と実態が一致しています。

---

## 回帰確認

| 項目 | 結果 |
|---|---|
| 一覧表示（3件） | ✅ |
| カードクリック → `/projects/{id}` 遷移 | ✅ |
| 遷移後もサイドバーの「プロジェクト」が選択状態 | ✅ |
| 削除確認モーダルの表示・キャンセル・Esc | ✅ |
| 削除実行（正常系） | ✅ モーダルが閉じ、カードが消え、`GET /projects` と一致 |
| 削除実行（404） | ✅ 中1のとおり解消 |
| 一覧取得の失敗（バックエンド停止） | ✅ 軽微1のとおり解消 |
| バックエンド復旧後の再取得 | ✅ エラーが消えて一覧が復帰 |
| `npm run format:check` | ✅ All matched files use Prettier code style! |
| `npm run lint` | ✅ エラー0（既存の `button.tsx` の警告1件のみ） |
| `npm run build` | ✅ 成功 |
| ページ全体の横スクロール | ✅ 発生なし（`scrollWidth === clientWidth === 1800`） |

ネイティブフォルダ選択ダイアログは第1回と同様、ブラウザ実行では発火しないため未検証です。

## マージ前に必要なこと

- 上記 中1 の修正
- 任意4: `feature/t4-project-ui` にコミットがまだありません（先端は `develop` と同じ `71c8dab`）。`AGENTS.md` 3章に従い `T4-2: …` の形式でコミットしてください

## 環境の後始末

検証用に作成した3件のプロジェクトはすべて `DELETE /projects/{id}` 経由で削除し、最終的な `GET /projects` が `[]` であることを確認しました。バックエンドはスクラッチパッドの一時DBに向けて起動しており、`backend/data/chat.db` は更新時刻に変化がありません。uvicorn・viteはいずれも停止済みです。

---
---

# 第3回レビュー（2026-08-10）

対象: 第2回の指摘（中1: フォルダパスの省略表示）への対応
差分: 前回から変更されたのは `src/components/project/ProjectCard.tsx` の1ファイルのみ

## 判定

**承認（指摘なし）**

RTL指定を撤回して `truncate` をグリッドアイテム（`CardDescription`）自身に戻す修正で、第2回の指摘は完全に解消しました。省略記号・カードの横スクロール・アクセシビリティツリーの重複・フォーカス時の横ずれのすべてが直っています。

---

## 第2回 中1 の確認: フォルダパスの省略表示 → 解消

```tsx
<CardDescription className="mt-1 truncate" title={project.folderPath}>
  {project.folderPath}
</CardDescription>
```

`<span>` ラッパーと `dir="rtl"` / `[direction:rtl]` が撤去され、`truncate` がグリッドアイテム自身に戻りました。これで `overflow: hidden` によりグリッドアイテムの自動最小サイズが 0 に解決され、列幅で正しく制約されます。

**実測（カード幅331px、3枚とも計測）**

| 項目 | 第2回（RTL版） | 今回 | 判定 |
|---|---|---|---|
| `CardDescription.clientWidth` | 1059 / 1587 / 997 | **305 / 305 / 305** | ✅ 列幅に収まった |
| `CardDescription.scrollWidth` | 1059 / 1587 / 997 | 1058 / 1587 / 997 | — |
| オーバーフローの有無 | **なし**（= 省略記号が出ない） | **あり** | ✅ 省略記号が発火 |
| `Card.scrollWidth` / `clientWidth` | 1072 / 331 | **331 / 331** | ✅ 横スクロール領域が消滅 |
| `CardDescription` の子要素数 | 1（`<span>`） | **0** | ✅ 重複ノードが消滅 |
| `direction` | `rtl` | **`ltr`** | ✅ 先頭の `/` が復帰 |
| `CardDescription` 右端 / `Card` 右端 | 1588 / 847（741pxはみ出し） | **834 / 847** | ✅ カード内に収まった |

**画面上の表示**

```
第2回: private/tmp/claude-501/-Users-daisuke-worksp   ← 省略記号なし・先頭の「/」なし・ハードクリップ
今回:  /private/tmp/claude-501/-Users-daisuke-wo…     ← 省略記号あり・先頭の「/」あり・右パディングも維持
```

**副作用（削除ボタン押下でカードが横にずれる）も解消**

第2回では確認モーダルを開いた瞬間にフォーカス由来の自動スクロールが走り、`card.scrollLeft = 121` となってアイコンとプロジェクト名が視界外へ流れていました。今回は同じ操作をしても以下のとおりです。

```
削除ボタンをクリック（確認モーダルを開いた直後）の実測:
  [{scrollLeft:0, scrollWidth:331, clientWidth:331},
   {scrollLeft:0, scrollWidth:331, clientWidth:331},
   {scrollLeft:0, scrollWidth:331, clientWidth:331}]
```

スクリーンショットでも、モーダルを開いた状態で対象カードのフォルダアイコン・「日本語フォルダ」・省略されたパスがすべて元の位置に見えています。トラックパッドで横に流せる状態でもなくなりました。

**アクセシビリティツリーも正常**

カードごとにパスのノードが1つだけになり、第2回で発生していた2重読み上げは解消しました。第1回で指摘した `sr-only` の「プロジェクトフォルダ」も引き続き出ていません。

```
button "notesを開く"
 generic "notes"
 generic "/private/tmp/claude-501/…"     ← 1つだけ
button "notesを削除"
```

`title` 属性は維持されているので、フルパスはホバーで確認できます。

> 第1回で「見分けづらい」と指摘した点（長いパスのカードが先頭部分だけ同じ文字列に見える）は、修正前の挙動に戻ったことで再び残ります。ただしこれは `design.md`（「プロジェクト名・パス表示」）に対する違反ではなく改善提案だったため、**この状態で承認します**。パス表示の見やすさを改善したくなった場合は、RTLではなくアプリ側での文字列加工（ホームディレクトリの `~` 短縮、中央省略など）を検討してください。

---

## 回帰確認

| 項目 | 結果 |
|---|---|
| 一覧表示（3件） | ✅ 省略記号付きで正しく表示 |
| 削除確認モーダルの表示 | ✅ 対象カードの表示が崩れない |
| 削除実行（404: バックエンド側で先に削除） | ✅ モーダルが閉じ、「プロジェクトが見つかりません」が本文に表示され、一覧が2枚へ再同期 |
| ページ全体の横スクロール | ✅ 発生なし（`scrollWidth === clientWidth === 1800`） |
| `npm run format:check` | ✅ All matched files use Prettier code style! |
| `npm run lint` | ✅ エラー0（既存の `button.tsx` の警告1件のみ） |
| `npm run build`（`tsc && vite build`） | ✅ 成功 |

第2回で確認済みの項目（一覧取得の失敗表示、バックエンド復旧後の再取得、Esc・キャンセル、正常系の削除、サイドバーの選択状態、`/projects/{id}` への遷移）は、`ProjectList.tsx` / `useProject.ts` / `alert-dialog.tsx` に変更がないため再確認を省略しています。

---

## マージにあたって

コードは `develop` へマージして問題ありません。ただし1点、運用面の対応が残っています。

- **`feature/t4-project-ui` にコミットがまだありません**（先端は `develop` と同じ `71c8dab` で、変更はすべて未コミットの作業ツリーにあります）。`AGENTS.md` 3章に従い、`T4-2: プロジェクト一覧画面とフォルダ選択を実装` のような形式でコミットしてからマージしてください。

## 後続タスクへの申し送り

- **T6-3**: `/projects/{id}` を直接開くと `projectStore.projects` が空でプロジェクト名を解決できません（第1回 任意1）。プロジェクトチャットの実装では `folder_path` が必要になるため、`ProjectChat` 側でも `loadProjects()` を呼ぶか、単体取得の手段を用意してください。
- **T5-2**: 一覧・カードのレイアウトは `Card` の `overflow-hidden` に守られている状態です。ファイルツリーやインデックス進捗をカードへ追加する場合、`truncate` は必ずグリッドアイテム自身に付けてください（子要素へ移すと今回と同じ症状が再発します）。

## 環境の後始末

検証用に作成した3件のプロジェクトはすべて `DELETE /projects/{id}` 経由で削除し、最終的な `GET /projects` が `[]` であることを確認しました。バックエンドはスクラッチパッドの一時DB（`t42c.db`）に向けて起動しており、`backend/data/chat.db` は更新時刻に変化がありません。uvicorn・viteはいずれも停止済みです。
