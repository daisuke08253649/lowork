export type ChatMessage = {
  content: string;
  id: string;
  role: "user" | "assistant";
};

export type ChatConversation = {
  createdAt: string;
  id: string;
  projectId: string | null;
  title: string;
};
