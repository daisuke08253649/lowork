# T4-1 実装サマリー

## タスク

T4-1: プロジェクト管理 API

## 実装内容

- `GET /projects`: 作成日時の新しい順でプロジェクト一覧を取得
- `POST /projects`: 名前とフォルダパスからプロジェクトを作成
  - 存在するディレクトリだけを受け付ける
  - パスを絶対パスへ正規化する
  - 同一フォルダの重複登録は 409 で拒否する
  - 作成後にインデックス状態を `indexing`・0% に設定する
- `DELETE /projects/{id}`: プロジェクトを削除し、インデックス状態も破棄
- `GET /projects/{id}/index-status`: `indexing` / `done` / `error` と進捗を返却
- プロジェクト CRUD は `backend/services/project.py` に集約し、API層はリクエスト・レスポンス変換だけを担当
- `projects` テーブルの既存 UNIQUE 制約を使い、フォルダパス重複を防止

## 変更ファイル

- `backend/api/serialization.py`
- `backend/api/projects.py`
- `backend/services/project.py`
- `backend/services/index_status.py`
- `backend/main.py`
- `docs/implementation_plan.md`
- `docs/reviews/T4-1_impl.md`

## 設計判断

- 実際の ChromaDB インデックス構築と進捗更新は、後続タスク T5-1 の `indexer.py` が担当する。T4-1 ではその受け口として in-memory の状態管理と API 契約を先行して実装した。T5-1の実装前は `index-status` を一貫して `done`・100% として返す
- ChromaDB collection は T5-1 より前には作成されないため、T4-1 の削除では SQLite のプロジェクト情報と in-memory 状態のみを削除する。collection 削除は T5-1 で collection 作成処理と合わせて実装する

## 動作確認

```bash
backend/.venv/bin/ruff check backend
backend/.venv/bin/black --check backend
git diff --check
```

- 上記チェックはすべて成功
- FastAPI をローカル起動して、空の一覧取得、プロジェクト作成、`indexing`・0% の状態取得を確認
- 同じフォルダの重複登録が 409 になることを確認
- `DELETE /projects/{id}` が 204 を返すことを確認
- 確認用プロジェクトは API 経由で削除済み

## レビュー指摘への対応

- ChromaDB collection の削除を T5-1 で接続することを、T4-1 と T5-1 の実装計画に明記した
- T5-1より前の `index-status` は、バックエンド再起動の前後を問わず `done`・100% になるよう、作成時に仮の `indexing` 状態を登録しない形へ変更した
- UTC日時の正規化を `backend/api/serialization.py` へ共通化した
- プロジェクトフォルダは絶対パスだけを受け付けるようにし、相対パスの意図しない登録を拒否した
- プロジェクト名のトリムと空文字検証はサービス層へ集約した
