import {
  deleteChatConversation,
  getChatConversations,
  getChatErrorMessage,
  getChatMessages,
  streamNormalChat,
} from "@/api/chat";
import { useChatStore } from "@/store/chatStore";
import type { ChatMessage } from "@/types/chat";

type SendMessageParams = {
  message: string;
  model: string;
};

type SendMessageResult = {
  shouldRestoreInput: boolean;
};

type UseChatResult = {
  error: string | null;
  isStreaming: boolean;
  messages: ChatMessage[];
  sendMessage: (params: SendMessageParams) => Promise<SendMessageResult>;
};

const GENERATED_TITLE_POLL_INTERVAL_MS = 5_000;
const GENERATED_TITLE_POLL_ATTEMPTS = 24;
const DEFAULT_CONVERSATION_TITLE = "新しいチャット";

export async function loadChatConversations(
  force = false,
  reportError = true,
): Promise<void> {
  const store = useChatStore.getState();
  if (store.isHistoryLoading || (store.hasLoadedHistory && !force)) {
    return;
  }

  store.setHistoryLoading(true);
  try {
    const loadedConversations = await getChatConversations();
    useChatStore.getState().setConversations(loadedConversations);
  } catch {
    if (reportError) {
      useChatStore.getState().setError("チャット履歴の取得に失敗しました");
    }
  } finally {
    useChatStore.getState().setHistoryLoading(false);
  }
}

export async function loadChatConversation(
  conversationId: string,
): Promise<void> {
  if (useChatStore.getState().isStreaming) {
    return;
  }

  useChatStore.getState().setError(null);
  try {
    const loadedMessages = await getChatMessages(conversationId);
    const store = useChatStore.getState();
    store.setMessages(loadedMessages);
    store.setActiveConversationId(conversationId);
  } catch {
    useChatStore.getState().setError("会話履歴の取得に失敗しました");
  }
}

export async function removeChatConversation(
  conversationId: string,
): Promise<void> {
  if (useChatStore.getState().isStreaming) {
    return;
  }

  try {
    await deleteChatConversation(conversationId);
    const store = useChatStore.getState();
    if (store.activeConversationId === conversationId) {
      store.clearMessages();
    }
    await loadChatConversations(true, false);
  } catch {
    useChatStore.getState().setError("会話の削除に失敗しました");
  }
}

export function startNewChat(): void {
  if (!useChatStore.getState().isStreaming) {
    useChatStore.getState().clearMessages();
  }
}

function waitForGeneratedTitle(conversationId: string): void {
  void pollGeneratedTitle(conversationId);
}

async function pollGeneratedTitle(conversationId: string): Promise<void> {
  for (let attempt = 0; attempt < GENERATED_TITLE_POLL_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => {
      window.setTimeout(resolve, GENERATED_TITLE_POLL_INTERVAL_MS);
    });

    await loadChatConversations(true, false);
    const conversation = useChatStore
      .getState()
      .conversations.find((item) => item.id === conversationId);
    if (!conversation || conversation.title !== DEFAULT_CONVERSATION_TITLE) {
      return;
    }
  }
}

export function useChat(): UseChatResult {
  const error = useChatStore((state) => state.error);
  const isStreaming = useChatStore((state) => state.isStreaming);
  const messages = useChatStore((state) => state.messages);

  async function sendMessage({
    message,
    model,
  }: SendMessageParams): Promise<SendMessageResult> {
    const trimmedMessage = message.trim();
    if (!trimmedMessage || useChatStore.getState().isStreaming) {
      return { shouldRestoreInput: true };
    }

    const userMessage = {
      id: crypto.randomUUID(),
      role: "user" as const,
      content: trimmedMessage,
    };
    const assistantMessageId = crypto.randomUUID();
    const store = useChatStore.getState();
    const isNewConversation = store.activeConversationId === null;

    store.setError(null);
    store.addMessage(userMessage);
    store.addMessage({
      id: assistantMessageId,
      role: "assistant",
      content: "",
    });
    store.setStreaming(true);

    try {
      await streamNormalChat(
        {
          conversationId: store.activeConversationId,
          message: trimmedMessage,
          model,
        },
        (event) => {
          if (event.error) {
            throw new Error(event.error);
          }
          if (event.content) {
            const currentMessage = useChatStore
              .getState()
              .messages.find((item) => item.id === assistantMessageId);
            if (currentMessage) {
              useChatStore
                .getState()
                .updateMessage(
                  assistantMessageId,
                  currentMessage.content + event.content,
                );
            }
          }
          if (event.conversation_id) {
            useChatStore
              .getState()
              .setActiveConversationId(event.conversation_id);
          }
        },
      );
    } catch (error) {
      const currentStore = useChatStore.getState();
      const assistantMessage = currentStore.messages.find(
        (item) => item.id === assistantMessageId,
      );
      const hasPartialResponse = Boolean(assistantMessage?.content.trim());
      if (!hasPartialResponse) {
        currentStore.removeMessages([userMessage.id, assistantMessageId]);
      }
      currentStore.setError(getChatErrorMessage(error));
      return { shouldRestoreInput: !hasPartialResponse };
    } finally {
      useChatStore.getState().setStreaming(false);
    }

    await loadChatConversations(true);
    const conversationId = useChatStore.getState().activeConversationId;
    if (isNewConversation && conversationId) {
      waitForGeneratedTitle(conversationId);
    }

    return { shouldRestoreInput: false };
  }

  return {
    error,
    isStreaming,
    messages,
    sendMessage,
  };
}
