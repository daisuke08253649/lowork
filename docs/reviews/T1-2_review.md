# T1-2 レビュー結果

- 対象タスク: T1-2 Ollama 接続確認 API + UI
- 対象ブランチ: `feature/t1-ollama-status`（作業ツリーの未コミット差分を `develop` と比較）
- レビュー日: 2026-07-26
- **承認可否: 承認**（指摘対応後の再レビューも承認。末尾「再レビュー」セクション参照）

---

## サマリー

`design.md` 4章の `GET /ollama/status` / `GET /ollama/models` の定義どおりに実装されており、`requirements.md`（89行目）「Ollamaが起動していない場合はUI上にわかりやすいエラーを表示する」も警告バナーで満たしている。`AGENTS.md` 7章の制約違反（Ollama以外への外部通信、`invoke()` の使用、Rust側へのロジック追加、ファイル操作関連）はなし。10章の禁止操作にも抵触なし。

レビュー時に以下を実際に実行して確認した。

- `npm run build`（`tsc && vite build`）成功
- `/ollama/status` → `200 {"available": true}`、`/ollama/models` → `200 {"models": [...]}`（起動中のOllamaに対して）
- **Ollama未起動を模擬**（`OLLAMA_BASE_URL` を閉じたポートに差し替え）した状態でも `/ollama/status` → `200 {"available": false}`、`/ollama/models` → `503 {"detail":"Ollamaに接続できません"}` を確認。実装サマリーに記載のない異常系だが、設計意図どおりに動作している

以下の指摘はいずれもマージのブロッカーではないが、**1番については T2-1 に着手する前に方針を決めておくことを強く勧める**（以降の `src/api/*.ts` がこの実装のパターンをそのまま踏襲するため）。

---

## 指摘事項

### 【要検討】1. APIレスポンスのスキーマ検証がなく、`code_style.md` の規定と食い違う

- 該当: `src/api/ollama.ts:16,21`
- `code_style.md` フロントエンドの項に「外部由来の値（LLMのJSON応答、**APIレスポンス**、`JSON.parse()` の戻り値など、実行時まで形が保証されない値）は `unknown` として受け取り、**Zod等のスキーマ検証を通して型を確定させてから使う**」と明記されている。
- 現在の `apiClient.get<OllamaStatus>(...)` はランタイム検証を伴わない単なる型アサーションで、レスポンスの実際の形は保証されない。`any` は使われていないので**ブロッキングルール（`no-explicit-any`）には抵触しない**が、規約の文面とは一致していない。
- 実際のリスクは低い。通信相手は自前の FastAPI で、`response_model=OllamaStatusResponse` により Pydantic 側で形が保証されているため。
- **判断が必要な論点**: これは T1-2 単体の問題ではなく、今後追加される `src/api/chat.ts` / `projects.ts` / `files.ts` すべてに波及するパターンである。次のいずれかを決めてほしい。
  - **(a) 推奨**: MVP では自前バックエンドのレスポンスは型アサーションで済ませ、Zod検証は**本当に形が保証されない LLM の JSON 応答（T6-2 の `{message, file_op}` パース）に限定する**。この方針にするなら `AGENTS.md` 11章に従い `code_style.md` の該当記述を「LLM応答・`JSON.parse()` の結果に限る」旨に修正する
  - **(b)**: 規約どおり `zod` を導入し、`src/api/` のレスポンスをすべて `safeParse` 経由にする
- どちらでもよいが、**規約とコードのどちらかを直して整合させる**こと。

### 【推奨】2. axios の `baseURL` が API クライアントごとにハードコードされる構成になっている

- 該当: `src/api/ollama.ts:3-5`
- `code_style.md` 共通の項に「マジックナンバーは…ハードコードを分散させない」とある。`http://127.0.0.1:8000` は今後 `chat.ts` / `projects.ts` / `files.ts` にも必要になり、このままだと4ファイルに同じ `axios.create()` が並ぶ。
- 対応: `src/api/client.ts`（または `src/api/http.ts`）に共通の axios インスタンスを1つ作り、各クライアントはそれを import する形にする。今のうちにやっておけば T2-1 以降が素直になる。

### 【推奨】3. `OLLAMA_BASE_URL` は `backend/config.py` に置くべき

- 該当: `backend/api/ollama.py:5-6`
- `design.md` 2章のディレクトリ構成に `backend/config.py  # 設定（embedding model名など）` が定義されているが、まだ存在しない。
- Ollama のベースURLは T2-1（`/api/chat`）、T5-1（`nomic-embed-text` の Embedding 呼び出し）、T8-1（`/api/pull`）でも必要になるため、`backend/api/ollama.py` に置いたままだと同じURLが複数箇所に散る。
- 対応: `backend/config.py` を作り、`OLLAMA_BASE_URL` と `OLLAMA_TIMEOUT_SECONDS` をそこへ移す。`chunk_size` / `chunk_overlap` / `top_k` など `design.md` 3-2 の定数も後でここに集約できる。

### 【推奨】4. フロントエンドの axios にタイムアウトが設定されていない

- 該当: `src/api/ollama.ts:3-5`, `src/components/common/OllamaWarningBanner.tsx:29`
- バックエンド側は `OLLAMA_TIMEOUT_SECONDS = 5.0` を設定していて良いが、フロント側の axios は無制限。FastAPI サイドカーが応答しない状態になると、5秒ごとに発行されるリクエストが完了せずに積み上がる。
- 対応: `axios.create({ baseURL, timeout: 5000 })` のようにタイムアウトを入れる。ポーリング間隔（5秒）と揃えておくとリクエストの重複も避けられる。

### 【推奨】5. Ollama未起動時のUI表示を実機で確認してほしい

- `T1-2_impl.md` の動作確認は Ollama が**起動している**ケースのみで、T1-2 の主目的である警告バナーの表示が確認されていない。
- 今回のレビューでバックエンド側の異常系（`available: false` / 503）は代替手段で検証済みなので、残るはUI側の目視確認のみ。`ollama serve` を停止した状態で `npm run tauri dev` を起動し、サイドバー上部にバナーが出ること・Ollama を起動し直すと5秒以内に消えることを確認したうえで、`T1-2_impl.md` に追記してほしい。
- なお `AGENTS.md` 10章の禁止事項は `ollama rm`（モデル削除）であり、`ollama serve` の停止・再起動は対象外。

### 【参考】6. バナーの文言が実態とずれるケースがある

- 該当: `src/components/common/OllamaWarningBanner.tsx:21-25,44`
- `getOllamaStatus()` が例外を投げるのは「FastAPI サイドカーに繋がらない」ときで、そのケースでも「Ollamaに接続できません」と表示される。
- ユーザーから見た結果（チャットできない）は同じなので実害は小さい。T1-2 の時点では現状のままでよいが、将来サイドカー起動失敗の切り分けが必要になったら文言を分けることを検討。

### 【参考】7. `backend/__init__.py` がない（`backend/api/__init__.py` はある）

- `from backend.api.ollama import router` は PEP 420 の名前空間パッケージとして解決されるため**実際に動作することは確認済み**（`backend.__path__` が `_NamespacePath` になる）。
- ただし `backend/api/` には `__init__.py` があり `backend/` にはない、という非対称は将来ハマりどころになりうる。どちらかに統一しておくと無難（`backend/__init__.py` を空で置くのが簡単）。

### 【参考】8. CORS の `allow_origins` は開発時のオリジン固定

- 該当: `backend/main.py:10`（T0-3 で設定済みの既存コード。T1-2 の変更ではない）
- `allow_origins=["http://localhost:1420"]` は `npm run tauri dev`（`devUrl: http://localhost:1420`）では正しく動作する。T1-2 でプロジェクト初のHTTP通信が入ったので念のため記載。
- 将来 `tauri build` でバンドル配布する場合、オリジンが `tauri://localhost` になり CORS で弾かれる。MVP完成条件は dev 起動なので現時点では対応不要。

---

## レビュー観点別の所見

| 観点 | 結果 |
|---|---|
| `design.md` 4章 APIエンドポイント定義との一致 | OK（`GET /ollama/status` / `GET /ollama/models` とも定義どおり。実際に OpenAPI スキーマとレスポンスを確認） |
| `design.md` 2章 ディレクトリ構成との一致 | OK（`backend/api/ollama.py`、`src/api/ollama.ts`、`src/components/common/` すべて設計書どおり）。`backend/config.py` 未作成は指摘3 |
| `AGENTS.md` 7章: React → FastAPI は axios で直接HTTP | OK（`src/api/ollama.ts` で axios。`invoke()` 不使用） |
| `AGENTS.md` 7章: Rust側にロジックを書かない | OK（`src-tauri/` に変更なし） |
| `AGENTS.md` 7章: Ollama以外への外部通信禁止 | OK（通信先は `http://127.0.0.1:11434` と `http://127.0.0.1:8000` のみ。分析ツール等の混入なし） |
| `AGENTS.md` 7章: パストラバーサル対策 | 該当なし（ファイル操作なし） |
| `AGENTS.md` 7章: 確認/自走モードのゲート | 該当なし |
| `AGENTS.md` 10章: 禁止コマンド・操作 | 抵触なし |
| `requirements.md`: Ollama未起動時のエラー表示 | OK（警告バナー。バックエンド側の異常系はレビュー時に実測して確認済み。UI目視確認は指摘5） |
| `code_style.md`: `any` 禁止 | OK（`src/` 全体に `any` なし） |
| `code_style.md`: `src/api/` のリクエスト/レスポンス型の明示 | OK（`OllamaStatus` / `OllamaModels` を定義）。ただしランタイム検証は指摘1 |
| `code_style.md`: Python の型ヒント必須 | OK（`fetch_tags` / `get_ollama_status` / `get_ollama_models` すべて戻り値型あり） |
| `code_style.md`: I/O は async/await で統一 | OK（`httpx.AsyncClient` で非同期） |
| `code_style.md`: Pydantic でのバリデーション | OK（`response_model` 指定 + `model_validate` によるOllama応答の検証） |
| `code_style.md`: 制御構文のネスト2階層まで | OK |
| `code_style.md`: マジックナンバーの定数化 | 概ねOK（`OLLAMA_TIMEOUT_SECONDS` / `POLLING_INTERVAL_MS` を定数化）。URLの配置は指摘2・3 |
| `implementation_plan.md`: タスク粒度・依存関係 | OK（依存の T0-3・T1-1 は完了済み。T1-2 の作業内容4項目をちょうど満たし、範囲外の実装なし） |

## 良かった点

- **例外の捕捉範囲が正しい**。`httpx.HTTPError` は `ConnectError` / `TimeoutException` / `HTTPStatusError` の共通基底で接続失敗系を漏れなく拾い、`ValueError` は `json.JSONDecodeError` と Pydantic の `ValidationError`（`ValueError` のサブクラス）の両方をカバーする。Ollama が起動しているが応答が壊れているケースまで想定できている
- **status と models でエラー方針を意図的に分けている**のが妥当。ポーリング用の `/status` は未起動を「通常の状態」として 200 + `available: false` で返し、明示的な失敗を伝えたい `/models` は 503。実装サマリーの設計判断にも理由が書かれている
- `fetch_tags()` を共通化し、2つのエンドポイントで重複させていない
- ポーリングの後始末が正しい。`isMounted` フラグ + `clearInterval` で、アンマウント後の `setState` と interval のリークの両方を防いでいる。StrictMode の二重マウントでも破綻しない
- `isAvailable` の初期値を `boolean | null` にして、**初回チェックが返るまでバナーを出さない**設計になっている。起動直後に一瞬バナーが光るのを避けられている
- Ollama への接続先を `127.0.0.1` に固定し、オフライン要件を実装レベルで担保している
- `Alert` を shadcn 経由で導入しており（`AGENTS.md` 6章の方針どおり）、手書きコンポーネントを増やしていない

---

## T1-2 のスコープ外だが継続している宿題

1. **Tauri サイドカー未設定（T0-4）** — `src-tauri/tauri.conf.json` に `externalBin` がなく、`src-tauri/src/` にも起動処理がない。T1-2 の動作確認で FastAPI を手動起動して curl を叩いている（実装サマリーの記載から推測）ことからも未完と思われる。**T1-1・T1-2 で「アプリ起動 → FastAPI 自動起動 → 疎通」が通る前提が揃ったので、T2-1 に進む前にここを片付けるのが良い**
2. **ESLint / Prettier 未導入** — `code_style.md` の「ESLint + Prettier を導入する」「`no-explicit-any` を有効化しこの項目のみブロックする」が未実施。指摘1の方針決めと合わせて対応すると効率が良い

---

## 結論

**承認**。`AGENTS.md` 3章の連携フローに従い、`feature/t1-ollama-status` を `develop` にマージしてよい。

マージ後、T2-1 に着手する前に以下を片付けることを勧める。

- 指摘1（APIレスポンス検証の方針決定 — コードか `code_style.md` のどちらかを直す）
- 指摘2・3（axios インスタンスと `OLLAMA_BASE_URL` の共通化）
- 指摘5（Ollama未起動時のUI目視確認と `T1-2_impl.md` への追記）
- 宿題1（T0-4 のサイドカー設定）

---
---

# 再レビュー（2026-07-26）

- 対象: `feature/t1-ollama-status` 作業ツリー（未コミット差分）を `develop` と比較
- **承認可否: 承認**

## ⚠️ 前回レビューの訂正（レビュアー側の誤り）

前回「宿題1: Tauri サイドカー未設定（T0-4）」と記載したが、**これは誤り**。Codex の指摘のとおり、サイドカーは `src-tauri/src/lib.rs` に `tauri-plugin-shell` を使って実装済みで、`firstcommit` の時点から存在し本ブランチでの変更もない。

- `setup()` で `backend/.venv/bin/uvicorn backend.main:app --port 8000` を `current_dir(project_root)` で spawn
- `CommandChild` を `BackendProcess(Mutex<Option<..>>)` として `manage` し、`RunEvent::ExitRequested` で `kill()`
- `Cargo.toml` に `tauri-plugin-shell = "2.3.5"` あり

前回のレビューで `externalBin` / `sidecar` / `Command::` というパターンで grep したため、`.shell().command(...)` という記述を拾えなかったことが原因。`tauri.conf.json` の `externalBin` はバイナリを**バンドルに同梱する**ための設定で、開発時に Rust 側から直接プロセスを起動する今回の方式では不要。**T0-4 は完了扱いでよい**。誤った差し戻しをして申し訳ない。

なお付随して気付いた点（いずれも T1-2 の差分外・現時点で対応不要）:
- `uvicorn` のパスを `env!("CARGO_MANIFEST_DIR")` からコンパイル時に解決しており、`backend/.venv/` に依存している。MVP完成条件は `npm run tauri dev` なのでこれで問題ないが、将来 `tauri build` でバンドル配布する場合は `externalBin` 方式への移行が必要になる
- パスが `bin/uvicorn`（POSIX形式）固定。macOS専用というスコープ（`requirements.md`）と一致しているので問題なし

## 指摘事項への対応確認

| # | 指摘 | 対応 | 確認 |
|---|---|---|---|
| 1 | APIレスポンスのスキーマ検証方針 | 選択肢(b)を採用。`zod` を導入し、`apiClient.get<unknown>()` で受けて `schema.parse()` で型を確定。`z.infer` で型定義も一本化 | ✅ |
| 2 | axios インスタンスの共通化 | `src/api/client.ts` に `apiClient` を集約。`API_BASE_URL` / `API_REQUEST_TIMEOUT_MS` も定数化 | ✅ |
| 3 | `OLLAMA_BASE_URL` を `backend/config.py` へ | `backend/config.py` を新規作成し、`OLLAMA_BASE_URL` と `OLLAMA_TIMEOUT_SECONDS` を移動。`api/ollama.py` は import するだけになった | ✅ |
| 4 | axios のタイムアウト未設定 | `apiClient` に `timeout: 5_000` を設定 | ✅ |
| 5 | Ollama未起動時のUI目視確認 | 環境制約でバナーの目視確認は未実施。ただし Tauri 開発アプリ起動 + サイドカー経由で `/ollama/status` が `available: false` を返すことは確認済み | △（下記参照） |
| 7（参考） | `backend/__init__.py` がない | 空ファイルを追加し、パッケージ構成を明示 | ✅ |
| 宿題2 | ESLint / Prettier 未導入 | ESLint v9 フラット設定 + Prettier を導入。`no-explicit-any` を `error`、他を `warn`。`lint` / `format` / `format:check` スクリプトを追加 | ✅ |

**指摘5について**: 目視確認が未実施なのは環境要因であり、承認は妨げない。バナーの表示条件は `isAvailable !== false` の単純な分岐で、`available: false` が返ることまで実機確認できていれば残りのリスクは十分小さい。`implementation_plan.md` T9-1 の統合動作確認チェックリストに「Ollama 未起動時: 警告バナーが表示される」が既にあるので、**そこで必ず確認すること**。

## レビュー時に実行した検証

- `npm run lint` → **エラー0件**、警告1件（`button.tsx` の `react-refresh/only-export-components`。shadcn 生成コードが `buttonVariants` を同ファイルから export しているためで、実害なし）
- `npm run format:check` → All matched files use Prettier code style
- `npm run build`（`tsc && vite build`）→ 成功
- バックエンド（`backend/config.py` 移動後）:
  - OpenAPI paths = `['/ollama/status', '/ollama/models', '/']`
  - Ollama起動中: `/ollama/status` → `{"available": true}`、`/ollama/models` → モデル一覧
  - Ollama未起動を模擬: `/ollama/status` → `200 {"available": false}`、`/ollama/models` → `503 {"detail":"Ollamaに接続できません"}`
- `src-tauri/` に対する差分なし（サイドカー実装は develop 由来のまま）

## 今回の変更で新たに気付いた点

### 【重要・T2-1への申し送り】共通 `apiClient` の5秒タイムアウトは SSE を切ってしまう

- 該当: `src/api/client.ts:4,8`
- T1-2 の用途（ポーリング）には5秒タイムアウトが適切で、この実装で問題ない。
- ただし **T2-1 の `POST /normal-chat` は SSE ストリーミング**で、応答が5秒を超えるのが常態になる。この `apiClient` をそのまま使うと**生成途中でリクエストが切られる**。
- 対応（T2-1 実装時）: SSE は axios ではなく `fetch` + `ReadableStream`（または `EventSource`）で受けるのが素直。axios を使う場合はエンドポイント単位で `timeout: 0` を指定すること。
- 今回の差分としては修正不要。T2-1 の実装者への申し送りとして記載する。

### 【軽微】ESLint 関連の未使用 devDependencies が3つある

- 該当: `package.json`, `eslint.config.js`
- `@eslint/js` / `eslint-config-prettier` / `globals` が devDependencies に追加されているが、`eslint.config.js` から**一切参照されていない**（grep 0件）。
- 特に `eslint-config-prettier` は Prettier と競合する整形系ルールを無効化するためのもので、現状は適用されていない。整形系ルールを1つも有効化していないので実害はないが、依存だけ残っているのは紛らわしい。
- 対応: 使う（`eslint.config.js` の末尾に `eslintConfigPrettier` を追加、`languageOptions.globals` に `globals.browser` を設定）か、`package.json` から削除するかのどちらかに寄せる。急ぎではない。

### 【軽微】`react-hooks/rules-of-hooks` は `error` にする価値がある

- 該当: `eslint.config.js:27`
- `exhaustive-deps` が警告どまりでよいのは同意する（誤検知が多く、MVPの速度優先方針と合う）。一方 `rules-of-hooks` は違反すると **React が実行時に壊れる correctness ルール**で、性質が異なる。
- `code_style.md` の「`no-explicit-any` 以外はブロックしない」という方針とは緩やかに競合するので、最終判断は開発者に委ねる。`error` にするなら `code_style.md` 側も併せて更新すること。

### 【参考】Prettier 導入で T1-2 と無関係なファイルに整形差分が入っている

- 該当: `src/components/ui/button.tsx`, `src/lib/utils.ts`, `src/pages/*.tsx`, `src/components/layout/MainPanel.tsx`
- 差分内容を確認したところ**すべて整形のみ**（セミコロン付与、行の折り返し、末尾カンマ）で、ロジック変更はない。実害なし。
- 今後、整形ツールの一括適用を行う際は**独立したコミットに分けておく**と、機能差分のレビューがしやすくなる。

### 【参考】`prettier.config.mjs` は実質デフォルト設定

- `trailingComma: "all"` は Prettier 3 のデフォルト値。設定ファイル自体は「Prettier を使っている」ことの明示になるので残してよい。

## レビュー観点別の所見（前回からの差分のみ）

| 観点 | 結果 |
|---|---|
| `code_style.md`: APIレスポンスのスキーマ検証 | **OK**（`unknown` で受けて Zod で確定。規約の文面どおり） |
| `code_style.md`: ESLint + Prettier の導入 | **OK**（`no-explicit-any` を `error`、他を `warn` とする「バランス型」方針どおり） |
| `code_style.md`: マジックナンバーの定数化・ハードコードの非分散 | **OK**（`backend/config.py` と `src/api/client.ts` に集約） |
| `design.md` 2章 ディレクトリ構成 | **OK**（`backend/config.py` が設計書どおりの位置に作成された） |
| `AGENTS.md` 7章: 外部通信 | OK（通信先は `127.0.0.1:11434` と `127.0.0.1:8000` のみ。追加された依存は `zod` と ESLint/Prettier 系のみで、ランタイムの外部通信は増えていない） |
| `AGENTS.md` 10章: 禁止コマンド・操作 | 抵触なし |
| `implementation_plan.md`: タスク粒度 | ESLint/Prettier 導入と整形差分の分だけ T1-2 の範囲を超えているが、前回レビューの宿題への対応であり妥当 |

## 結論

**承認**。`AGENTS.md` 3章の連携フローに従い、`feature/t1-ollama-status` を `develop` にマージしてよい。

指摘1〜4・7と宿題2はすべて対応済み。指摘5（バナーの目視確認）は環境要因による未実施で、T9-1 の統合動作確認で回収する。今回新たに挙げた4点はいずれも任意対応でマージのブロッカーではないが、**「共通 `apiClient` の5秒タイムアウトが SSE を切る」点だけは T2-1 の実装前に必ず思い出すこと**。

---
---

# 再々レビュー（2026-07-26）

- 対象: `feature/t1-ollama-status` 作業ツリー（未コミット差分）を `develop` と比較
- **承認可否: 承認（指摘なし）**

## 対応確認

| # | 指摘 | 対応 | 確認 |
|---|---|---|---|
| 軽微 | ESLint 関連の未使用 devDependencies 3件 | `eslint.config.js` で `js.configs.recommended` / `globals.browser` / `eslintConfigPrettier` をすべて実際に適用。未使用の依存は解消 | ✅ |
| 重要 | 共通 `apiClient` の5秒タイムアウトが SSE を切る | `implementation_plan.md` の T2-3（`src/hooks/useChat.ts` の SSE 受信ロジック）に、エンドポイント単位でタイムアウトを無効化する旨を追記 | ✅ |
| 軽微 | `react-hooks/rules-of-hooks` を `error` にするか | `code_style.md` のバランス型方針に従い `warn` のまま据え置くと判断 | ✅（開発者判断として妥当。前回レビューでも「最終判断は開発者に委ねる」と記載しており、異議なし） |

### 補足

- **ESLint 設定の作りが正しい**。`js.configs.recommended` を有効化したうえで `no-undef` / `no-unused-vars` を `off` にし、TypeScript 側（`@typescript-eslint/no-unused-vars` と型検査）へ委譲している。これを外すと TS ファイルで誤検知が出るため、必要な対応ができている
- `eslintConfigPrettier` が配列の**末尾**に置かれており、整形系ルールを最後に打ち消す正しい順序になっている
- **`implementation_plan.md` の追記位置が適切**。実装サマリーには「T2-1のSSE」と書かれているが、実際の追記先は T2-3（クライアント側の SSE 受信を実装するタスク）。タイムアウトはクライアント側の関心事なので、T2-3 に置くのが正しい
- `AGENTS.md` 11章「実装中に設計・仕様を変更した場合は `implementation_plan.md` を更新する」の運用どおりに、申し送り事項がドキュメント側へ反映されている

## レビュー時に実行した検証

- `npm run lint` → **エラー0件**、警告1件（`button.tsx` の `react-refresh/only-export-components`。shadcn 生成コード由来で実害なし。前回から変化なし）
- `npm run format:check` → All matched files use Prettier code style
- `npm run build`（`tsc && vite build`）→ 成功
- バックエンド:
  - OpenAPI paths = `['/ollama/status', '/ollama/models', '/']`
  - Ollama起動中: `/ollama/status` → `{"available": true}`
  - Ollama未起動を模擬: `/ollama/status` → `200 {"available": false}`、`/ollama/models` → `503 {"detail":"Ollamaに接続できません"}`

## 新規の指摘

**なし。**

強いて挙げれば、`js.configs.recommended` が `files` 指定なしで全ファイルに適用されるため、将来 `lint` スクリプトを `eslint .`（設定ファイル自体も対象）に広げる場合は、`.js` / `.mjs` 向けに `globals.node` の設定が必要になる。現在の `eslint src` の範囲では影響しないので対応不要。

## 結論

**承認**。前回・前々回の指摘はすべて解消され、新たな問題も見つからなかった。`AGENTS.md` 3章の連携フローに従い、`feature/t1-ollama-status` を `develop` にマージしてよい。

T1-2 の残タスクは、T9-1 の統合動作確認における「Ollama 未起動時: 警告バナーが表示される」の目視確認のみ。

