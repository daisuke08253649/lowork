import { useEffect } from "react";
import {
  FolderKanban,
  MessageSquarePlus,
  Settings,
  Trash2,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { OllamaWarningBanner } from "@/components/common/OllamaWarningBanner";
import {
  loadChatConversations,
  loadChatConversation,
  removeChatConversation,
  startNewChat,
} from "@/hooks/useChat";
import { useChatStore } from "@/store/chatStore";

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

  function isNavigationItemActive(path: string): boolean {
    return path === "/"
      ? location.pathname === path
      : location.pathname.startsWith(path);
  }

  useEffect(() => {
    void loadChatConversations();
  }, []);

  function handleNavigate(path: string): void {
    if (path === "/") {
      startNewChat();
    }
    navigate(path);
  }

  async function handleConversationSelect(
    conversationId: string,
  ): Promise<void> {
    await loadChatConversation(conversationId);
    navigate("/");
  }

  async function handleConversationDelete(
    conversationId: string,
  ): Promise<void> {
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
          チャット履歴
        </h2>
        <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
          {isHistoryLoading && conversations.length === 0 && (
            <p className="px-2 text-sm text-muted-foreground">読み込み中...</p>
          )}
          {!isHistoryLoading && conversations.length === 0 && (
            <p className="px-2 text-sm text-muted-foreground">
              履歴はまだありません
            </p>
          )}
          {conversations.map((conversation) => (
            <div
              key={conversation.id}
              className="group flex items-center gap-1 rounded-md pr-1 hover:bg-sidebar-accent"
            >
              <Button
                className="min-w-0 flex-1 justify-start truncate"
                disabled={isStreaming}
                variant={
                  activeConversationId === conversation.id
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
