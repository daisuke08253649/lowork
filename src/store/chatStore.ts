import { create } from "zustand";

import type { ChatMessage } from "@/types/chat";

type ChatState = {
  addMessage: (message: ChatMessage) => void;
  clearMessages: () => void;
  error: string | null;
  isStreaming: boolean;
  messages: ChatMessage[];
  removeMessages: (ids: string[]) => void;
  setError: (error: string | null) => void;
  setStreaming: (isStreaming: boolean) => void;
  updateMessage: (id: string, content: string) => void;
};

export const useChatStore = create<ChatState>()((set) => ({
  messages: [],
  isStreaming: false,
  error: null,
  addMessage: (message) => {
    set((state) => ({ messages: [...state.messages, message] }));
  },
  clearMessages: () => {
    set({ messages: [], error: null });
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
