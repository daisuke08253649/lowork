# T2-1 実装サマリー

## タスク

T2-1: 普通のチャット API（SSE ストリーミング）

## 実装内容

- `POST /normal-chat` を追加
  - リクエスト: `{ conversation_id, message, model }`
  - Ollamaの`/api/chat`へストリーミングリクエストを中継
  - 各応答をSSEの`data:`イベントとして返却
- SSEのイベントはUIに必要な`{ content, done }`だけに正規化し、Ollama固有の内部フィールドを公開しない
- 接続前のOllamaエラーはHTTP 503で返却
- ストリーム中の接続・JSONエラーはSSEエラーイベントとして返却し、httpxのレスポンス／クライアントを必ず終了する
- ストリームの読み取りタイムアウトを無効化し、長時間の生成が5秒で切断されないようにした

## 変更ファイル

- `backend/api/chat.py`
- `backend/main.py`
- `docs/reviews/T2-1_impl.md`

## 動作確認

```bash
backend/.venv/bin/python -m compileall -q backend
npm run build
curl --no-buffer --fail --silent --show-error --max-time 60 \
  -H 'Content-Type: application/json' \
  -d '{"conversation_id":null,"message":"一言でこんにちはと返してください。","model":"ornith:9b-q8_0"}' \
  http://127.0.0.1:8000/normal-chat
```

- Python構文確認とフロントエンドビルドが成功
- 実行中Ollamaに対して、`data: {"content":"こんにちは","done":false}`、続いて`done: true`がSSEで順次返ることを確認

## レビュー指摘への対応（2026-07-26）

- Pydanticの`ValidationError`を含む`ValueError`を捕捉し、ストリーム中の不正なOllama応答を`{ error, done: true }`のSSEイベントへ変換するよう修正した。
- OllamaのHTTPエラーは本文の`error`メッセージを取り出してHTTP 502で返し、接続失敗のHTTP 503と区別した。エラー経路でもレスポンスとクライアントを明示的に閉じる。
- `black`と`ruff`をバックエンドの依存に追加した。
- T3-1に、保存済みメッセージをOllamaへ渡して会話文脈を復元する要件を追記した。
- Ollamaエラー本文のデコード失敗も含めて`ValueError`を捕捉するよう統一した。
- `backend/.venv/bin/pip install -r backend/requirements.txt`でBlack／Ruffを導入し、`ruff check backend`と`black --check backend`が成功することを確認した。
