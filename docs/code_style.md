# コード規約

> `AGENTS.md`から参照される詳細ドキュメント。Codex（実装担当）・Claude Code（レビュー担当）はここに書かれたルールに従うこと。
> 型チェック・Lintは「バランス型」を採用する。安全性の最低限（型ヒント・strictモード）は維持しつつ、Lint/型エラーではコミットやマージをブロックしない。MVP期間中は速度を優先し、必要になった時点で厳格化する。

---

## フロントエンド（TypeScript / React）

- `tsconfig.json`は`strict: true`を維持する（Tauri + Reactテンプレートのデフォルト設定のまま変更しない）
- 関数コンポーネント + Hooksのみを使用し、クラスコンポーネントは使わない
- ファイル名はコンポーネントが`PascalCase.tsx`、hooks/utilが`camelCase.ts`
- スタイリングは`design.md`7章の方針通りTailwindのユーティリティクラス + shadcn/uiのみを使用し、個別のCSSファイルは作らない
- `src/api/`のクライアント関数は、リクエスト/レスポンスの型を明示的に定義する
- **`any`型の使用を禁止する**。外部由来の値（LLMのJSON応答、APIレスポンス、`JSON.parse()`の戻り値など、実行時まで形が保証されない値）は`unknown`として受け取り、Zod等のスキーマ検証を通して型を確定させてから使う。`unknown`のまま安全でない操作（型ガードなしのプロパティアクセスなど）を行うことは禁止する。ESLintで`@typescript-eslint/no-explicit-any`を有効化し、この項目のみコミット・マージをブロックする
- ESLint + Prettierを導入する。`no-explicit-any`以外のLintエラーは警告として扱い、コミット・マージをブロックしない

## バックエンド（Python / FastAPI）

- 関数シグネチャには型ヒントを必須とする（例: `def create_file(project_folder: str, filename: str, content: str) -> None:`）
- `mypy`などの厳格な型検査ツールはMVP期間中は導入しない
- フォーマッタは`Black`、Lintは`Ruff`（デフォルトのルールセット）を使用する。警告はコミット・マージをブロックしない
- Ollama呼び出し・ファイルI/O・DB操作などI/Oバウンドな処理は`async/await`で統一する
- リクエスト/レスポンスのバリデーションはPydanticモデルで行う
- ビジネスロジックは`backend/services/`に集約し、`backend/api/`はルーティングとリクエスト/レスポンス変換に専念する（設計書のディレクトリ構成に準拠）

## 共通（フロントエンド・バックエンド共通）

- **`for`文・`if`文などの制御構文のネストは2階層までを目安にする**。3階層目が必要になる場合は、早期return・ガード節・関数への抽出で2階層以内に収める

  ```ts
  // TypeScript: NG（3階層）
  for (const file of files) {
    if (file.isMarkdown) {
      for (const chunk of file.chunks) {   // 3階層目 → NG
        if (chunk.isValid) { ... }
      }
    }
  }

  // OK（関数抽出 + 早期returnで2階層以内に収める）
  for (const file of files) {
    if (!file.isMarkdown) continue;
    processChunks(file.chunks);            // ループ内部は別関数に切り出す
  }
  ```

  ```python
  # Python: NG（3階層）
  for file in files:
      if file.is_markdown:
          for chunk in file.chunks:        # 3階層目 → NG
              if chunk.is_valid:
                  ...

  # OK（関数抽出 + 早期continueで2階層以内に収める）
  for file in files:
      if not file.is_markdown:
          continue
      process_chunks(file.chunks)          # ループ内部は別関数に切り出す
  ```

- コメント・docstringは複雑なロジック（RAG検索、互換性判定、パストラバーサル対策など）にのみ書く。自明な処理へのコメントは不要
- `chunk_size`, `top_k`などのマジックナンバーは`design.md`の値をそのまま定数化し、ハードコードを分散させない
- Lint/型エラー自体はブロッカーにしないが、Claude Codeのレビューで重大な型不整合（Noneの未考慮、APIレスポンス型のずれなど）を発見した場合は修正を依頼する
