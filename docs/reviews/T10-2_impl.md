# T10-2 実装サマリー（セキュリティ対策: Issue #7 #8 #9）

模擬攻撃によるセキュリティチェックで見つかった問題（GitHub Issue #7〜#9）に対応した。

## 実装内容

### #7 Hostヘッダー未検証によるDNSリバインディング（High）

- `backend/main.py` に `TrustedHostMiddleware` を追加し、Hostヘッダーが `127.0.0.1` / `localhost` 以外のリクエストを400で拒否する。
- POST・DELETEなどの状態変更リクエストで、Originヘッダーが許可オリジン以外なら403で拒否するミドルウェアを追加した。Originヘッダーがないリクエスト（curlなど、ブラウザ以外）は通す。
- 許可オリジンを `backend/config.py` の `ALLOWED_ORIGINS` にまとめ、CORSでも同じリストを使うようにした。本番ビルドのTauriオリジン（`tauri://localhost`、`http://tauri.localhost`）も追加した。これまで本番ビルドのオリジンはCORSの許可リストに入っていなかった。
- `create_project` で、ルート・ホームフォルダ・ホームの上位階層（例: `/Users`）の登録を400で拒否する。登録済みのプロジェクトには影響しない。

### #8 自走モードでの間接プロンプトインジェクションによる上書き（Medium）

- `backend/services/file_ops.py` に `apply_file_operation` を追加し、`/files/apply` と自走モードの両方からこれを使うようにした（以前の `get_file_operation` は削除）。
- `edit_file` は書き込む前に元の内容を `FILE_BACKUP_PATH/{project_id}/{UTCタイムスタンプ}/{相対パス}`（既定は `backend/data/file_backups/`、gitignore対象）へ保存し、変更前の内容を返す。プロジェクトフォルダ内には保存しないため、インデックスやファイルツリーに混ざらない。MVPでは自動削除しない。
- `POST /project-chat` のレスポンスに `previous_content` を追加した（自走モードで既存ファイルを編集したときだけ値が入る）。
- 自走モードの通知に「元に戻す」ボタンを追加した。押すと `/files/apply`（edit）で変更前の内容を書き戻し、「{ファイル名} を元に戻しました」と表示する。
- System Promptで、RAGコンテキストを `<project_files>` タグで囲み、参考データとして扱い中の指示には従わないこと、`file_op` はユーザーが依頼したときだけ返すことを明記した。ファイル内容に含まれるタグ名は、大文字・小文字を問わず `project-files` に置き換えて無害化する。

### #9 Tauriの多層防御（Low）

- `tauri.conf.json` に `csp`（本番）と `devCsp`（開発時用。`localhost:1420` と `'unsafe-inline'` を許可。ただしmacOSの `tauri dev` では適用されない。レビュー対応（第1回）参照）を設定した。`connect-src` はIPCとローカルAPI（`127.0.0.1:8000` / `localhost:8000`）に限定した。
- `capabilities/default.json` から `shell:allow-execute` と `opener:default` を削除した。サイドカーの起動はRust側の `app.shell()` から行っており、フロントエンドの権限は不要。
- テンプレートに由来する未使用の `greet` コマンドを削除した。

## 独自判断した点

- Issue #8 の対応案のうち「自走モードの編集範囲を絞る」はとっていない。自走モードの仕様変更になるため、開発者の判断待ちとした。
- 実際に確かめたところ、`gemma4:e4b` ではプロンプトの強化だけで攻撃を防げなかった（同じ攻撃で3回とも上書きされた）。プロンプト側の対策は補助的なものと位置づけ、主な対策はバックアップと「元に戻す」とした。
- `opener` プラグインはフロントエンドで使っていないため、権限だけを外した。プラグインの初期化と依存関係は残している。

## ドキュメント更新

- `docs/design.md`: `POST /project-chat` のレスポンスに `previous_content` を追加した。8章に、APIのアクセス制限・プロジェクトフォルダの範囲・編集前のバックアップ・RAGコンテキストの扱い・WebViewのCSPを追記した。
- `docs/implementation_plan.md`: T10-2 を追加した。

## 変更ファイル

- `backend/main.py`
- `backend/config.py`
- `backend/services/project.py`
- `backend/services/file_ops.py`
- `backend/api/files.py`
- `backend/api/chat.py`
- `src/api/chat.ts`
- `src/hooks/useChat.ts`
- `src/pages/ProjectChat.tsx`
- `src-tauri/tauri.conf.json`
- `src-tauri/capabilities/default.json`
- `src-tauri/src/lib.rs`
- `docs/design.md`
- `docs/implementation_plan.md`

## 確認結果

- `ruff check backend` / `black backend`
- `npx tsc --noEmit` / `npx eslint src` / `npm run build`
- `cargo check`（`src-tauri`）
- `git diff --check`

本番DBとは別の検証用インスタンス（ポート18765、DB・Chroma・バックアップは一時ディレクトリ）で、修正後に攻撃をもう一度試した結果は次のとおり。

| 確認内容                                                                            | 結果                                                                              |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Hostを偽装したPOST / GET                                                            | 400 `Invalid host header`                                                         |
| 不正なOriginからのPOST                                                              | 403                                                                               |
| 正規のオリジン（`http://localhost:1420`）からのプロジェクト作成と、Host `localhost` | 201                                                                               |
| `tauri://localhost` からのGET / 正規オリジンからのプリフライト                      | 200 / 200                                                                         |
| `/`・`$HOME`・`/Users` の登録                                                       | 400                                                                               |
| 自走モードでの間接プロンプトインジェクション                                        | 上書きされたが、元の内容はバックアップに残り、`previous_content` からも取得できた |
| バックアップからの復元（`/files/apply` edit）                                       | 204。元の内容に戻った                                                             |

## 手動確認項目

- `npm run tauri dev` でFastAPIが自動起動し、画面が表示され、通常チャット・プロジェクトチャット・ファイル選択ダイアログが動くこと（capabilityの削除による影響の確認）
- （任意）`npm run tauri build` で作ったアプリを起動し、画面表示とAPI通信が動くこと（本番CSPの影響の確認。配布用バンドルはMVP対象外）
- 自走モードで既存ファイルを編集したあと「元に戻す」で元の内容に戻ること
- 確認モードでのファイル適用が従来どおり動くこと

## レビュー対応（第1回）

- 軽微1: Tauri 2.11.5 では、開発サーバーをプロキシしてCSPを挿入するのはモバイル開発時だけで、macOSの `tauri dev` では `devCsp` が適用されない。`design.md` 8章にこの点を補足した。手動確認項目は、`tauri dev` での確認（capabilityの削除による影響）と、`tauri build` 後のアプリでの確認（本番CSPの影響。任意）に分けた。`implementation_plan.md` T10-2 の動作確認も同じように修正した。
- 軽微2〜5: レビューで「MVPとして許容」と判断されたため、対応しない。軽微5（自走モードでの改ざんの残存リスク）は、Issue #8 をクローズするときにコメントとして記録する。
