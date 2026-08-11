# T5-2 実装サマリー

## 実装した内容

- `GET /projects/{id}/files` を追加し、プロジェクトフォルダ内のインデックス対象（`.md` / `.txt`）をネストしたJSONツリーとして返すようにした。
- ファイルツリー構築は `backend/services/file_tree.py` に分離し、インデクサーと同じ除外ディレクトリを適用した。外部を参照しうるシンボリックリンクは表示対象から除外している。
- `FileTree` コンポーネントを追加し、再帰表示・フォルダの開閉・ファイルクリック用の空ハンドラーを実装した。
- `GET /projects/{id}/index-status` を2秒間隔でポーリングし、shadcn/ui の `Progress` で進捗またはエラーを表示するようにした。コンポーネントのアンマウント時にはポーリングを停止する。
- プロジェクトチャット画面の右サイドバーへ `FileTree` を組み込んだ。

## 変更ファイル

- `backend/api/projects.py`
- `backend/services/file_tree.py`
- `src/api/projects.ts`
- `src/components/project/FileTree.tsx`
- `src/components/ui/progress.tsx`
- `src/pages/ProjectChat.tsx`

## 設計判断

- ファイルツリーはRAG対象を明確にするため、`.md` と `.txt` のみを表示する。フォルダはこれらの対象ファイルを含むパスとしてネスト表示する。
- ファイル内容のプレビューは将来機能のため、現時点ではクリック領域のみを設け、状態変更は行わない。

## 動作確認

- `backend/.venv/bin/black backend`
- `backend/.venv/bin/ruff check backend`
- `npm run build`
- `npm run lint`（既存の `src/components/ui/button.tsx` に Fast Refresh の警告1件、エラーなし）
- 隔離DB・ChromaDBでFastAPIを起動し、`docs/` を一時プロジェクトとして登録。`GET /projects/{id}/files` が `reviews/` を含むネストツリーを返し、`GET /projects/{id}/index-status` が `done` / `100` を返すことを確認した。一時プロジェクトは `DELETE /projects/{id}` を通じて削除済み。

## レビュー指摘への対応（2026-08-11）

- 大量ファイル時にも右サイドバー内だけがスクロールし、進捗表示が下端に固定されるよう、プロジェクトチャットの外枠を `h-full overflow-hidden` に修正した。
- シンボリックリンクをRAGの対象からも除外した。`is_supported_project_file()` をインデクサーとファイルツリーで共有し、対象判定のずれを防止している。
- RAG対象ファイルを含まない空フォルダをツリーから除外した。
- 進捗ポーリングの復旧時に接続エラー表示を解除し、`done` / `error` 到達後はポーリングを停止するようにした。

## 第2回レビュー指摘への対応（2026-08-11）

- ファイルツリー取得と進捗取得のエラー状態を `treeError` / `statusError` に分離した。進捗ポーリングの成功によって、ツリー取得失敗の表示が消えないようにしている。
