# T8-1 実装サマリー

## 実装した内容

- `GET /system/specs` を追加し、psutilで取得した搭載RAMをバイト値とGiB値で返すようにした。
- `GET /ollama/available-models` を追加し、`ollama.com/library`のHTMLからモデル名とパラメータラベルを取得するようにした。取得成功時の結果はプロセス内でキャッシュする。
- パラメータ数から必要メモリを算出し、設計書の基準どおり`available`・`warning`・`unavailable`の3段階の互換性情報を付与した。70B超のモデルは70Bの目安を比例換算して保守的に判定する。
- `POST /ollama/pull` を追加し、ローカルOllamaの`/api/pull`レスポンスをSSEで中継するようにした。
- HTML解析・互換性判定を`backend/services/model_catalog.py`へ分離し、API層はルーティングとレスポンス整形に留めた。

## 変更ファイル

- `backend/api/ollama.py`
- `backend/services/model_catalog.py`
- `backend/main.py`

## 設計判断

- `GET /system/specs` は`/ollama`プレフィックス外の仕様のため、同一モジュール内に専用ルーターを定義してアプリへ登録した。
- モデル一覧の外部取得は、T8-1および設計書で明示された`ollama.com/library`スクレイピングに限定している。LLM推論・Embeddingは従来どおりローカルOllamaのみを利用する。
- スクレイピング元のHTML構造変更時に空の一覧をキャッシュしないよう、解析できなかった場合は502エラーにして次回リクエストで再試行する。

## 動作確認

- Context7でpsutilの`virtual_memory().total`、FastAPIのSSE応答、httpxの非同期レスポンスストリーミング、Beautiful SoupのHTML/CSSセレクタ操作を確認した。
- ローカルの簡易検証で、HTML解析・必要メモリ算出・3段階互換性判定・RAM取得・`/system/specs`と`/ollama/pull`のルート・SSEイベント形式を確認した。
- `backend/.venv/bin/black backend/api/ollama.py backend/services/model_catalog.py backend/main.py`
- `backend/.venv/bin/ruff check backend/api/ollama.py backend/services/model_catalog.py backend/main.py`
- `git diff --check`

## レビュー対応（第1回）

- 複数サイズを持つモデルは最大サイズで一括判定せず、各サイズを`variants`として返し、それぞれに互換性とpull対象名を付与するように修正した。これにより、例えば`llama3.1:8b`を許可しつつ、`llama3.1:405b`のみをダウンロード不可にできる。
- `M`単位はB単位へ換算して判定するようにし、MoE表記・実効パラメータ表記・サイズ不明のモデルは`unknown`（判定不能）として返すようにした。`unknown`はダウンロード不可ではないため、Embeddingモデルを含めて選択可能である。
- モデル一覧はサイト掲載順を保持するように変更した。
- `/system/specs`のMVPスコープをRAMのみに設計書へ明記した。
- 互換性状態の型を`Literal`としてサービス層とAPI層で共有した。
- Ollama `/api/pull` のリクエストフィールドを現行仕様の`model`へ変更した。
- pull対象のスラッシュ付きモデル名を拒否し、任意レジストリを指定した外部通信を防ぐようにした。

## レビュー対応（第2回）

- カード内のPull数（例: `82.7M`）をパラメータサイズとして扱わないよう、直後に`Pulls`表示が続く値を抽出対象から除外した。
- すべてのモデルに素のモデル名を対象とするvariantを含め、タグ推定に失敗した場合も既定タグでダウンロードできるようにした。
- APIレスポンスから重複した`labels`を削除し、表示・ダウンロード対象を`variants`へ一本化した。
- pull時のカタログキャッシュ照合を廃止し、カタログ取得に失敗した環境でもローカルOllamaへのpullを可能にした。外部レジストリ形式のスラッシュ付きモデル名は引き続き拒否する。

## レビュー対応（第3回）

- サイズが1つだけ判明しているモデルでは、素のモデル名（既定タグ）のvariantにもそのサイズの互換性判定を継承させた。これにより、必要RAMを満たさないモデルを`unknown`経由でダウンロードできないようにした。複数サイズまたはサイズ不明のモデルは、既定タグを推定できないため従来どおり`unknown`とする。
