import {
  Download,
  Moon,
  Settings as SettingsIcon,
  Sun,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  getAvailableModels,
  streamOllamaPull,
  type AvailableModel,
  type AvailableModelVariant,
  type ModelCompatibility,
} from "@/api/ollama";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress, ProgressLabel } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useThemeStore } from "@/store/themeStore";

type PullState = {
  error: string | null;
  isInProgress: boolean;
  model: string;
  progress: number | null;
  status: string;
};

type ModelCategory = {
  count: number;
  family: string;
};

const MODEL_FAMILY_PATTERN = /^[a-z]+/;
// モデルが1件しかないファミリーはボタンを増やしすぎるため「その他」にまとめる。
const MIN_MODELS_PER_CATEGORY = 2;
// ファミリー名は英数字のみなので、記号を含む値は実在のファミリーと衝突しない。
const OTHER_CATEGORY = "__other__";

const compatibilityLabels: Record<ModelCompatibility["status"], string> = {
  available: "ダウンロード可能",
  unavailable: "ダウンロード不可",
  unknown: "判定不能",
  warning: "動作が重くなる可能性",
};

const compatibilityClasses: Record<ModelCompatibility["status"], string> = {
  available: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  unavailable: "bg-destructive/15 text-destructive",
  unknown: "bg-muted text-muted-foreground",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

function formatMemory(requiredMemoryGb: number | null): string {
  return requiredMemoryGb === null
    ? "必要メモリ: 判定不能"
    : `必要メモリ: 約${requiredMemoryGb}GB`;
}

function formatPullStatus(status: string): string {
  const labels: Record<string, string> = {
    success: "ダウンロードが完了しました",
    "pulling manifest": "マニフェストを取得しています",
    "verifying sha256 digest": "ダウンロード内容を検証しています",
    "writing manifest": "マニフェストを書き込んでいます",
    "removing any unused layers": "不要なレイヤーを整理しています",
  };
  const translated = labels[status];
  if (translated) {
    return translated;
  }
  if (status.startsWith("pulling ")) {
    return "レイヤーをダウンロードしています";
  }
  return status;
}

function visibleVariants(model: AvailableModel): AvailableModelVariant[] {
  const labeledVariants = model.variants.filter((variant) => variant.label);
  return labeledVariants.length === 1 ? labeledVariants : model.variants;
}

// モデル名先頭の英字部分をファミリー名とする（例: qwen2.5-coder → qwen、gpt-oss → gpt）。
function getModelFamily(modelName: string): string {
  const normalizedName = modelName.toLowerCase();
  return (
    normalizedName.match(MODEL_FAMILY_PATTERN)?.[0] ??
    normalizedName.split(/[-.:_]/)[0]
  );
}

function buildModelCategories(models: AvailableModel[]): ModelCategory[] {
  const counts = new Map<string, number>();
  for (const model of models) {
    const family = getModelFamily(model.name);
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }
  return [...counts]
    .map(([family, count]) => ({ count, family }))
    .filter((category) => category.count >= MIN_MODELS_PER_CATEGORY)
    .sort(
      (left, right) =>
        right.count - left.count || left.family.localeCompare(right.family),
    );
}

function matchesCategory(
  model: AvailableModel,
  selectedCategory: string | null,
  categoryFamilies: Set<string>,
): boolean {
  const family = getModelFamily(model.name);
  if (selectedCategory === OTHER_CATEGORY) {
    return !categoryFamilies.has(family);
  }
  return selectedCategory === null || family === selectedCategory;
}

function isRequiredEmbeddingModel(
  pullModel: string,
  embeddingModel: string | null,
): boolean {
  if (!embeddingModel) {
    return false;
  }
  return pullModel.split(":", 1)[0] === embeddingModel.split(":", 1)[0];
}

function CompatibilityBadge({
  compatibility,
}: {
  compatibility: ModelCompatibility;
}) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
        compatibilityClasses[compatibility.status],
      )}
    >
      {compatibilityLabels[compatibility.status]}
    </span>
  );
}

function ModelRow({
  model,
  embeddingModel,
  pullState,
  variant,
  onPull,
}: {
  model: AvailableModel;
  embeddingModel: string | null;
  pullState: PullState | null;
  variant: AvailableModelVariant;
  onPull: (modelName: string) => void;
}) {
  const isPulling = pullState?.model === variant.pull_model;
  const isDownloadable =
    variant.compatibility.status === "available" ||
    variant.compatibility.status === "warning" ||
    isRequiredEmbeddingModel(variant.pull_model, embeddingModel);
  const isDownloadInProgress = pullState?.isInProgress ?? false;
  const displayName = variant.label
    ? `${model.name}:${variant.label.toLowerCase()}`
    : model.name;

  return (
    <tr className="border-b last:border-0">
      <td className="px-4 py-3 align-top font-medium">{displayName}</td>
      <td className="px-4 py-3 align-top text-muted-foreground">
        {formatMemory(variant.compatibility.required_memory_gb)}
      </td>
      <td className="px-4 py-3 align-top">
        <CompatibilityBadge compatibility={variant.compatibility} />
      </td>
      <td className="px-4 py-3 text-right align-top">
        <Button
          disabled={!isDownloadable || isDownloadInProgress}
          size="sm"
          variant="outline"
          title={
            isDownloadable
              ? undefined
              : "必要メモリを判定できないためダウンロードできません"
          }
          onClick={() => onPull(variant.pull_model)}
        >
          <Download aria-hidden="true" />
          {isPulling && isDownloadInProgress
            ? "ダウンロード中"
            : "ダウンロード"}
        </Button>
      </td>
    </tr>
  );
}

export function Settings() {
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [embeddingModel, setEmbeddingModel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pullState, setPullState] = useState<PullState | null>(null);
  // nullは「すべて」を表す。
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    async function loadModels(): Promise<void> {
      try {
        const result = await getAvailableModels();
        if (isActive) {
          setEmbeddingModel(result.embedding_model);
          setModels(result.models);
          setError(null);
        }
      } catch {
        if (isActive) {
          setError(
            "モデル一覧を取得できません。ネットワーク接続を確認してください。",
          );
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void loadModels();
    return () => {
      isActive = false;
    };
  }, []);

  async function handlePull(model: string): Promise<void> {
    if (pullState?.isInProgress) {
      return;
    }

    setError(null);
    setPullState({
      error: null,
      isInProgress: true,
      model,
      progress: null,
      status: "ダウンロードを開始しています",
    });
    const layerProgress = new Map<
      string,
      { completed: number; total: number }
    >();
    let activeDigest: string | null = null;
    let receivedTerminalEvent = false;
    try {
      await streamOllamaPull(model, (event) => {
        const isFinished = event.status === "success" || Boolean(event.error);
        receivedTerminalEvent ||= isFinished;
        if (event.digest) {
          activeDigest = event.digest;
        }
        const digest = event.digest ?? activeDigest;
        if (
          digest &&
          (event.completed !== undefined || event.total !== undefined)
        ) {
          const currentProgress = layerProgress.get(digest) ?? {
            completed: 0,
            total: 0,
          };
          layerProgress.set(digest, {
            completed: event.completed ?? currentProgress.completed,
            total: event.total ?? currentProgress.total,
          });
        }
        const progressValues = [...layerProgress.values()];
        const completed = progressValues.reduce(
          (sum, value) => sum + Math.min(value.completed, value.total),
          0,
        );
        const total = progressValues.reduce(
          (sum, value) => sum + value.total,
          0,
        );
        const progress =
          total > 0 ? Math.min((completed / total) * 100, 100) : null;
        setPullState((currentState) => {
          if (!currentState || currentState.model !== model) {
            return currentState;
          }
          return {
            ...currentState,
            error: event.error ?? null,
            isInProgress: !isFinished,
            progress: event.status === "success" ? 100 : progress,
            status:
              event.error ??
              formatPullStatus(event.status ?? currentState.status),
          };
        });
      });
    } catch (pullError) {
      setPullState((currentState) => {
        if (!currentState || currentState.model !== model) {
          return currentState;
        }
        return {
          ...currentState,
          error:
            pullError instanceof Error
              ? pullError.message
              : "モデルのダウンロードに失敗しました",
          isInProgress: false,
          status:
            pullError instanceof Error
              ? pullError.message
              : "モデルのダウンロードに失敗しました",
        };
      });
      return;
    }

    if (!receivedTerminalEvent) {
      setPullState((currentState) => {
        if (!currentState || currentState.model !== model) {
          return currentState;
        }
        return {
          ...currentState,
          error: "モデルのダウンロード完了を確認できませんでした",
          isInProgress: false,
          status: "モデルのダウンロード完了を確認できませんでした",
        };
      });
    }
  }

  const canDismissPull = pullState !== null && !pullState.isInProgress;
  const modelCategories = buildModelCategories(models);
  const categoryFamilies = new Set(
    modelCategories.map((category) => category.family),
  );
  const otherModelCount = models.filter(
    (model) => !categoryFamilies.has(getModelFamily(model.name)),
  ).length;
  const filteredModels = models.filter((model) =>
    matchesCategory(model, selectedCategory, categoryFamilies),
  );

  return (
    <section className="mx-auto w-full max-w-6xl space-y-6 px-6 py-8">
      <header className="flex items-center gap-3">
        <SettingsIcon
          className="size-6 text-muted-foreground"
          aria-hidden="true"
        />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">設定</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            テーマとローカルOllamaモデルを管理します。
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>テーマ</CardTitle>
          <CardDescription>
            アプリケーションの表示テーマを選択します。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button
            aria-pressed={theme === "light"}
            variant={theme === "light" ? "secondary" : "outline"}
            onClick={() => setTheme("light")}
          >
            <Sun aria-hidden="true" />
            ライト
          </Button>
          <Button
            aria-pressed={theme === "dark"}
            variant={theme === "dark" ? "secondary" : "outline"}
            onClick={() => setTheme("dark")}
          >
            <Moon aria-hidden="true" />
            ダーク
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>モデル一覧</CardTitle>
          <CardDescription>
            Ollama LibraryのモデルをローカルOllamaへダウンロードします。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <TriangleAlert aria-hidden="true" />
              <AlertTitle>モデル一覧を読み込めません</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {pullState ? (
            <div className="rounded-lg border bg-muted/30 p-4">
              <Progress value={pullState.progress ?? 0}>
                <ProgressLabel>{pullState.model}</ProgressLabel>
                <span className="ml-auto text-sm text-muted-foreground">
                  {pullState.progress === null
                    ? "準備中"
                    : `${Math.round(pullState.progress)}%`}
                </span>
              </Progress>
              <p
                className={cn(
                  "mt-2 text-sm text-muted-foreground",
                  pullState.error && "text-destructive",
                )}
              >
                {pullState.status}
              </p>
              {canDismissPull ? (
                <Button
                  className="mt-3"
                  size="sm"
                  variant="outline"
                  onClick={() => setPullState(null)}
                >
                  {pullState.error ? "閉じる" : "完了"}
                </Button>
              ) : null}
            </div>
          ) : null}

          {isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              読み込み中...
            </p>
          ) : null}

          {!isLoading && !error ? (
            <>
              <div
                className="flex flex-wrap gap-2"
                aria-label="モデルカテゴリ"
                role="group"
              >
                <Button
                  aria-pressed={selectedCategory === null}
                  size="sm"
                  type="button"
                  variant={selectedCategory === null ? "secondary" : "outline"}
                  onClick={() => setSelectedCategory(null)}
                >
                  すべて
                  <span className="text-muted-foreground">{models.length}</span>
                </Button>
                {modelCategories.map((category) => (
                  <Button
                    key={category.family}
                    aria-pressed={selectedCategory === category.family}
                    size="sm"
                    type="button"
                    variant={
                      selectedCategory === category.family
                        ? "secondary"
                        : "outline"
                    }
                    onClick={() => setSelectedCategory(category.family)}
                  >
                    {category.family}
                    <span className="text-muted-foreground">
                      {category.count}
                    </span>
                  </Button>
                ))}
                {otherModelCount > 0 ? (
                  <Button
                    aria-pressed={selectedCategory === OTHER_CATEGORY}
                    size="sm"
                    type="button"
                    variant={
                      selectedCategory === OTHER_CATEGORY
                        ? "secondary"
                        : "outline"
                    }
                    onClick={() => setSelectedCategory(OTHER_CATEGORY)}
                  >
                    その他
                    <span className="text-muted-foreground">
                      {otherModelCount}
                    </span>
                  </Button>
                ) : null}
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[700px] text-left text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">モデル</th>
                      <th className="px-4 py-3 font-medium">必要メモリ</th>
                      <th className="px-4 py-3 font-medium">互換性</th>
                      <th className="px-4 py-3 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredModels.flatMap((model) =>
                      visibleVariants(model).map((variant) => (
                        <ModelRow
                          key={variant.pull_model}
                          embeddingModel={embeddingModel}
                          model={model}
                          pullState={pullState}
                          variant={variant}
                          onPull={(modelName) => void handlePull(modelName)}
                        />
                      )),
                    )}
                  </tbody>
                </table>
              </div>
              {filteredModels.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  このカテゴリに該当するモデルはありません。
                </p>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
