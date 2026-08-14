import { useEffect, useRef, useState } from "react";

import {
  deleteChatConversation,
  getChatConversations,
  getChatErrorMessage,
  getChatMessages,
  sendProjectChat,
  streamNormalChat,
  type ProjectFileOperation,
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

type SendProjectMessageParams = {
  message: string;
  mode: "confirm" | "auto";
  model: string;
  projectId: string;
};

type ProjectChatNotice = {
  fileOp: ProjectFileOperation | null;
  fileOpError: string | null;
  mode: "confirm" | "auto";
};

type UseProjectChatResult = {
  error: string | null;
  isSending: boolean;
  messages: ChatMessage[];
  notice: ProjectChatNotice | null;
  sendProjectMessage: (
    params: SendProjectMessageParams,
  ) => Promise<SendMessageResult>;
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

export function useProjectChat(
  projectId: string | undefined,
): UseProjectChatResult {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [notice, setNotice] = useState<ProjectChatNotice | null>(null);
  const requestIdRef = useRef(0);
  const isSendingRef = useRef(false);

  useEffect(() => {
    requestIdRef.current += 1;
    isSendingRef.current = false;
    setConversationId(null);
    setError(null);
    setMessages([]);
    setNotice(null);
    setIsSending(false);
  }, [projectId]);

  async function sendProjectMessage({
    message,
    mode,
    model,
    projectId,
  }: SendProjectMessageParams): Promise<SendMessageResult> {
    const trimmedMessage = message.trim();
    if (!trimmedMessage || isSendingRef.current) {
      return { shouldRestoreInput: true };
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmedMessage,
    };
    setError(null);
    setNotice(null);
    setMessages((currentMessages) => [...currentMessages, userMessage]);
    isSendingRef.current = true;
    setIsSending(true);
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    try {
      const response = await sendProjectChat({
        conversationId,
        message: trimmedMessage,
        mode,
        model,
        projectId,
      });
      if (requestId !== requestIdRef.current) {
        return { shouldRestoreInput: false };
      }
      const assistantContent =
        response.message.trim() || "応答を受け取りました。";
      setConversationId(response.conversationId);
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: assistantContent,
        },
      ]);
      setNotice({
        fileOp: response.fileOp,
        fileOpError: response.fileOpError,
        mode: response.mode,
      });
      return { shouldRestoreInput: false };
    } catch (requestError) {
      if (requestId !== requestIdRef.current) {
        return { shouldRestoreInput: false };
      }
      setMessages((currentMessages) =>
        currentMessages.filter(
          (currentMessage) => currentMessage.id !== userMessage.id,
        ),
      );
      setError(getChatErrorMessage(requestError));
      return { shouldRestoreInput: true };
    } finally {
      if (requestId === requestIdRef.current) {
        isSendingRef.current = false;
        setIsSending(false);
      }
    }
  }

  return { error, isSending, messages, notice, sendProjectMessage };
}
