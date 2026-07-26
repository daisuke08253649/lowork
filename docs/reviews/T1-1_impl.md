# T1-1 実装サマリー

## タスク

T1-1: 共通レイアウト（左サイドバー）の実装

## 実装内容

- React Router を導入し、普通のチャット（`/`）・プロジェクト（`/projects`）・設定（`/settings`）のページ遷移を実装
- 共通の左サイドバーを追加
  - 「新しいチャット」「プロジェクト」「設定」のナビゲーション
  - チャット履歴のプレースホルダー領域
  - ライト／ダークテーマ切り替え
- `MainPanel` と各ページのプレースホルダーを追加
- Tailwind CSS v4のクラスベースのダークモードとCSS変数によるテーマ基盤を整備

## 変更ファイル

- `package.json`
- `package-lock.json`
- `index.html`
- `src/main.tsx`
- `src/App.tsx`
- `src/App.css`
- `src/components/layout/MainPanel.tsx`
- `src/components/layout/Sidebar.tsx`
- `src/pages/NormalChat.tsx`
- `src/pages/ProjectList.tsx`
- `src/pages/Settings.tsx`
- `src/store/themeStore.ts`

## 設計判断

- React RouterはContext7で確認した宣言的ルーティングを採用した。画面遷移はTauriの`invoke()`を使用せず、フロントエンド内で完結させている。
- shadcn/uiの既存`Button`コンポーネントをサイドバーの操作要素に使用した。
- テーマは`html`要素の`dark`クラスで切り替え、選択状態を`localStorage`へ保存する。設定画面の詳細UIはT8-2のスコープとして保留している。

## 動作確認

```bash
npm run build
```

TypeScriptの型チェックおよびViteのプロダクションビルドが成功することを確認済み。

## レビュー指摘への対応（2026-07-26）

- サイドバーのテーマ切り替えボタンを削除した。テーマの操作UIは設計どおりT8-2の設定画面で実装する。
- テーマ状態と`dark`クラス・localStorageの同期を`src/store/themeStore.ts`へ移し、後続の設定画面から利用可能にした。
- `index.html`で初期描画前に保存済みのダークテーマを適用し、テーマのちらつきを防止した。
- shadcn/uiの生成済みテーマトークンを復元した。
- ルートを画面高に固定し、メインパネルを個別スクロール領域にして、後続のチャット画面の内部スクロールに備えた。
