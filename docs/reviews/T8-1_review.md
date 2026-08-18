# T8-1 レビュー結果

## 第1回レビュー（2026-08-18）— 敵対的検証

**判定: 要修正**（要修正2件、軽微6件）

エンドポイント3本はすべて設計書どおりに登録され、SSE中継・入力検証・キャッシュ・エラー処理はいずれも実測で堅牢だった。一方で、**互換性判定の結果が実データ上で大きく誤る**ことを確認した。開発機（RAM 24GB）で `ollama.com/library` の全234件を実測したところ、**90件（38%）が誤って「ダウンロード不可（赤バッジ・グレーアウト）」になる**。この中には `nomic-embed-text`（本アプリが必須とするEmbeddingモデル）と、サイト掲載順の上位モデル（`llama3.1` / `deepseek-r1` / `qwen3` / `qwen2.5`）が含まれる。この状態のままT8-2を実装すると、設定画面からのモデルDLがほぼ機能しない。

### 検証環境

| 項目 | 内容 |
|---|---|
| バックエンド | `127.0.0.1:8011`（隔離DB `t81.db` ・隔離Chroma。`backend/data/chat.db` は未使用・タイムスタンプ不変） |
| Ollama | 本レビュー用に作成したスタブ `127.0.0.1:11435`（`/api/tags` と `/api/pull` のNDJSONストリームを実装。実Ollamaでのモデルpullは行っていない） |
| モデルカタログ | `https://ollama.com/library` の実HTML（アプリの `GET /ollama/available-models` 経由で取得。234件） |
| 実測RAM | `psutil` 25,769,803,776 バイト = 24.0 GiB（`sysctl -n hw.memsize` と完全一致） |
| レビュー対象 | 作業ツリーの未コミット差分（`backend/api/ollama.py`, `backend/main.py`, `backend/services/model_catalog.py`） |

`POST /ollama/pull` は正常系・上流エラー・不正JSON・接続断・入力検証を含め計30回以上実行した。

---

### 必須要件の検証結果

| 要件（implementation_plan.md T8-1 / design.md 4章・6章） | 実測 |
|---|---|
| `GET /system/specs`: psutilで搭載RAMを返却 | ✅ `{"ram_bytes":25769803776,"ram_gb":24.0}`。`hw.memsize` と一致 |
| `GET /ollama/available-models`: `ollama.com/library` をスクレイピング | ✅ 実HTMLから234件を取得。名前の重複・欠損・記号混入なし |
| モデル名・パラメータ数（`labels: ["8B","70B"]`）を取得 | ⚠️ 形式は仕様どおり。ただし40件で `labels` が空になる（**要修正2**） |
| 互換性判定（design.md 6章のロジックに準拠） | ⚠️ 閾値は完全一致。ただし複数サイズの扱いで誤判定（**要修正1**） |
| 結果はサーバー起動中はメモリにキャッシュ | ✅ 初回 1.371s → 2回目以降 0.0014s（約1000倍）。再スクレイピングなし |
| `POST /ollama/pull`: SSEで進捗をストリーミング | ✅ `text/event-stream` + `data: {...}\n\n`。5行の進捗をリアルタイム中継 |
| エンドポイントのパスがdesign.md 4章と一致 | ✅ `/ollama/status` `/ollama/models` `/ollama/available-models` `/ollama/pull` `/system/specs`（OpenAPIで確認） |
| ロジックを `services/` に分離しAPI層はルーティングに専念（code_style.md） | ✅ HTML解析・互換性判定は `model_catalog.py` に集約 |

**判定閾値そのものは設計書と完全一致**していた。境界値を総当たりで確認した結果：

| 搭載RAM | 必要メモリ | 期待（design.md） | 実測 |
|---|---|---|---|
| 7.5 | 5.0（×1.5） | available | `available` ✅ |
| 7.49 | 5.0 | warning | `warning` ✅ |
| 5.0 | 5.0（×1.0） | warning | `warning` ✅ |
| 4.99 | 5.0 | unavailable | `unavailable` ✅ |

必要メモリのバケット（3B以下→3GB / 7B→5GB / 13B→8GB / 30B→20GB / 70B→40GB）も設計書の表と一致。70B超は比例換算（671B→383.4GB）で、実装サマリーの記述どおり保守的に働いていた。

---

### 要修正1: 複数サイズのモデルを「最大パラメータ数」で判定しており、実行可能なモデルが軒並みDL不可になる

`model_catalog.py` の `parameter_count_billions()` は `max(values)` を返す。その結果、`labels` に大小のサイズが並ぶモデルは**最大サイズだけで1つのバッジが決まる**。

実HTML・実RAM（24GB）での実測：

| モデル | labels | 判定 | 最小サイズ単体なら |
|---|---|---|---|
| `llama3.1` | 8B, 70B, 405B | **unavailable**（req 231.4GB） | 8B → available |
| `deepseek-r1` | 1.5B, 7B, 8B, 14B, 32B, 70B, 671B | **unavailable**（req 383.4GB） | 1.5B → available |
| `qwen3` | 0.6B, 1.7B, 4B, 8B, 14B, 30B, 32B, 235B | **unavailable**（req 134.3GB） | 0.6B → available |
| `qwen2.5` | 0.5B … 72B | **unavailable**（req 41.1GB） | 0.5B → available |
| `codellama` | 7B, 13B, 34B, 70B | **unavailable**（req 40.0GB） | 7B → available |

**「最大サイズで判定したせいで赤になったが、最小サイズ単体なら緑または黄になるモデル」は50件**（234件中21%）。design.md 6章の表は赤バッジを「不可（グレーアウト）」と定義しているため、T8-2をこのAPIの上に素直に実装すると、`llama3.1:8b` や `deepseek-r1:1.5b` のような**24GB機で軽々動くモデルを一切ダウンロードできなくなる**。requirements.md:68「モデル名を指定してOllamaからダウンロード（pull）できる」を満たせない。

なお design.md 6章のモックアップは `llama3.2 [8B]` `llama3.3 [70B]` `deepseek-r1 [671B]` と**1行1サイズ**で描かれており、「複数サイズを1バッジに畳む」こと自体が設計書に無い独自判断である。

**対応案（推奨順）**

1. `labels` の**各サイズごとに互換性を返す**（例: `labels: [{"label":"8B","status":"available","required_memory_gb":8.0}, {"label":"405B","status":"unavailable",...}]`）。設計書のモックアップに最も近く、T8-2でサイズ単位のグレーアウトができる
2. 最低限の修正として、モデル単位のバッジは**最小サイズ**で判定する（DL可能なサイズが1つでもあれば選択可能にする）

いずれを選んでも、判断の理由を design.md 6章に追記すること（AGENTS.md 11章）。

---

### 要修正2: パラメータ表記を取りこぼすモデルが40件あり、すべて `unavailable` に倒れる。`nomic-embed-text` を含む

`PARAMETER_LABEL_PATTERN` は `^\d+(\.\d+)?B$` のみを受理する。`required_memory_gb()` は該当ラベルが1つも無いと `None` を返し、`compatibility_status()` は `required_gb is None` を `unavailable` として扱う。**取得できなかったことと、RAM不足で動かせないことが同じ結果に潰れている。**

実HTMLの生テキストを確認し、原因を4パターンに特定した：

| パターン | サイト上の表記 | 該当モデル例 |
|---|---|---|
| MoE表記 | `8x7b` `8x22b` `16x17b` `128x17b` | `mixtral`, `llama4`, `dolphin-mixtral`, `nous-hermes2-mixtral` |
| M単位（1B未満） | `22m` `33m` | `all-minilm` |
| 実効パラメータ表記 | `e2b` `e4b` | `gemma3n` |
| サイズ表記が無い | （タグは `embedding` のみ） | `nomic-embed-text`, `bge-m3`, `mxbai-embed-large`, `snowflake-arctic-embed`, `granite-embedding` ほか |

最も重いのは **`nomic-embed-text`** で、これは `backend/config.py` の `OLLAMA_EMBEDDING_MODEL` の既定値、つまり**本アプリのRAGが動くために必須のモデル**である。設定画面で赤バッジ・グレーアウトになると、実装計画書 Phase 0 の `ollama pull nomic-embed-text` を設定画面から実行する導線が塞がる。Embeddingモデル群（`all-minilm`, `bge-large`, `bge-m3`, `mxbai-embed-large`, `paraphrase-multilingual`, `snowflake-arctic-embed`, `snowflake-arctic-embed2`, `embeddinggemma`, `granite-embedding`）が例外なく同じ状態になる。

**対応案**

- サイズ不明（`required_memory_gb is None`）は `unavailable` ではなく**判定不能を表す別の値**にし、UI側でグレーアウトせずに扱う（少なくともEmbeddingモデルはDL可能にする）
- `8x7b` 形式は乗算（8×7=56B相当）ではなくアクティブパラメータで見るのが実態に近いが、MVPでは「判定不能」に寄せるだけでも十分
- `137m` / `22m` のようなM単位は `/1000` でB換算すれば正しく最小バケット（3GB）に入る

参考: 現時点のサイト上のPull数は `82.7M` `2.8M` のようにM表記のため、`B$` パターンとは衝突していない（HTML全体を走査して `>数字B<` の出現ゼロを確認済み）。ただしPull数が1B件を超えると**Pull数がパラメータ数として誤解析される**構造になっているので、ラベル抽出はカード内の位置で絞るほうが安全。

---

### 軽微1: サイト掲載順（人気順）を捨ててアルファベット順にしている

`parse_catalog_models()` の `sorted(models_by_name.items())` により、サイト上の並び（`llama3.1`, `deepseek-r1`, `nomic-embed-text`, `llama3.2`, `gemma3`, `qwen2.5` …）が捨てられ、`alfred`, `all-minilm`, `athene-v2`, `aya` … の順になる。234件のテーブルの先頭が無名モデルで埋まるため、design.md 6章のモックアップ（主要モデルが上に来る）と乖離する。掲載順のまま返し、並べ替えはフロント側の裁量に委ねるのが素直。

### 軽微2: `/system/specs` がRAMのみ。design.md は「RAM・GPU」と書かれたまま

design.md 4章のシステムAPI表は `PCスペック取得（RAM・GPU）`。実装計画書 T8-1 の作業内容は「psutil で搭載 RAM を取得して返却」のみで、実装は計画書に忠実だが、**design.md が更新されていない**。AGENTS.md 11章に従い、GPUをMVPスコープ外とするなら design.md 側を「RAM」に修正すること。

### 軽微3: `compatibility_status()` の戻り値型が `str`

`ModelCompatibility.status` は `Literal["available","warning","unavailable"]` なのに、生成元の関数は `-> str`。綴り間違いをしてもmypy不使用のため静的には検出されず、Pydanticのレスポンス検証で初めて500になる。`model_catalog.py` 側にも `Literal` を付けるか、`ModelCompatibility` が参照する型エイリアスを共有するのが安全（code_style.md「重大な型不整合」の予防）。

### 軽微4: Ollamaへ非推奨フィールド `name` を送っている

`json={"name": request_data.model, "stream": True}` としているが、Ollamaの `/api/pull` の現行フィールドは `model` で、`name` は後方互換のための非推奨エイリアス。現状は動作するが、`model` に変更しておくほうが将来の破壊に強い。

### 軽微5: モデル名パターンが任意レジストリのホスト名を許容する

`^[A-Za-z0-9][A-Za-z0-9._:/-]*$` はパストラバーサル（`../../etc/passwd`）・シェルメタ文字（`ok;rm -rf /`）・空白・非ASCII・301文字をすべて422で弾いており、この点は堅牢だった（実測14パターン）。一方 `registry.example.com/ns/model:tag` は200で通り、そのままOllamaに渡る。Ollamaは任意レジストリからpullできるため、**アプリ経由で任意の外部ホストへの通信が発生しうる**（AGENTS.md 9章「新規に外部サーバーへの通信を追加しない」）。設定画面が送る名前はスクレイピング結果に限られるため実害の可能性は低いが、`available-models` のキャッシュに存在する名前だけを受理する、あるいはドットを含むホスト部を拒否する、といった絞り込みを推奨する。

なお、`{"model":"ok","stream":false,"insecure":true}` のような余分なフィールドは**Ollamaへ転送されない**ことをスタブ受信ログで確認済み（`insecure` の注入は不可）。

### 軽微6: 独自判断が design.md に記録されていない

「複数サイズは最大値で判定」「70B超は比例換算」「ラベル取得不能は不可扱い」「アルファベット順に整列」はいずれも設計書に無い判断である。実装サマリーには一部記載があるが、AGENTS.md 11章に従い design.md 8章「その他の設計決定事項」へ追記すること（要修正1・2の対応方針が決まってから、まとめて反映するのがよい）。

---

### 修正不要だが確認した挙動

| 項目 | 実測 |
|---|---|
| SSE正常系 | `pulling manifest` → 進捗2行 → `verifying` → `success` の5イベントを順に中継。ヘッダは `cache-control: no-cache` / `x-accel-buffering: no` / `content-type: text/event-stream` |
| Ollamaがエラー行を返した場合 | `data: {"error": "pull model manifest: file does not exist"}` を**HTTP 200のまま**そのまま中継。T8-2はこのケースを本文で判定する必要がある（設計どおりの中継なので指摘にはしない） |
| ストリーム途中の不正JSON | 直前までの進捗を流したうえで `data: {"error":"モデルのダウンロード進捗を処理できません"}` を出して終了。例外は漏れない |
| 上流の接続断（途中でソケットclose） | 同上のエラーイベントで正常終了。トレースバックなし |
| 上流HTTP 404 / 500 | いずれも502 `モデルのダウンロードを開始できません`。`httpx.HTTPStatusError` を先に捕捉する順序も正しい |
| Ollama停止時 | 503 `Ollamaに接続できません`（requirements.mdのエラーハンドリング要件を満たす） |
| クライアント切断 | スタブ側に `client disconnected mid-stream` が到達。`finally` で `response.aclose()` / `client.aclose()` が走り、バックエンドログにエラー0件。コネクションリークなし |
| スクレイピング失敗時のキャッシュ汚染 | 解析不能時は `ValueError` を投げて `available_models_cache` は `None` のまま。次回リクエストで再試行して正常に復帰することを実測（実装サマリーの記述どおり） |
| ネットワーク不通時 | 502 `モデル一覧を取得できません`。※完全オフラインだと設定画面のモデル一覧は必ず502になる。メッセージにネットワーク要因が示されないため、T8-2で文言を補うとよい |
| 細工されたhref | `/library/<script>` `/library/..%2f..%2fetc` はカタログ名として素通りするが、Reactがエスケープするうえ `POST /pull` 側で422になるため悪用不可 |
| `/library/a/b`・`library/b`・絶対URL | いずれも除外。`model_name_from_link()` は意図どおり |
| RAMの再取得 | キャッシュされるのはカタログのみで、RAMは毎リクエスト取得。仕様どおり |
| 依存関係 | `psutil` `beautifulsoup4` とも `backend/requirements.txt` に既存（追加漏れなし。実環境 psutil 7.2.2 / bs4 4.15.0） |
| アーキテクチャ制約 | Tauri `invoke()` 不使用、Rust側にロジックなし、LLM推論・Embeddingの経路変更なし、ファイル書き込み処理への影響なし |

**軽微な懸念（指摘化しない）**: 初回リクエストが同時多発した場合、`fetch_available_models()` に排他が無いため全リクエストが並行してスクレイピングする。設定画面を開く操作は1回なので実害はない。

---

### 静的チェック

| コマンド | 結果 |
|---|---|
| `backend/.venv/bin/black --check backend/api/ollama.py backend/services/model_catalog.py backend/main.py` | 3 files would be left unchanged ✅ |
| `backend/.venv/bin/ruff check backend/` | All checks passed ✅ |
| `git diff --check` | 問題なし ✅ |

フロントエンドは本タスクで未変更のため、lint / build は実施していない。

---

### マージ前に対応が必要なこと

1. **要修正1・要修正2を修正する**（設定画面の中核機能が成立しないため）
2. 修正方針を design.md 6章／8章に反映する（軽微2・軽微6を含む）
3. **`feature/t8-model-api` にコミットが1件も無い**（4ファイルすべて未コミット。12回連続）。`T8-1: PCスペック取得とモデル一覧APIを実装` の形式でコミットすること
4. `docs/reviews/T8-1_impl.md` に修正内容を追記のうえ、再レビューを依頼すること

### 次のタスク

T8-1が承認されたら **T8-2（設定画面の実装）**。T8-2は本APIの `compatibility.status` をそのままバッジとグレーアウトに使うため、上記2件の修正が前提となる。

---

## 第2回レビュー（2026-08-18）— 敵対的検証

**判定: 要修正**（要修正1件、新規の軽微3件）

第1回の指摘8件のうち7件は解消を確認した。**要修正1（複数サイズを最大値で判定）は `variants` 化によって完全に解消**しており、設計書への反映も適切だった。

一方、**要修正2の修正（M単位の換算）が新たな誤りを持ち込んだ**。`PARAMETER_LABEL_PATTERN` に `M` を追加したことで、モデルカード内に並んでいる **Pull数（`82.7M` など）がパラメータサイズとして解析される**ようになった。実HTMLで **234件中117件（50%）** が影響を受け、そのうち7件では**Pull数が唯一のラベル**になっている。7件の筆頭が `nomic-embed-text`——第1回の要修正2で問題にした当のモデルである。

### 検証環境

| 項目 | 内容 |
|---|---|
| バックエンド | `127.0.0.1:8012`（隔離DB `t81b.db` ・隔離Chroma）＋ ASGITransportによるインプロセス検証。`backend/data/chat.db` は未使用・タイムスタンプ不変（Aug 17 21:25） |
| Ollama | 第1回と同じスタブ `127.0.0.1:11435`（実Ollamaでのpullは行っていない） |
| モデルカタログ | `https://ollama.com/library` の実HTML（234件）。第1回の取得結果 `avail.json` と今回の `avail2.json` を突き合わせて差分を評価 |
| 実測RAM | 24.0 GiB |
| レビュー対象 | 作業ツリーの未コミット差分（`backend/api/ollama.py`, `backend/main.py`, `backend/services/model_catalog.py`, `docs/design.md`） |

---

### 第1回指摘への対応状況

| 指摘 | 状態 | 実測 |
|---|---|---|
| 要修正1: 複数サイズを最大値で判定 | **解消** | `variants` にサイズ単位で `label` / `pull_model` / `compatibility` を返すようになった。`llama3.1` は `8b`=available / `70b`=unavailable / `405b`=unavailable と正しく分かれる。第1回に「最小サイズなら緑なのに赤」だった50件がすべて解消 |
| 要修正2: ラベル取得漏れが全て `unavailable` | **未解消（形を変えて再発）** | `unknown` の導入とM単位換算そのものは正しい。しかしPull数の混入により別の誤りが生じた（**要修正A**） |
| 軽微1: アルファベット順 | **解消** | `sorted()` を削除。掲載順 `llama3.1, deepseek-r1, nomic-embed-text, llama3.2, gemma3, qwen2.5, qwen3, mistral` がサイトと一致 |
| 軽微2: design.md が「RAM・GPU」のまま | **解消** | 4章を「RAM」に修正し、8章にMVPスコープの根拠を追記 |
| 軽微3: `compatibility_status` の戻り値が `str` | **解消** | `CompatibilityStatus = Literal[...]` をサービス層に定義し、`ModelCompatibility.status` と共有 |
| 軽微4: 非推奨フィールド `name` | **解消** | `json={"model": ...}` に変更。スタブ受信ログで確認 |
| 軽微5: 任意レジストリを許容 | **解消** | `registry.example.com/ns/model:tag` `hf.co/user/model` とも400。ただし副作用あり（**軽微A**） |
| 軽微6: 独自判断が未記録 | **解消** | design.md 6章に「判定不能」行、8章に3行を追記。第1回で指摘したdesign.md全体の再フォーマットも起きておらず、差分は10行に収まっている |

---

### 要修正A: Pull数がパラメータサイズとして解析され、存在しないタグがダウンロード候補になる

`PARAMETER_LABEL_PATTERN` を `^(\d+(?:\.\d+)?)([BM])$` に拡張した結果、モデルカード内の**Pull数**（`82.7M`、`118.6M` など）が条件を満たしてしまう。`extract_parameter_labels()` はカード内の全テキストノードを対象にするため、これがそのまま `labels` に入る。

実HTMLで、各カードの「Pulls」直前のテキスト＝Pull数を取り出し、`labels` と突き合わせた結果：

- **Pull数が `labels` に混入したモデル: 234件中117件（50%）**
- **Pull数が唯一のラベルになったモデル: 7件**

| モデル | Pull数 | 生成された labels | 生成された pull_model |
|---|---|---|---|
| `nomic-embed-text` | 82.7M | `['82.7M']` | **`nomic-embed-text:82.7m`**（存在しないタグ） |
| `llama3.1` | 118.6M | `['8B','70B','405B','118.6M']` | `llama3.1:118.6m` |
| `deepseek-r1` | 91.5M | `[... '671B','91.5M']` | `deepseek-r1:91.5m` |
| `mistral` | 32M | `['7B','32M']` | `mistral:32m` |
| `mixtral` | 2.8M | `['8X7B','8X22B','2.8M']` | `mixtral:2.8m` |
| `openhermes` / `glm-ocr` / `glm-5.1` / `glm-4.7-flash` / `minimax-m2.7` / `qwen3-coder-next` | 1.1M〜7M | Pull数のみ | 同上 |

M単位のPull数は必ず1B未満に換算されるため、必要メモリは常に最小バケット（3GB）になり、**全て緑バッジ `available` になる**。全536 variants中 `available` は364件だが、**そのうち117件（32%）はこの偽variant**である。

最も重いのは再び `nomic-embed-text` で、`labels` が非空になったため `to_available_model_response()` の `(model.labels or [None])` フォールバックが働かず、**素の `nomic-embed-text` という正しいpull対象が variants から消えた**。設定画面が variants を並べると、提示されるのは `nomic-embed-text:82.7m` だけになり、押しても必ず失敗する。第1回で「グレーアウトされてDLできない」と指摘した状態が、「緑バッジだが押すと失敗する」に変わっただけで、**アプリ必須のEmbeddingモデルを設定画面から入れられない点は解消していない**。

なお `POST /ollama/pull` のゲートは `is_catalog_pull_model()` でカタログ照合するため、`nomic-embed-text:82.7m` は**400ではなく200で通過し、そのままOllamaへ送られる**ことを実測した。バリデーションでは止まらない。

**対応案**

- ラベル抽出をカード内の**サイズ表示要素に限定する**（Pull数・Tags数・更新日時が入らない位置で絞る）。現状の「カード内の全テキストを総なめ」方式は、サイトの表示項目が増えるたびに同種の誤検出を生む
- 位置での絞り込みが難しければ、少なくとも「Pulls」「Tags」といった直後のラベルを見て除外する、あるいは**M単位は既知のサイズ表記に限る**などのガードを入れる
- 併せて、`labels` が非空でも**素のモデル名の variant を常に含める**と、タグ推定を誤っても既定タグでのDLに逃げられる

---

### 軽微A（新規）: pullがカタログ取得に依存し、オフライン時に恒久的に409になる

軽微5の対策として `available_models_cache is None` なら409を返す実装になったが、`pull` は `fetch_available_models()` を呼ばず**キャッシュを直接参照するだけ**なので、自力では復旧しない。到達不能なライブラリURLで実測した結果：

```
オフライン時 available-models -> 502 モデル一覧を取得できません
オフライン時 pull            -> 409 モデル一覧を先に取得してください
```

「モデル一覧を先に取得してください」と案内されるが、その取得ができない状況なので**ユーザーは詰む**。バックエンド（Tauriサイドカー）を再起動しただけでもキャッシュは消えるため、設定画面を開き直さずにDLボタンを押すと409になる。AGENTS.md 9章「完全ローカル動作が絶対要件」に照らすと、**ローカルOllamaへのpullが外部サイトの到達性に依存する**構図は避けたい。

**対応案**: `pull` 側で `fetch_available_models()` を呼んで再取得を試みる（それでも失敗したら502＋ネットワーク要因を示す文言）。あるいは、カタログ照合ではなく「`/` を含む名前を拒否する」など**ネットワークに依存しない検証**に切り替える。後者なら軽微5の目的（任意レジストリの禁止）は同等に達成できる。

### 軽微B（新規）: `extract_parameter_labels()` の重複判定が大文字化前の値で行われている

```python
if not is_parameter_label(normalized) or normalized in labels:
    continue
labels.append(normalized.upper())
```

比較は `normalized`（原文のまま）、格納は `normalized.upper()` なので、`["8B", "8b"]` の順で来ると `['8B', '8B']` と重複する（実測）。`parse_catalog_models()` 側に大文字同士での二重チェックがあるため現状の出力には現れないが、関数単体では壊れている。`normalized = normalized.upper()` を先に済ませるのが素直。

### 軽微C（新規）: `labels` と `variants` が二重に出ており、`labels` は汚染されたまま

`AvailableModelResponse` は `labels`（文字列配列）と `variants`（判定付き）の両方を返す。design.md 6章のモックアップはモデル名の横にサイズを表示するため、T8-2が `labels` を表示に使うと**要修正Aの偽ラベルがそのまま画面に出る**。要修正Aを直せば実害は消えるが、情報源が二重にあること自体が誤用を招くので、`labels` を落として `variants` に一本化することを推奨する。

---

### 修正が何も壊していないことの確認

| 項目 | 実測 |
|---|---|
| 判定閾値 | ×1.5 / ×1.0 の境界は第1回と同一（ram 7.5→available、7.49→warning、5.0→warning、4.99→unavailable） |
| 必要メモリのバケット | 3B以下→3 / 7B→5 / 13B→8 / 30B→20 / 70B→40、70B超は比例換算。design.md の表と一致 |
| `unknown` の導入 | MoE（`8X7B`, `16X17B`）・実効パラメータ（`E2B`, `E4B`）・ラベル無しはすべて `unknown` で `required_memory_gb: null`。DL禁止にならない |
| M単位の換算 | `270M` → 0.27B → 3.0GB（`gemma3:270m` が正しく available）。`22M` / `33M`（`all-minilm`）も同様 |
| pull名の生成 | ラベルを小文字化して `name:tag` を組む。`mixtral:8x7b` `gemma3n:e2b` `deepseek-r1:1.5b` とも実在タグの形式に一致 |
| pullゲート | 実在の組み合わせ15パターンを実測。`llama3.1:8b` `llama3.1`（素）`mixtral:8x7b` は200、`llama3.1:9b` `llama3.1:8B`（大文字）`nomic-embed-text:latest` `llama3.1:8b:extra` `unknown-model` `registry.example.com/...` `hf.co/...` は400 |
| 入力検証（第1回から不変） | パストラバーサル・シェルメタ文字・空白・非ASCII・301文字・型違いはすべて422 |
| SSE中継 | 正常系5イベント、上流のエラー行の素通し、途中の不正JSON、上流の突然の切断、上流404/500→502、Ollama停止→503 をすべて再実測。第1回と同一の挙動で、バックエンドログの例外0件 |
| キャッシュ | 初回 1.57s → 2回目以降 0.001s。解析失敗時はキャッシュを汚さない |
| 掲載順 | サイトの並びを保持（`sorted()` 削除の効果を確認） |
| DL可能なモデル数 | 第1回 117/234 → 第2回 214/234。要修正1の解消による改善が大半で、偽variantのみで可になっているのは7件 |
| アーキテクチャ制約 | Tauri `invoke()` 不使用、Rust側にロジックなし、ファイル書き込み・確認/自走モードへの影響なし |
| design.md の差分 | 10行のみ。第1回で指摘した「全体再フォーマット」は起きていない |

---

### 静的チェック

| コマンド | 結果 |
|---|---|
| `backend/.venv/bin/black --check backend/api/ollama.py backend/services/model_catalog.py backend/main.py` | 3 files would be left unchanged ✅ |
| `backend/.venv/bin/ruff check backend/` | All checks passed ✅ |
| `git diff --check` | 問題なし ✅ |

---

### マージ前に対応が必要なこと

1. **要修正Aを修正する**（`nomic-embed-text` を設定画面から入れられない状態が続いているため）
2. 軽微A（オフライン時の409）を解消する。ローカル動作要件に直接関わる
3. **`feature/t8-model-api` にコミットが1件も無い**（5ファイルすべて未コミット。13回連続）
4. `docs/reviews/T8-1_impl.md` に今回の対応を追記のうえ、再レビューを依頼すること

---

## 第3回レビュー（2026-08-18）— 敵対的検証

**判定: 承認**（軽微2件。うち軽微1はマージ前の対応を推奨）

第2回の指摘4件はすべて解消を確認した。特に要修正A（Pull数の混入）は**外科的に正確**で、実HTMLで意図した117件だけがきれいに落ち、本物のサイズラベルは1件も巻き込まれていない。T8-1の必須要件はこれで全て満たされ、コード面ではマージして差し支えない。

残る指摘は、第2回で私が提案した「素のモデル名のvariantを常に含める」という対策の副作用が1件と、Pull数除外ロジックの堅牢性が1件である。

### 検証環境

| 項目 | 内容 |
|---|---|
| バックエンド | `127.0.0.1:8013`（隔離DB `t81d.db` ・隔離Chroma）。`backend/data/chat.db` は未使用・タイムスタンプ不変（Aug 17 21:25） |
| Ollama | 第1回・第2回と同じスタブ `127.0.0.1:11435`（実Ollamaでのpullは行っていない） |
| モデルカタログ | `https://ollama.com/library` の実HTML（234件）。第2回の `avail2.json` と今回の `avail3.json` をラベル単位で全件突き合わせ |
| 実測RAM | 24.0 GiB |
| レビュー対象 | 作業ツリーの未コミット差分（`backend/api/ollama.py`, `backend/main.py`, `backend/services/model_catalog.py`, `docs/design.md`） |

---

### 第2回指摘への対応状況

| 指摘 | 状態 | 実測 |
|---|---|---|
| 要修正A: Pull数がサイズとして解析される | **解消** | `is_pull_count()` による除外。実HTMLで**除外されたのはちょうど117件**（第2回に混入を確認した件数と完全一致）。第2回→第3回のラベル差分を全234件で比較したところ、**変化したのは「Pull数のみが消えた」117件だけで、それ以外の変化は0件**。本物のサイズの巻き込みなし |
| 軽微A: オフライン時にpullが409で詰む | **解消** | カタログ照合を廃止。**カタログ未取得の状態で `POST /ollama/pull` を叩いて200**（SSE中継まで到達）。外部レジストリ拒否は `"/" in model` による判定に置き換わり、ネットワーク非依存になった |
| 軽微B: 重複判定が大文字化前の値 | **解消** | `["8B","8b"]` `["8b","8B"]` `["8b","8b"]` いずれも `['8B']`。先に `upper()` してから比較する形に修正済み |
| 軽微C: `labels` と `variants` の二重出力 | **解消** | レスポンスのキーは `['name','variants']` のみ。design.md にも「`variants`のみを表示とダウンロード対象に使用する」と明記 |

`nomic-embed-text` は variants が `[{label: null, pull_model: "nomic-embed-text", status: "unknown"}]` の1件だけになり、**素の名前で正しくダウンロードできる状態**になった。第1回から追っていた問題はこれで解消している。

---

### 軽微1（新規・マージ前の対応を推奨）: 全サイズが赤のモデルでも、素の名前のvariantが灰バッジでダウンロード可能

`to_available_model_response()` の `for label in [None, *model.labels]` により、**全モデルに必ず素の名前のvariantが付く**。素の名前はサイズが不明なので常に `unknown`（灰バッジ＝design.md上は「可」）になる。

その結果、**サイズ付きvariantが全て `unavailable`（赤・グレーアウト）なのに、同じモデルの素の名前だけが灰バッジでダウンロードできる**モデルが27件生じている。うち26件は**サイズがそもそも1つしかない**ため、素の名前が指す既定タグは実質そのサイズであり、判定不能で通す理由がない。

| モデル | 唯一のサイズ | 必要メモリ | 素の名前のvariant |
|---|---|---|---|
| `deepseek-v3` / `deepseek-v3.1` / `cogito-2.1` | 671B | 383.4GB | `unknown`（灰・DL可） |
| `dbrx` | 132B | 75.4GB | 同上 |
| `mistral-large` / `devstral-2` | 123B | 70.3GB | 同上 |
| `command-a` | 111B | 63.4GB | 同上 |
| `llama3.3` / `nemotron` / `reflection` / `firefunction-v2` | 70B | 40.0GB | 同上 |
| `qwq` / `olmo-3.1` / `wizardcoder` / `nemotron3` ほか | 32〜35B | 40.0GB | 同上 |

24GB機で `deepseek-v3` の灰バッジを押すと、383GB相当のモデルのダウンロードが始まる。design.md 6章が「ダウンロード不可＝グレーアウト」で防ごうとしていたのはまさにこのケースで、素の名前のvariantがその門を横からすり抜けている。

第2回で私が「タグ推定を誤っても既定タグに逃げられるよう、素の名前のvariantを常に含める」と提案した副作用である。提案の意図（`nomic-embed-text` のようにサイズ表記が無いモデルを救う）は達成されているので、**サイズが1つしかないモデルでは素の名前にそのサイズの判定を継承させる**だけで十分に塞げる。複数サイズのモデルは既定タグが最小サイズとは限らない（`gemma3:latest` は 4b で最小の 270m ではない）ため、`unknown` のままで妥当。

### 軽微2（新規・任意）: Pull数の除外が「直後のテキストが `Pulls`」という位置依存の判定になっている

`is_pull_count()` は「次のテキストノードが `pulls`」かどうかだけを見る。現在のサイトでは全234カードに `Pulls` があり（実測）、`Pulls` 直前の値の末尾は `K` か `M` のみ、かつPull数と同じ表記のサイズが同一カード内に別途存在するケースも0件なので、**今は完全に正しく効いている**。

ただし構造的には次の2点で崩れる。実測で確認した：

| 入力 | 結果 |
|---|---|
| `["1B","Downloads","3B"]`（サイトが `Pulls` を別語に改称） | `['1B','3B']` — ガードが効かず、Pull数が再び混入する |
| `["7B","Pulls"]`（本物のサイズの直後が `Pulls`） | `[]` — 本物のサイズを落とす |

いずれも現在のHTMLでは発生しないので実害はないが、第1回・第2回とも**この「カード内の全テキストを総なめする」方式が誤検出の温床**になっている。サイズ表示のDOM位置（親要素やクラス）で絞り込めば、サイトの表示項目が増減しても壊れにくくなる。MVPのスコープを踏まえると今すぐ直す必要はないが、モデル一覧が空になる・明らかに変な値が出るといった不具合が出たら真っ先に疑う箇所として記録しておく。

---

### 修正が何も壊していないことの確認

| 項目 | 実測 |
|---|---|
| モデル件数・掲載順 | 234件、`llama3.1, deepseek-r1, nomic-embed-text, llama3.2, gemma3, qwen2.5` とサイトの並びを維持 |
| variants | 636件（素の名前234＋サイズ402）。内訳は available 247 / unknown 247 / unavailable 92 / warning 50 |
| 要修正1（第1回）の解消継続 | `llama3.1` は `8b`=available / `70b`=unavailable / `405b`=unavailable。サイズ単位の判定は維持されている |
| 判定閾値 | ×1.5 / ×1.0 の境界は3回とも同一（7.5→available、7.49→warning、5.0→warning、4.99→unavailable） |
| 必要メモリのバケット | 3B以下→3 / 7B→5 / 13B→8 / 30B→20 / 70B→40、70B超は比例換算。design.md の表と一致 |
| M単位・MoE・実効パラメータ | `270M`→3.0GB / `22M`→3.0GB は available、`8X7B` `E2B` `E4B` は `unknown`。pull名は `gemma3:270m` `mixtral:8x7b` `gemma3n:e2b` と実在タグの形式 |
| pullゲート | `registry.example.com/ns/model:tag` `hf.co/user/model` `library/ok` `a/b` は400、`/leading` は422。スラッシュを含まない名前は200で通る（カタログ照合を外した意図どおり。存在しない名前はOllamaがエラー行を返す） |
| 入力検証 | パストラバーサル・シェルメタ文字・空白・非ASCII・先頭記号・空文字・型違い・301文字はすべて422（第1回から不変） |
| SSE中継 | 正常系5イベント／上流のエラー行の素通し／途中の不正JSON／上流の突然の切断／上流404・500→502／Ollama停止→503 を再実測。3回とも同一の挙動で、バックエンドログの例外0件 |
| キャッシュ | 初回 1.01s → 2回目以降ミリ秒。解析失敗時はキャッシュを汚さない |
| 解析不能HTML | 空・JSのみのページとも `[]` → 502。細工した `href` は名前として残るが、Reactのエスケープと `POST /pull` の422で悪用不可 |
| design.md | 差分13行のみ。8章に「pull対象の制限」を追記済み。全体再フォーマットは今回も起きていない |
| アーキテクチャ制約 | Tauri `invoke()` 不使用、Rust側にロジックなし、ファイル書き込み・確認/自走モードへの影響なし、Ollama以外へのランタイム通信は設計書が明示したカタログ取得のみ |

**指摘化しない留意点**: `available_models_cache` は起動中に一度だけ埋まり、再取得の手段がない（design.md の「毎回スクレイピングしない」に忠実なので仕様どおり）。また初回リクエストが同時多発すると排他が無いため並行してスクレイピングするが、設定画面を開く操作は1回なので実害はない。

---

### 静的チェック

| コマンド | 結果 |
|---|---|
| `backend/.venv/bin/black --check backend/api/ollama.py backend/services/model_catalog.py backend/main.py` | 3 files would be left unchanged ✅ |
| `backend/.venv/bin/ruff check backend/` | All checks passed ✅ |
| `git diff --check` | 問題なし ✅ |

---

### マージ前に対応が必要なこと

1. 軽微1（サイズが1つしかないモデルの素の名前variant）を塞ぐことを推奨する。コード面のブロッカーではないが、T8-2でグレーアウトを実装する前に決着させたほうが手戻りが少ない
2. **`feature/t8-model-api` にコミットが1件も無い**（5ファイルすべて未コミット。14回連続）。`T8-1: PCスペック取得とモデル一覧APIを実装` の形式でコミットすること。コミットさえ行えば、コード面ではマージして差し支えない

### 次のタスク

**T8-2（設定画面の実装）**。`variants` をサイズ単位の行として描画し、`available`=緑 / `warning`=黄 / `unavailable`=赤（グレーアウト）/ `unknown`=灰 の4状態をバッジに割り当てる。素の名前のvariant（`label: null`）の見せ方は軽微1の対応方針に合わせること。

---

## 第4回レビュー（2026-08-18）— 敵対的検証

**判定: 承認**（新規の指摘なし。第3回の軽微2が任意対応として残る）

第3回の軽微1は解消を確認した。今回は新たな指摘が出ていない。**T8-1はコミットすればマージしてよい状態にある。**

### 検証環境

| 項目 | 内容 |
|---|---|
| バックエンド | `127.0.0.1:8014`（隔離DB `t81e.db` ・隔離Chroma）＋ ASGITransportによるインプロセス検証。`backend/data/chat.db` は未使用・タイムスタンプ不変（Aug 17 21:25） |
| Ollama | 1〜3回目と同じスタブ `127.0.0.1:11435`（実Ollamaでのpullは行っていない） |
| モデルカタログ | `https://ollama.com/library` の実HTML（234件）。第3回の `avail3.json` と今回の `avail4.json` を variant 単位で全件突き合わせ |
| 実測RAM | 24.0 GiB |
| レビュー対象 | 作業ツリーの未コミット差分（`backend/api/ollama.py`, `backend/main.py`, `backend/services/model_catalog.py`, `docs/design.md`） |

---

### 第3回指摘への対応状況

| 指摘 | 状態 | 実測 |
|---|---|---|
| 軽微1: 全サイズが赤でも素の名前が灰でDL可 | **解消** | `default_variant_label()` + `compatibility_status(ram_gb, default_label or label)` による継承。**「全サイズ赤なのに素の名前が赤でない」モデルは27件→1件**に減少 |
| 軽微2: Pull数除外が位置・文言依存 | **未対応（任意のまま）** | 第3回の指摘時点で「MVPでは今すぐ直す必要はない」と記載したとおり。実HTMLでは引き続き正しく動作している |

継承ロジックは条件分岐として正しい。`len(labels) != 1` のとき `default_label` は `None` になり `default_label or label` が `label` に落ちるため、**複数サイズ・サイズ不明のモデルは従来どおりの判定を保つ**。実測でも第3回から変化したのは単一サイズモデル105件だけで、他は1件も動いていない。

| モデル | サイズ | 素の名前のvariant（第3回 → 第4回） |
|---|---|---|
| `deepseek-v3` | 671B（383.4GB） | `unknown`（灰・DL可）→ **`unavailable`**（赤） |
| `llama3.3` | 70B（40.0GB） | `unknown` → **`unavailable`** |
| `command-a` | 111B（63.4GB） | `unknown` → **`unavailable`** |
| `qwq` / `alfred` | 32B / 40B（40.0GB） | `unknown` → **`unavailable`** |
| `mistral` | 7B（5.0GB） | `unknown` → **`available`**（正しく緑に昇格） |
| `phi4` | 14B（20.0GB） | `unknown` → **`warning`** |
| `llama3.1` | 8B/70B/405B（複数） | `unknown` のまま（既定タグを推定できないため妥当） |
| `nomic-embed-text` | なし | `unknown` のまま（サイズ表記が無いモデルの救済は維持） |
| `mixtral` / `gemma3n` | MoE / 実効パラメータのみ | `unknown` のまま（`nous-hermes2-mixtral` `notux` のように単一MoE表記のモデルも `unknown` を継承） |

**「単一サイズ＝既定タグはそのサイズ」という前提が実データで成立するか**も検証した。ライブラリのカードにサイズの省略表記（`…` や `+N`）を持つモデルは**0件**で、カードに出ているサイズがそのモデルの全サイズである。サイズ数の分布は 0個=24件 / 1個=107件 / 2個=59件 / 最大8個で、継承が効くのは1個の107件のみ。前提は崩れていない。

### 残存事項（指摘化しない）

- **`r1-1776` の1件のみ、全サイズ（70B・671B）が赤なのに素の名前は `unknown` のまま。** 複数サイズのモデルは既定タグを推定できないため、第3回で私が示した対応範囲（単一サイズのみ継承）どおりの結果であり、実装の誤りではない。気になる場合は「全サイズが `unavailable` なら素の名前も `unavailable`」を足せば塞げる
- **単一サイズのモデルは、素の名前とサイズ付きの2行が同じバッジで並ぶ**（例: `llama3.3` と `llama3.3:70b` がどちらも赤）。T8-2では素の名前の行をどう見せるか（「既定」と表示する／サイズ付きがある場合は隠す）を決める必要がある
- **`POST /ollama/pull` は互換性を検証しない。** `deepseek-v3`（赤）を直接叩けば200で通る（実測）。design.md の「不可（グレーアウト）」はUI側のルールであり、サーバ側で強制するとカタログ取得への依存が復活する（第2回 軽微A）ため、この切り分けは妥当。**T8-2はグレーアウトを必ずクライアント側で実装すること**
- **コールドキャッシュ時の同時リクエストは排他されない。** 同時8リクエストで**実スクレイピング8回**を実測した。結果は同一で不整合は起きないが、React StrictModeの二重実行で2回走る点は認識しておくとよい。1回あたり1〜1.6秒

---

### 修正が何も壊していないことの確認

| 項目 | 実測 |
|---|---|
| モデル件数・掲載順 | 234件、`llama3.1, deepseek-r1, nomic-embed-text, llama3.2, gemma3` とサイトの並びを維持 |
| variants | 636件（素の名前234＋サイズ402）。内訳は available 312 / unknown 142 / unavailable 118 / warning 64（継承により unknown が105件減り、各状態へ再配分された） |
| Pull数の除外 | 合成HTMLでも `1.2M` + `Pulls` の組が正しく除外されることを確認。第3回で確認した117件の除外は維持 |
| 判定閾値 | ×1.5 / ×1.0 の境界は4回とも同一 |
| 必要メモリのバケットと70B超の比例換算 | design.md の表と一致 |
| `/system/specs` | `{"ram_bytes":25769803776,"ram_gb":24.0}`。`hw.memsize` と一致 |
| pullゲート | `registry.example.com/ns/m:t` `hf.co/u/m` `a/b` は400、スラッシュを含まない名前は200。カタログ未取得の状態でも200（第2回 軽微Aの解消を維持） |
| 入力検証 | パストラバーサル・シェルメタ文字・空白・非ASCII・先頭記号・空文字・型違いはすべて422 |
| SSE中継 | 正常系5イベント／上流のエラー行1件／不正JSON2件（進捗＋エラー）／突然の切断1件／上流404・500→502／Ollama停止→503。4回とも同一 |
| クライアント切断 | スタブ側に `client disconnected mid-stream` が到達。バックエンドログの例外0件 |
| キャッシュ | 2回目以降はミリ秒応答 |
| design.md | 差分13行のみ。8章の「モデル互換性の単位」に継承ルールを追記済み。全体再フォーマットは4回とも起きていない |
| アーキテクチャ制約 | Tauri `invoke()` 不使用、Rust側にロジックなし、ファイル書き込み・確認/自走モードへの影響なし、ランタイムの外部通信は設計書が明示したカタログ取得のみ |

---

### 静的チェック

| コマンド | 結果 |
|---|---|
| `backend/.venv/bin/black --check backend/api/ollama.py backend/services/model_catalog.py backend/main.py` | 3 files would be left unchanged ✅ |
| `backend/.venv/bin/ruff check backend/` | All checks passed ✅ |
| `git diff --check` | 問題なし ✅ |

---

### マージ前に対応が必要なこと

**`feature/t8-model-api` にコミットが1件も無い**（5ファイルすべて未コミット。15回連続）。`T8-1: PCスペック取得とモデル一覧APIを実装` の形式でコミットすること。コミットさえ行えば、コード面ではマージして差し支えない。

### 次のタスク

**T8-2（設定画面の実装）**。上記「残存事項」の3点（素の名前の行の見せ方、グレーアウトのクライアント側実装、StrictModeでの二重取得）をT8-2の実装時に考慮すること。
