import { getChatErrorMessage, streamNormalChat } from "@/api/chat";
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
        { conversationId: null, message: trimmedMessage, model },
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

    return { shouldRestoreInput: false };
  }

  return { error, isStreaming, messages, sendMessage };
}
