import { useEffect, useState } from "react";
import { CircleAlert, LoaderCircle, MessageCircle } from "lucide-react";

import { getOllamaModels } from "@/api/ollama";
import { MessageInput } from "@/components/chat/MessageInput";
import { MessageList } from "@/components/chat/MessageList";
import { ModelSelector } from "@/components/common/ModelSelector";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useChat } from "@/hooks/useChat";

export function NormalChat() {
  const [input, setInput] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [modelError, setModelError] = useState<string | null>(null);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const { error, isStreaming, messages, sendMessage } = useChat();

  useEffect(() => {
    let isActive = true;

    async function loadModels(): Promise<void> {
      try {
        const response = await getOllamaModels();
        if (!isActive) {
          return;
        }

        setModels(response.models);
        setModel(response.models[0] ?? null);
        if (response.models.length === 0) {
          setModelError("利用可能なOllamaモデルがありません");
        }
      } catch {
        if (isActive) {
          setModelError("Ollamaモデルの取得に失敗しました");
        }
      } finally {
        if (isActive) {
          setIsLoadingModels(false);
        }
      }
    }

    void loadModels();

    return () => {
      isActive = false;
    };
  }, []);

  async function handleSubmit(): Promise<void> {
    if (!model) {
      return;
    }

    const message = input;
    setInput("");
    const result = await sendMessage({ message, model });
    if (result.shouldRestoreInput) {
      setInput(message);
    }
  }

  const isInputDisabled = isStreaming || isLoadingModels || model === null;
  const displayedError = modelError ?? error;
  const composer = (
    <div className="w-full space-y-3">
      <ModelSelector
        disabled={isStreaming || isLoadingModels || models.length === 0}
        models={models}
        onValueChange={setModel}
        value={model}
      />
      <MessageInput
        disabled={isInputDisabled}
        onChange={setInput}
        onSubmit={handleSubmit}
        value={input}
      />
    </div>
  );

  if (messages.length === 0) {
    return (
      <section className="flex min-h-full flex-col items-center justify-center px-6">
        <div className="w-full max-w-xl text-center">
          <MessageCircle
            className="mx-auto size-10 text-muted-foreground"
            aria-hidden="true"
          />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">
            新しいチャット
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            モデルを選択して、メッセージを入力してください。
          </p>
          <div className="mt-8 text-left">{composer}</div>
          {displayedError && <ChatError message={displayedError} />}
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col">
      <MessageList isStreaming={isStreaming} messages={messages} />
      <div className="border-t bg-background px-6 py-4">
        <div className="mx-auto max-w-3xl">
          {displayedError && <ChatError message={displayedError} />}
          {isStreaming && (
            <p className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle
                className="size-4 animate-spin"
                aria-hidden="true"
              />
              応答を生成中...
            </p>
          )}
          {composer}
        </div>
      </div>
    </section>
  );
}

type ChatErrorProps = {
  message: string;
};

function ChatError({ message }: ChatErrorProps) {
  return (
    <Alert className="mt-4" variant="destructive">
      <CircleAlert aria-hidden="true" />
      <AlertTitle>チャットエラー</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
