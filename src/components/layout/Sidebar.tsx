import { useEffect, useRef, useState } from "react";
import {
  FolderKanban,
  MessageSquarePlus,
  Settings,
  Trash2,
} from "lucide-react";
import { matchPath, useLocation, useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { OllamaWarningBanner } from "@/components/common/OllamaWarningBanner";
import {
  loadChatConversations,
  loadChatConversation,
  removeChatConversation,
  startNewChat,
} from "@/hooks/useChat";
import { deleteChatConversation, getChatConversations } from "@/api/chat";
import { useChatStore } from "@/store/chatStore";
import { useOllamaStatusStore } from "@/store/ollamaStatusStore";
import { useProjectHistoryStore } from "@/store/projectHistoryStore";

const TITLE_REFRESH_INTERVAL_MS = 5_000;
const TITLE_REFRESH_MAX_ATTEMPTS = 24;
const DEFAULT_CONVERSATION_TITLE = "新しいチャット";

const navigationItems = [
  { label: "新しいチャット", path: "/", icon: MessageSquarePlus },
  { label: "プロジェクト", path: "/projects", icon: FolderKanban },
  { label: "設定", path: "/settings", icon: Settings },
];

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const activeConversationId = useChatStore(
    (state) => state.activeConversationId,
  );
  const conversations = useChatStore((state) => state.conversations);
  const isHistoryLoading = useChatStore((state) => state.isHistoryLoading);
  const isStreaming = useChatStore((state) => state.isStreaming);
  const [projectConversations, setProjectConversations] = useState<
    typeof conversations
  >([]);
  const [isProjectHistoryLoading, setIsProjectHistoryLoading] = useState(false);
  const [projectHistoryError, setProjectHistoryError] = useState<string | null>(
    null,
  );
  const titleRefreshAttemptsRef = useRef(0);
  const titleRefreshProjectIdRef = useRef<string | undefined>(undefined);
  const projectHistoryRefreshToken = useProjectHistoryStore(
    (state) => state.refreshToken,
  );
  const ollamaRecoveryToken = useOllamaStatusStore(
    (state) => state.recoveryToken,
  );
  const projectId = matchPath("/projects/:projectId", location.pathname)?.params
    .projectId;
  const activeProjectConversationId = new URLSearchParams(location.search).get(
    "conversation",
  );
  const displayedConversations = projectId
    ? projectConversations
    : conversations;
  const displayedActiveConversationId = projectId
    ? activeProjectConversationId
    : activeConversationId;
  const isDisplayedHistoryLoading = projectId
    ? isProjectHistoryLoading
    : isHistoryLoading;
  const displayedHistoryError = projectId ? projectHistoryError : null;

  function isNavigationItemActive(path: string): boolean {
    return path === "/"
      ? location.pathname === path
      : location.pathname.startsWith(path);
  }

  useEffect(() => {
    if (!projectId) {
      void loadChatConversations();
      return;
    }

    if (titleRefreshProjectIdRef.current !== projectId) {
      titleRefreshProjectIdRef.current = projectId;
      titleRefreshAttemptsRef.current = 0;
    }

    let isActive = true;
    let titleRefreshTimeout: number | undefined;

    async function loadProjectConversations(): Promise<void> {
      setIsProjectHistoryLoading(true);
      try {
        const loadedConversations = await getChatConversations(projectId);
        if (isActive) {
          setProjectConversations(loadedConversations);
          setProjectHistoryError(null);
          const hasUntitledConversation = loadedConversations.some(
            (conversation) => conversation.title === DEFAULT_CONVERSATION_TITLE,
          );
          if (!hasUntitledConversation) {
            titleRefreshAttemptsRef.current = 0;
          } else if (
            titleRefreshAttemptsRef.current < TITLE_REFRESH_MAX_ATTEMPTS
          ) {
            titleRefreshAttemptsRef.current += 1;
            titleRefreshTimeout = window.setTimeout(() => {
              useProjectHistoryStore.getState().refreshProjectHistory();
            }, TITLE_REFRESH_INTERVAL_MS);
          }
        }
      } catch {
        if (isActive) {
          setProjectHistoryError("チャット履歴の取得に失敗しました");
        }
      } finally {
        if (isActive) {
          setIsProjectHistoryLoading(false);
        }
      }
    }

    void loadProjectConversations();
    return () => {
      isActive = false;
      if (titleRefreshTimeout !== undefined) {
        window.clearTimeout(titleRefreshTimeout);
      }
    };
  }, [projectId, projectHistoryRefreshToken, ollamaRecoveryToken]);

  function handleNavigate(path: string): void {
    if (path === "/") {
      startNewChat();
    }
    navigate(path);
  }

  async function handleConversationSelect(
    conversationId: string,
  ): Promise<void> {
    if (projectId) {
      navigate(`/projects/${projectId}?conversation=${conversationId}`);
      return;
    }
    await loadChatConversation(conversationId);
    navigate("/");
  }

  async function handleConversationDelete(
    conversationId: string,
  ): Promise<void> {
    if (projectId) {
      try {
        await deleteChatConversation(conversationId);
        setProjectConversations((currentConversations) =>
          currentConversations.filter(
            (conversation) => conversation.id !== conversationId,
          ),
        );
        if (activeProjectConversationId === conversationId) {
          navigate(`/projects/${projectId}`);
        }
      } catch {
        // プロジェクト会話の削除失敗は、次回の一覧取得で再試行できるよう表示を維持する。
      }
      return;
    }
    await removeChatConversation(conversationId);
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="border-b px-4 py-5">
        <p className="text-lg font-semibold tracking-tight">lowork</p>
        <p className="mt-1 text-xs text-muted-foreground">
          ローカルAIアシスタント
        </p>
      </div>

      <OllamaWarningBanner />

      <nav className="space-y-1 p-3" aria-label="メインナビゲーション">
        {navigationItems.map(({ icon: Icon, label, path }) => (
          <Button
            key={path}
            className="w-full justify-start"
            disabled={path === "/" && isStreaming}
            variant={isNavigationItemActive(path) ? "secondary" : "ghost"}
            onClick={() => handleNavigate(path)}
          >
            <Icon aria-hidden="true" />
            {label}
          </Button>
        ))}
      </nav>

      <div className="mx-3 border-t" />

      <section
        className="flex min-h-0 flex-1 flex-col px-3 py-4"
        aria-labelledby="history-heading"
      >
        <h2
          id="history-heading"
          className="px-2 text-xs font-medium text-muted-foreground"
        >
          {projectId ? "プロジェクトチャット履歴" : "チャット履歴"}
        </h2>
        <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
          {displayedHistoryError ? (
            <p className="px-2 text-sm text-destructive">
              {displayedHistoryError}
            </p>
          ) : null}
          {!displayedHistoryError &&
            isDisplayedHistoryLoading &&
            displayedConversations.length === 0 && (
              <p className="px-2 text-sm text-muted-foreground">
                読み込み中...
              </p>
            )}
          {!displayedHistoryError &&
            !isDisplayedHistoryLoading &&
            displayedConversations.length === 0 && (
              <p className="px-2 text-sm text-muted-foreground">
                履歴はまだありません
              </p>
            )}
          {displayedConversations.map((conversation) => (
            <div
              key={conversation.id}
              className="group flex items-center gap-1 rounded-md pr-1 hover:bg-sidebar-accent"
            >
              <Button
                className="min-w-0 flex-1 justify-start truncate"
                disabled={isStreaming}
                variant={
                  displayedActiveConversationId === conversation.id
                    ? "secondary"
                    : "ghost"
                }
                onClick={() => void handleConversationSelect(conversation.id)}
              >
                <span className="truncate">{conversation.title}</span>
              </Button>
              <Button
                aria-label={`${conversation.title}を削除`}
                className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                disabled={isStreaming}
                size="icon"
                variant="ghost"
                onClick={() => void handleConversationDelete(conversation.id)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
}
