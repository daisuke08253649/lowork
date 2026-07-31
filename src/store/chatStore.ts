import { create } from "zustand";

import type { ChatConversation, ChatMessage } from "@/types/chat";

type ChatState = {
  activeConversationId: string | null;
  addMessage: (message: ChatMessage) => void;
  clearMessages: () => void;
  conversations: ChatConversation[];
  error: string | null;
  hasLoadedHistory: boolean;
  isHistoryLoading: boolean;
  isStreaming: boolean;
  messages: ChatMessage[];
  removeMessages: (ids: string[]) => void;
  setActiveConversationId: (conversationId: string | null) => void;
  setConversations: (conversations: ChatConversation[]) => void;
  setError: (error: string | null) => void;
  setHistoryLoading: (isLoading: boolean) => void;
  setMessages: (messages: ChatMessage[]) => void;
  setStreaming: (isStreaming: boolean) => void;
  updateMessage: (id: string, content: string) => void;
};

export const useChatStore = create<ChatState>()((set) => ({
  activeConversationId: null,
  messages: [],
  conversations: [],
  isStreaming: false,
  isHistoryLoading: false,
  hasLoadedHistory: false,
  error: null,
  addMessage: (message) => {
    set((state) => ({ messages: [...state.messages, message] }));
  },
  clearMessages: () => {
    set({ activeConversationId: null, messages: [], error: null });
  },
  removeMessages: (ids) => {
    const messageIds = new Set(ids);
    set((state) => ({
      messages: state.messages.filter((message) => !messageIds.has(message.id)),
    }));
  },
  setError: (error) => {
    set({ error });
  },
  setActiveConversationId: (conversationId) => {
    set({ activeConversationId: conversationId });
  },
  setConversations: (conversations) => {
    set({ conversations, hasLoadedHistory: true });
  },
  setHistoryLoading: (isHistoryLoading) => {
    set({ isHistoryLoading });
  },
  setMessages: (messages) => {
    set({ messages });
  },
  setStreaming: (isStreaming) => {
    set({ isStreaming });
  },
  updateMessage: (id, content) => {
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === id ? { ...message, content } : message,
      ),
    }));
  },
}));
