# T4-2 実装サマリー

## 実装したタスク

- T4-2: プロジェクト一覧画面 + フォルダ選択

## 概要

- プロジェクト一覧をFastAPIの`GET /projects`から取得してカード表示する画面を実装した。
- 「新規」ボタンからTauriのネイティブフォルダ選択ダイアログを開き、選択したフォルダ名・絶対パスで`POST /projects`を実行するようにした。
- 削除確認モーダルを経由して`DELETE /projects/{id}`を実行するようにした。
- Zustandでプロジェクト一覧とアクティブプロジェクトIDを管理し、カード選択時にプロジェクトチャット用ルートへ遷移するようにした。
- Tauri Dialog pluginのフロントエンド依存、Rustプラグイン初期化、権限を追加した。

## 変更ファイル

- `package.json` / `package-lock.json`
  - `@tauri-apps/plugin-dialog` を追加。
- `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock`
  - `tauri-plugin-dialog` を追加。
- `src-tauri/src/lib.rs`
  - Dialog pluginを初期化。
- `src-tauri/capabilities/default.json`
  - `dialog:default`権限を追加。
- `src/api/projects.ts`
  - プロジェクトAPIクライアント、Zodレスポンス検証、APIエラー表示用の変換を実装。
- `src/types/project.ts`
  - フロントエンド用`Project`型を追加。
- `src/store/projectStore.ts`
  - プロジェクト一覧・アクティブプロジェクト状態を追加。
- `src/hooks/useProject.ts`
  - 一覧取得、ネイティブフォルダ選択、新規作成、削除、選択処理を実装。
- `src/components/ui/card.tsx` / `src/components/ui/alert-dialog.tsx`
  - shadcn/uiのCardと、既存Base UI基盤に合わせた共通Alert Dialogコンポーネントを追加。
- `src/components/project/ProjectCard.tsx`
  - プロジェクト名・フォルダパス表示、選択、削除操作を実装。
- `src/pages/ProjectList.tsx`
  - 一覧、空状態、エラー表示、新規作成、削除確認モーダルを実装。
- `src/pages/ProjectChat.tsx`
  - 選択遷移を成立させるための最小プレースホルダーを追加。実際のチャット機能はT6-3のスコープ。
- `src/App.tsx`
  - `/projects/:projectId`ルートを追加。
- `src/components/layout/Sidebar.tsx`
  - プロジェクトチャット画面でも「プロジェクト」ナビゲーションを選択状態にするよう調整。

## 設計判断

- プロジェクトチャットの実装はT6-3が担当するため、本タスクではプロジェクト選択後の遷移先を最低限の案内画面に留めた。
- APIレスポンスは既存チャット実装と同様にZodで検証し、重複フォルダなどバックエンドの`detail`は利用者に表示する。
- ネイティブフォルダ選択にはTauri Dialog pluginを用い、ReactからFastAPIへは既存方針どおりaxiosで直接HTTP通信する。

## 動作確認

- `npm run format:check` 成功
- `npm run lint` 成功（既存の`src/components/ui/button.tsx`にFast Refreshの警告1件のみ）
- `npm run build` 成功
- `cargo check --manifest-path src-tauri/Cargo.toml` 成功
- 実機での確認手順:
  1. `npm run tauri dev`で起動し、左サイドバーから「プロジェクト」を開く。
  2. 「新規」を押してフォルダを選択し、カードが追加されプロジェクトチャットの案内画面へ遷移することを確認する。
  3. 同じフォルダを選び、重複エラーが表示されることを確認する。
  4. カードの「削除」を押し、確認モーダルで削除・キャンセルが期待どおり動くことを確認する。

## レビュー対応（2026-08-10）

- 削除失敗時も確認モーダルを閉じ、一覧を強制再取得してバックエンドの状態へ同期するよう修正。
- 画面を開くたびにプロジェクト一覧を強制再取得し、取得失敗時は空状態を表示しないよう修正。
- フォルダパスはカード幅を超えない省略表示にし、不要なスクリーンリーダー用テキストを削除。
- 確認モーダルを`src/components/ui/alert-dialog.tsx`へ切り出した。

## 第2回レビュー対応（2026-08-10）

- 末尾表示用のRTL指定を撤回し、グリッドアイテム自身で省略する安全な表示へ戻した。これにより、長いパスでもカード内の横スクロールやアクセシビリティツリー上の重複を発生させない。
