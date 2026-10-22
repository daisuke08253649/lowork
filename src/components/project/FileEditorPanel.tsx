import { CircleAlert, LoaderCircle, RotateCcw, Save, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import {
  getFileContent,
  getFileOperationErrorMessage,
  isFileConflictError,
  saveFileContent,
} from "@/api/files";
import { MarkdownContent } from "@/components/common/MarkdownContent";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type FileEditorPanelProps = {
  isChatPending: boolean;
  projectId: string;
  refreshToken: number;
  requestedPath: string;
  onCancelSwitch: (currentPath: string) => void;
  onClose: () => void;
  onSaved: (path: string) => void;
};

type LoadedFile = {
  content: string;
  contentHash: string;
  path: string;
};

type EditorTab = "preview" | "edit";

export function FileEditorPanel({
  isChatPending,
  projectId,
  refreshToken,
  requestedPath,
  onCancelSwitch,
  onClose,
  onSaved,
}: FileEditorPanelProps) {
  const [currentPath, setCurrentPath] = useState(requestedPath);
  const [loadedFile, setLoadedFile] = useState<LoadedFile | null>(null);
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState<EditorTab>("preview");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hasConflict, setHasConflict] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingDiscard, setPendingDiscard] = useState<
    "close" | "switch" | null
  >(null);
  const [reloadToken, setReloadToken] = useState(0);
  const lastRefreshTokenRef = useRef(refreshToken);
  // 切り替え直後は前のファイルの内容が残っているため、表示中のパスと一致するものだけを扱う。
  const activeFile = loadedFile?.path === currentPath ? loadedFile : null;
  const isDirty = activeFile !== null && draft !== activeFile.content;
  const canSave = isDirty && !isSaving && !isLoading && !isChatPending;

  useEffect(() => {
    // 保存中は書き込みの結果が確定するまで切り替えない。
    if (requestedPath === currentPath || isSaving) {
      return;
    }
    if (isDirty) {
      setPendingDiscard("switch");
      return;
    }
    setCurrentPath(requestedPath);
  }, [currentPath, isDirty, isSaving, requestedPath]);

  useEffect(() => {
    // AIの書き込みや「元に戻す」でファイルが変わった可能性があるため、
    // 未保存の編集がなければ読み直す。編集中は上書きせず、保存時の衝突検知に任せる。
    if (lastRefreshTokenRef.current === refreshToken || isDirty) {
      return;
    }
    lastRefreshTokenRef.current = refreshToken;
    setReloadToken((token) => token + 1);
  }, [isDirty, refreshToken]);

  useEffect(() => {
    let isActive = true;

    async function loadFile(): Promise<void> {
      setIsLoading(true);
      try {
        const file = await getFileContent(projectId, currentPath);
        if (!isActive) {
          return;
        }
        setLoadedFile({
          content: file.content,
          contentHash: file.contentHash,
          path: currentPath,
        });
        setDraft(file.content);
        setLoadError(null);
        setSaveError(null);
        setHasConflict(false);
      } catch (error) {
        if (isActive) {
          setLoadedFile(null);
          setLoadError(getFileOperationErrorMessage(error));
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void loadFile();
    return () => {
      isActive = false;
    };
  }, [currentPath, projectId, reloadToken]);

  async function handleSave(): Promise<void> {
    if (!activeFile || !canSave) {
      return;
    }

    const savedContent = draft;
    const savedPath = activeFile.path;
    setIsSaving(true);
    setSaveError(null);
    try {
      const contentHash = await saveFileContent({
        projectId,
        path: savedPath,
        content: savedContent,
        expectedHash: activeFile.contentHash,
      });
      setLoadedFile({ content: savedContent, contentHash, path: savedPath });
      onSaved(savedPath);
    } catch (error) {
      setHasConflict(isFileConflictError(error));
      setSaveError(getFileOperationErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if ((event.metaKey || event.ctrlKey) && event.key === "s") {
      event.preventDefault();
      void handleSave();
    }
  }

  function requestClose(): void {
    if (isSaving) {
      return;
    }
    if (isDirty) {
      setPendingDiscard("close");
      return;
    }
    onClose();
  }

  function confirmDiscard(): void {
    const action = pendingDiscard;
    setPendingDiscard(null);
    if (action === "close") {
      onClose();
      return;
    }
    setCurrentPath(requestedPath);
  }

  function cancelDiscard(): void {
    if (pendingDiscard === "switch") {
      onCancelSwitch(currentPath);
    }
    setPendingDiscard(null);
  }

  return (
    <section
      aria-label="ファイルの確認・編集"
      className="flex min-w-72 flex-1 flex-col border-l"
      onKeyDown={handleKeyDown}
    >
      <header className="flex items-center gap-2 border-b px-4 py-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
          {currentPath}
          {isDirty ? (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              未保存
            </span>
          ) : null}
        </h2>
        <Button
          disabled={!canSave}
          size="sm"
          title={isChatPending ? "応答の生成中は保存できません" : "保存（⌘S）"}
          onClick={() => void handleSave()}
        >
          {isSaving ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <Save aria-hidden="true" />
          )}
          保存
        </Button>
        <Button
          aria-label="閉じる"
          disabled={isSaving}
          size="icon-sm"
          variant="ghost"
          onClick={requestClose}
        >
          <X aria-hidden="true" />
        </Button>
      </header>

      {pendingDiscard ? (
        <Alert className="m-3 w-auto">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>保存していない変更があります</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>変更を破棄してよいですか？</span>
            <Button
              disabled={isSaving}
              size="sm"
              variant="destructive"
              onClick={confirmDiscard}
            >
              破棄する
            </Button>
            <Button
              disabled={isSaving}
              size="sm"
              variant="outline"
              onClick={cancelDiscard}
            >
              キャンセル
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {saveError ? (
        <Alert className="m-3 w-auto" variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>保存できませんでした</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>{saveError}</span>
            {hasConflict ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setReloadToken((token) => token + 1)}
              >
                <RotateCcw aria-hidden="true" />
                再読み込み（編集を破棄）
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {loadError ? (
        <p className="px-4 py-3 text-sm text-destructive">{loadError}</p>
      ) : null}

      {isLoading && !activeFile ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">読み込み中...</p>
      ) : null}

      {activeFile ? (
        <Tabs
          className="min-h-0 flex-1 px-4 py-3"
          value={tab}
          onValueChange={(value) => {
            if (value === "preview" || value === "edit") {
              setTab(value);
            }
          }}
        >
          <TabsList>
            <TabsTrigger value="preview">プレビュー</TabsTrigger>
            <TabsTrigger value="edit">編集</TabsTrigger>
          </TabsList>
          <TabsContent className="min-h-0 overflow-y-auto" value="preview">
            <FilePreview content={draft} path={currentPath} />
          </TabsContent>
          <TabsContent className="flex min-h-0 flex-col" value="edit">
            <Textarea
              aria-label={`${currentPath} の内容`}
              className="min-h-0 flex-1 resize-none font-mono field-sizing-fixed"
              readOnly={isLoading}
              spellCheck={false}
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
            />
          </TabsContent>
        </Tabs>
      ) : null}
    </section>
  );
}

function FilePreview({ content, path }: { content: string; path: string }) {
  if (!content) {
    return <p className="text-sm text-muted-foreground">（内容は空です）</p>;
  }
  if (!path.toLowerCase().endsWith(".md")) {
    return (
      <pre className="text-sm leading-6 break-words whitespace-pre-wrap">
        {content}
      </pre>
    );
  }
  return (
    <div className="text-sm leading-6 [&_h1]:mb-3 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-2 [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground">
      <MarkdownContent codeBackgroundClass="bg-muted" content={content} />
    </div>
  );
}
