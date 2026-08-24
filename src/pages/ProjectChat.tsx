import {
  Bot,
  CircleAlert,
  FilePenLine,
  LoaderCircle,
  MessageSquarePlus,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import type { ProjectFileOperation } from "@/api/chat";
import { applyFileOperation, getFileOperationErrorMessage } from "@/api/files";
import { getOllamaModels } from "@/api/ollama";
import { MessageInput } from "@/components/chat/MessageInput";
import { MessageList } from "@/components/chat/MessageList";
import { ModelSelector } from "@/components/common/ModelSelector";
import { DiffPreview } from "@/components/project/DiffPreview";
import { FileTree } from "@/components/project/FileTree";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useProjectChat } from "@/hooks/useChat";
import { loadProjects } from "@/hooks/useProject";
import { useModelStore } from "@/store/modelStore";
import { useOllamaStatusStore } from "@/store/ollamaStatusStore";
import { useProjectStore } from "@/store/projectStore";

export function ProjectChat() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedConversationId = searchParams.get("conversation");
  const [input, setInput] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [modelError, setModelError] = useState<string | null>(null);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [treeRefreshToken, setTreeRefreshToken] = useState(0);
  const [previewFileOperation, setPreviewFileOperation] =
    useState<ProjectFileOperation | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [fileOperationError, setFileOperationError] = useState<string | null>(
    null,
  );
  const [appliedFileOperation, setAppliedFileOperation] =
    useState<ProjectFileOperation | null>(null);
  const isApplyingRef = useRef(false);
  const submittedConversationIdRef = useRef<string | null>(null);
  const project = useProjectStore((state) =>
    state.projects.find((item) => item.id === projectId),
  );
  const executionMode = useProjectStore((state) => state.executionMode);
  const setExecutionMode = useProjectStore((state) => state.setExecutionMode);
  const model = useModelStore((state) => state.selectedModel);
  const setModel = useModelStore((state) => state.setSelectedModel);
  const ollamaRecoveryToken = useOllamaStatusStore(
    (state) => state.recoveryToken,
  );
  const {
    clearNotice,
    error,
    isSending,
    messages,
    notice,
    sendProjectMessage,
  } = useProjectChat(projectId, requestedConversationId);

  useEffect(() => {
    if (project || !projectId) {
      return;
    }
    void loadProjects(true).catch(() => {
      // ファイルツリー側のエラー表示を優先し、見出しは既定値を維持する。
    });
  }, [project, projectId]);

  useEffect(() => {
    let isActive = true;

    async function loadModels(): Promise<void> {
      try {
        const response = await getOllamaModels();
        if (!isActive) {
          return;
        }
        setModels(response.models);
        setModel(
          response.models.includes(model ?? "")
            ? model
            : (response.models[0] ?? null),
        );
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
  }, [model, setModel, ollamaRecoveryToken]);

  useEffect(() => {
    if (notice?.mode === "confirm" && notice.fileOp) {
      setFileOperationError(null);
      setPreviewFileOperation(notice.fileOp);
    }
  }, [notice]);

  useEffect(() => {
    if (
      submittedConversationIdRef.current !== null &&
      requestedConversationId === submittedConversationIdRef.current
    ) {
      submittedConversationIdRef.current = null;
      return;
    }

    isApplyingRef.current = false;
    submittedConversationIdRef.current = null;
    setAppliedFileOperation(null);
    setFileOperationError(null);
    setIsApplying(false);
    setPreviewFileOperation(null);
  }, [projectId, requestedConversationId]);

  async function handleSubmit(): Promise<void> {
    if (!projectId || !model) {
      return;
    }
    const message = input;
    setAppliedFileOperation(null);
    setFileOperationError(null);
    setInput("");
    const result = await sendProjectMessage({
      message,
      mode: executionMode,
      model,
      projectId,
    });
    if (result.shouldRestoreInput) {
      setInput(message);
      return;
    }
    if (result.conversationId) {
      if (requestedConversationId !== result.conversationId) {
        submittedConversationIdRef.current = result.conversationId;
      }
      navigate(`?conversation=${encodeURIComponent(result.conversationId)}`, {
        replace: true,
      });
    }
    setTreeRefreshToken((token) => token + 1);
  }

  async function handleApplyFileOperation(): Promise<void> {
    if (!projectId || !previewFileOperation || isApplyingRef.current) {
      return;
    }

    setFileOperationError(null);
    isApplyingRef.current = true;
    setIsApplying(true);
    try {
      await applyFileOperation({ projectId, ...previewFileOperation });
      setAppliedFileOperation(previewFileOperation);
      setPreviewFileOperation(null);
      clearNotice();
      setTreeRefreshToken((token) => token + 1);
    } catch (applyError) {
      setFileOperationError(getFileOperationErrorMessage(applyError));
    } finally {
      isApplyingRef.current = false;
      setIsApplying(false);
    }
  }

  const isInputDisabled = isSending || isLoadingModels || model === null;
  const displayedError = modelError ?? error;
  const composer = (
    <div className="w-full space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ModelSelector
          disabled={isSending || isLoadingModels || models.length === 0}
          models={models}
          onValueChange={setModel}
          value={model}
        />
        <Button
          aria-pressed={executionMode === "auto"}
          disabled={isSending}
          type="button"
          variant={executionMode === "auto" ? "default" : "outline"}
          onClick={() =>
            setExecutionMode(executionMode === "auto" ? "confirm" : "auto")
          }
        >
          <FilePenLine aria-hidden="true" />
          {executionMode === "auto" ? "自走モード" : "確認モード"}
        </Button>
        {projectId ? (
          <Button
            disabled={isSending}
            type="button"
            variant="outline"
            onClick={() => navigate(`/projects/${projectId}`)}
          >
            <MessageSquarePlus aria-hidden="true" />
            このプロジェクトで新しい会話
          </Button>
        ) : null}
      </div>
      <MessageInput
        disabled={isInputDisabled}
        onChange={setInput}
        onSubmit={handleSubmit}
        value={input}
      />
    </div>
  );

  return (
    <div className="flex h-full overflow-hidden">
      <section className="flex min-w-0 flex-1 flex-col">
        {messages.length === 0 ? (
          <div className="flex min-h-full flex-col items-center justify-center px-6 text-center">
            <div className="w-full max-w-xl">
              <Bot
                className="mx-auto size-10 text-muted-foreground"
                aria-hidden="true"
              />
              <h1 className="mt-4 text-2xl font-semibold tracking-tight">
                {project?.name ?? "プロジェクト"}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                プロジェクト内のメモを参照して、作成や編集を支援します。
              </p>
              <div className="mt-8 text-left">{composer}</div>
              {displayedError ? <ChatError message={displayedError} /> : null}
            </div>
          </div>
        ) : (
          <>
            <MessageList isStreaming={isSending} messages={messages} />
            <div className="border-t bg-background px-6 py-4">
              <div className="mx-auto max-w-3xl">
                {displayedError ? <ChatError message={displayedError} /> : null}
                {appliedFileOperation ? (
                  <AppliedFileOperationNotice
                    fileOperation={appliedFileOperation}
                  />
                ) : null}
                {notice ? (
                  <ProjectChatNotice
                    {...notice}
                    onPreview={() => {
                      if (notice.fileOp) {
                        setFileOperationError(null);
                        setPreviewFileOperation(notice.fileOp);
                      }
                    }}
                  />
                ) : null}
                {isSending ? (
                  <p className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
                    <LoaderCircle
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                    プロジェクトを検索して応答を生成中...
                  </p>
                ) : null}
                {composer}
              </div>
            </div>
          </>
        )}
      </section>
      <DiffPreview
        error={fileOperationError}
        fileOperation={previewFileOperation}
        isApplying={isApplying}
        onApply={() => void handleApplyFileOperation()}
        onClose={() => {
          setPreviewFileOperation(null);
          setFileOperationError(null);
        }}
      />
      {projectId ? (
        <FileTree
          isChatPending={isSending}
          projectId={projectId}
          refreshToken={treeRefreshToken}
        />
      ) : null}
    </div>
  );
}

function ChatError({ message }: { message: string }) {
  return (
    <Alert className="mt-4" variant="destructive">
      <CircleAlert aria-hidden="true" />
      <AlertTitle>チャットエラー</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function ProjectChatNotice({
  fileOp,
  fileOpError,
  mode,
  onPreview,
}: {
  fileOp: { action: "create" | "edit"; filename: string } | null;
  fileOpError: string | null;
  mode: "confirm" | "auto";
  onPreview: () => void;
}) {
  if (fileOpError) {
    const title = fileOp
      ? `${fileOp.filename} を適用できませんでした`
      : "ファイル操作を適用できませんでした";
    return (
      <Alert className="mb-3" variant="destructive">
        <CircleAlert aria-hidden="true" />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{fileOpError}</AlertDescription>
      </Alert>
    );
  }
  if (!fileOp) {
    return null;
  }
  const action = fileOp.action === "create" ? "作成" : "編集";
  const title =
    mode === "auto"
      ? `${fileOp.filename} を${action}しました`
      : `${fileOp.filename} の${action}を提案しました`;
  const description =
    mode === "auto"
      ? "自走モードでファイル操作を適用しました。"
      : "内容を確認して適用してください。";
  return (
    <Alert className="mb-3">
      <FilePenLine aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="flex items-center justify-between gap-3">
        <span>{description}</span>
        {mode === "confirm" ? (
          <Button size="sm" variant="outline" onClick={onPreview}>
            プレビューを開く
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

function AppliedFileOperationNotice({
  fileOperation,
}: {
  fileOperation: ProjectFileOperation;
}) {
  const action = fileOperation.action === "create" ? "作成" : "編集";
  return (
    <Alert className="mb-3">
      <FilePenLine aria-hidden="true" />
      <AlertTitle>{`${fileOperation.filename} を${action}しました`}</AlertTitle>
    </Alert>
  );
}
