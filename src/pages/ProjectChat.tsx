import {
  Bot,
  CircleAlert,
  FilePenLine,
  LoaderCircle,
  MessageSquarePlus,
  Undo2,
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
import { FileEditorPanel } from "@/components/project/FileEditorPanel";
import { FileTree } from "@/components/project/FileTree";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useProjectChat } from "@/hooks/useChat";
import { loadProjects } from "@/hooks/useProject";
import { useModelStore } from "@/store/modelStore";
import { useOllamaStatusStore } from "@/store/ollamaStatusStore";
import { useProjectStore } from "@/store/projectStore";
import { useUnsavedChangesStore } from "@/store/unsavedChangesStore";

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
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [previewFileOperation, setPreviewFileOperation] =
    useState<ProjectFileOperation | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [fileOperationError, setFileOperationError] = useState<string | null>(
    null,
  );
  const [appliedFileOperation, setAppliedFileOperation] =
    useState<ProjectFileOperation | null>(null);
  const [restoredFilename, setRestoredFilename] = useState<string | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  const isApplyingRef = useRef(false);
  const submittedConversationIdRef = useRef<string | null>(null);
  const project = useProjectStore((state) =>
    state.projects.find((item) => item.id === projectId),
  );
  const isEditorSaving = useUnsavedChangesStore((state) => state.isSaving);
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
    setRestoredFilename(null);
    setUndoError(null);
    setFileOperationError(null);
    setIsApplying(false);
    setPreviewFileOperation(null);
  }, [projectId, requestedConversationId]);

  useEffect(() => {
    setSelectedFilePath(null);
  }, [projectId]);

  async function handleSubmit(): Promise<void> {
    if (!projectId || !model || isEditorSaving) {
      return;
    }
    const message = input;
    setAppliedFileOperation(null);
    setRestoredFilename(null);
    setUndoError(null);
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

  async function handleUndoAutoFileOperation(): Promise<void> {
    const fileOp = notice?.fileOp;
    const previousContent = notice?.previousContent;
    const appliedContentHash = notice?.appliedContentHash;
    if (
      !projectId ||
      !fileOp ||
      previousContent === null ||
      previousContent === undefined ||
      !appliedContentHash ||
      isApplyingRef.current
    ) {
      return;
    }

    setUndoError(null);
    isApplyingRef.current = true;
    setIsApplying(true);
    try {
      await applyFileOperation({
        projectId,
        action: "edit",
        filename: fileOp.filename,
        content: previousContent,
        // AIの書き込み後に手動保存などでファイルが変わっていたら、上書きせず409にする。
        expectedHash: appliedContentHash,
      });
      setRestoredFilename(fileOp.filename);
      clearNotice();
      setTreeRefreshToken((token) => token + 1);
    } catch (restoreError) {
      setUndoError(getFileOperationErrorMessage(restoreError));
    } finally {
      isApplyingRef.current = false;
      setIsApplying(false);
    }
  }

  function handleManualSave(path: string): void {
    // 手動保存より前に作られたAIの提案や「元に戻す」は古い内容を前提にしているため、
    // 適用すると手動の変更を上書きしてしまう。同じファイルを対象とするものは取り消す。
    if (notice?.fileOp?.filename === path) {
      clearNotice();
      setUndoError(null);
    }
    if (previewFileOperation?.filename === path && !isApplyingRef.current) {
      setPreviewFileOperation(null);
      setFileOperationError(null);
    }
    setTreeRefreshToken((token) => token + 1);
  }

  // 手動保存とAIのファイル操作が重なると、古い内容に基づく書き込みで手動の変更が失われる。
  // 応答の生成中は保存を止めているので、保存中は送信を止めて両者を同時に起こさない。
  const isInputDisabled =
    isSending || isEditorSaving || isLoadingModels || model === null;
  const displayedError = modelError ?? error;
  const composer = (
    <div className="w-full space-y-3">
      {projectId ? (
        <div>
          <Button
            disabled={isSending}
            type="button"
            variant="outline"
            onClick={() => navigate(`/projects/${projectId}`)}
          >
            <MessageSquarePlus aria-hidden="true" />
            このプロジェクトで新しい会話
          </Button>
        </div>
      ) : null}
      <MessageInput
        disabled={isInputDisabled}
        onChange={setInput}
        onSubmit={handleSubmit}
        toolbar={
          <>
            <ModelSelector
              disabled={isSending || isLoadingModels || models.length === 0}
              models={models}
              onValueChange={setModel}
              value={model}
            />
            <Button
              aria-pressed={executionMode === "auto"}
              disabled={isSending}
              size="sm"
              type="button"
              variant={executionMode === "auto" ? "default" : "ghost"}
              onClick={() =>
                setExecutionMode(executionMode === "auto" ? "confirm" : "auto")
              }
            >
              <FilePenLine aria-hidden="true" />
              {executionMode === "auto" ? "自走モード" : "確認モード"}
            </Button>
          </>
        }
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
                {restoredFilename ? (
                  <Alert className="mb-3">
                    <Undo2 aria-hidden="true" />
                    <AlertTitle>{`${restoredFilename} を元に戻しました`}</AlertTitle>
                  </Alert>
                ) : null}
                {notice ? (
                  <ProjectChatNotice
                    {...notice}
                    isUndoing={isApplying}
                    undoError={undoError}
                    onUndo={() => void handleUndoAutoFileOperation()}
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
      {projectId && selectedFilePath ? (
        <FileEditorPanel
          isChatPending={isSending}
          projectId={projectId}
          refreshToken={treeRefreshToken}
          requestedPath={selectedFilePath}
          onCancelSwitch={setSelectedFilePath}
          onClose={() => setSelectedFilePath(null)}
          onSaved={handleManualSave}
        />
      ) : null}
      {projectId ? (
        <FileTree
          isChatPending={isSending}
          projectId={projectId}
          refreshToken={treeRefreshToken}
          selectedPath={selectedFilePath}
          onSelectFile={setSelectedFilePath}
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
  appliedContentHash,
  fileOp,
  fileOpError,
  isUndoing,
  mode,
  onPreview,
  onUndo,
  previousContent,
  undoError,
}: {
  appliedContentHash: string | null;
  fileOp: { action: "create" | "edit"; filename: string } | null;
  fileOpError: string | null;
  isUndoing: boolean;
  mode: "confirm" | "auto";
  onPreview: () => void;
  onUndo: () => void;
  previousContent: string | null;
  undoError: string | null;
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
  const canUndo =
    mode === "auto" && previousContent !== null && appliedContentHash !== null;
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
        {canUndo ? (
          <Button
            disabled={isUndoing}
            size="sm"
            variant="outline"
            onClick={onUndo}
          >
            <Undo2 aria-hidden="true" />
            {isUndoing ? "元に戻しています..." : "元に戻す"}
          </Button>
        ) : null}
      </AlertDescription>
      {undoError ? (
        <p className="col-start-2 mt-2 text-sm text-destructive">{undoError}</p>
      ) : null}
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
