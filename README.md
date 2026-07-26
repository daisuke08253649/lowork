# lowork

「普通のチャット」と「プロジェクトチャット（RAG + ファイル操作）」を持つ、完全ローカル動作のmacOS向けAIアシスタント。

要件・設計の詳細は以下を参照:

- 要件定義書: [docs/requirements.md](docs/requirements.md)
- 設計書: [docs/design.md](docs/design.md)
- 実装計画書: [docs/implementation_plan.md](docs/implementation_plan.md)

## 構成

- フロントエンド: Tauri + React + TypeScript（Vite）+ Tailwind CSS v4 + shadcn/ui
- バックエンド: Python (FastAPI)、Tauriのサイドカーとして起動
- LLM推論・Embedding: Ollama（外部LLM APIは使用しない）

## 前提ツール

- [Rust](https://www.rust-lang.org/tools/install)（`rustup`）
- Node.js v20以上
- Python 3.11以上
- [Ollama](https://ollama.com/)（インストール後 `ollama serve` で起動しておく）
- Tauri CLI: `cargo install tauri-cli`

Ollamaのモデル（Embedding用）を事前にpullしておく:

```bash
ollama pull nomic-embed-text
```

## セットアップ

### 1. フロントエンド依存関係のインストール

```bash
npm install
```

### 2. バックエンド（Python）のセットアップ

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..
```

### 3. Tauriサイドカーの実行パス設定を確認

[src-tauri/capabilities/default.json](src-tauri/capabilities/default.json) の `shell:allow-execute` パーミッションで、`backend/.venv/bin/uvicorn` への**絶対パス**を許可しています。プロジェクトを別の場所に配置している場合は、この`cmd`の値をご自身の環境の絶対パスに合わせて修正してください。

```bash
# 自分の環境での絶対パスを確認する例
cd backend && pwd
```

## 開発サーバーの起動

```bash
npm run tauri dev
```

これでVite（フロントエンド）とFastAPI（バックエンド、Tauriのサイドカーとして自動起動）が同時に立ち上がります。

### 動作確認

- アプリウィンドウが起動すること
- 別ターミナルで `curl http://localhost:8000/` を実行し、`{"status":"ok"}` が返ること
- Ollamaが起動していない場合はアプリ内に警告バナーが表示されること（実装済みの場合）
- アプリを終了した後、`ps aux | grep uvicorn` でバックエンドプロセスが残っていないこと

## 開発運用ルール

ブランチ運用・コミットメッセージ・コードレビューのフローについては [AGENTS.md](AGENTS.md) を参照してください。
