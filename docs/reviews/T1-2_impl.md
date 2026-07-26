# T1-2 実装サマリー

## タスク

T1-2: Ollama 接続確認 API + UI

## 実装内容

- `GET /ollama/status` を追加
  - ローカルOllamaの`/api/tags`へ接続して起動状態を`{ "available": boolean }`で返却
  - 接続・HTTP・応答検証エラー時はHTTP 200で`available: false`を返却
- `GET /ollama/models` を追加
  - Ollamaのインストール済みモデル名を取得
  - Ollama未起動時はHTTP 503を返却
- Axiosクライアントを`src/api/ollama.ts`に追加
- shadcn/uiの`Alert`を追加し、Ollama未起動時の警告バナーを左サイドバー上部へ実装
  - 起動時に確認し、以降5秒ごとに状態をポーリング
  - コンポーネント破棄時にポーリングを停止

## 変更ファイル

- `backend/main.py`
- `backend/__init__.py`
- `backend/api/__init__.py`
- `backend/api/ollama.py`
- `backend/config.py`
- `src/api/client.ts`
- `src/api/ollama.ts`
- `src/components/common/OllamaWarningBanner.tsx`
- `src/components/layout/Sidebar.tsx`
- `src/components/ui/alert.tsx`
- `eslint.config.js`
- `prettier.config.mjs`
- `.prettierignore`
- `package.json`
- `package-lock.json`
- `docs/reviews/T1-2_impl.md`

## 設計判断

- Ollamaへの通信先は`http://127.0.0.1:11434`に固定し、外部サービスへの通信は追加していない。
- 接続状態のエンドポイントはUIのポーリング用途であるため、Ollama未起動を通常の状態として扱い、`available: false`で返す。
- モデル一覧は利用側に明示的なエラーを渡す必要があるため、未接続時はHTTP 503とした。

## 動作確認

```bash
backend/.venv/bin/python -m compileall -q backend
npm run build
curl --fail --silent --show-error http://127.0.0.1:8000/ollama/status
curl --fail --silent --show-error http://127.0.0.1:8000/ollama/models
```

- Python構文確認、TypeScript型チェック、Viteビルドが成功
- 実行中のOllamaに対して`/ollama/status`が`{"available":true}`を返すことを確認
- `/ollama/models`がインストール済みモデル名を返すことを確認
- Ollama停止中にTauri開発アプリを起動し、サイドカー経由の`/ollama/status`が`{"available":false}`を返すことを確認

> 画面を直接確認するためのブラウザ接続はこの環境で利用できなかったため、警告バナー自体の目視確認は未実施。停止中状態でAPIが`available: false`となること、バナーがこの状態で表示される実装であることは確認済み。

## レビュー指摘への対応（2026-07-26）

- Zodを追加し、FastAPIレスポンスを`unknown`として受け取ったあと、スキーマ検証して型を確定するように変更した。
- Axiosインスタンスを`src/api/client.ts`へ共通化し、5秒のタイムアウトを設定した。
- OllamaのベースURLとタイムアウトを`backend/config.py`へ移動し、後続のOllama連携から再利用可能にした。
- `backend/__init__.py`を追加し、パッケージ構成を明示した。

## 継続課題への対応（2026-07-26）

- Tauriサイドカーは`src-tauri/src/lib.rs`で既に実装され、Tauri起動時のFastAPI開始・終了時の停止を実機確認済み。レビュー記録の「未設定」は現行コードと一致しないため、コード変更は不要と判断した。
- ESLint v9のフラット設定とPrettierを導入した。`@typescript-eslint/no-explicit-any`はエラー、その他のルールは警告として設定し、MVPのバランス型方針に合わせた。
- `lint`、`format`、`format:check`のnpmスクリプトを追加した。
- `npm run lint`、`npm run format:check`、`npm run build`が成功することを確認した。Lintは既存shadcnの`button.tsx`に由来する警告1件のみで、エラーはない。
- ESLint設定で`@eslint/js`、`globals`、`eslint-config-prettier`を実際に適用し、未使用の開発依存を解消した。`react-hooks/rules-of-hooks`はコード規約のバランス型方針に従い警告のままとした。
- T2-1のSSEでは共有APIクライアントの5秒タイムアウトを適用しない方針を、実装計画書へ追記した。
