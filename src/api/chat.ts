import axios from "axios";
import { z } from "zod";

import { apiClient } from "@/api/client";
import type { ChatConversation, ChatMessage } from "@/types/chat";

const normalChatEventSchema = z.object({
  content: z.string().optional(),
  conversation_id: z.string().uuid().optional(),
  done: z.boolean(),
  error: z.string().optional(),
});

const chatConversationSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid().nullable(),
  title: z.string(),
  created_at: z.string().datetime(),
});

const chatMessageSchema = z.object({
  id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  created_at: z.string().datetime(),
});

const apiErrorSchema = z.object({
  detail: z.string(),
});

const STREAM_PARSE_ERROR_MESSAGE = "応答の解析に失敗しました";
const STREAM_INCOMPLETE_ERROR_MESSAGE = "応答が途中で終了しました";

export type NormalChatRequest = {
  conversationId: string | null;
  message: string;
  model: string;
};

type NormalChatEvent = z.infer<typeof normalChatEventSchema>;

type ExtractedEvents = {
  events: NormalChatEvent[];
  remainingBuffer: string;
};

function toChatConversation(
  conversation: z.infer<typeof chatConversationSchema>,
): ChatConversation {
  return {
    id: conversation.id,
    projectId: conversation.project_id,
    title: conversation.title,
    createdAt: conversation.created_at,
  };
}

function toChatMessage(
  message: z.infer<typeof chatMessageSchema>,
): ChatMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
  };
}

function parseSseEvent(rawEvent: string): NormalChatEvent | null {
  const data = rawEvent
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");

  if (!data) {
    return null;
  }

  try {
    const result = normalChatEventSchema.safeParse(JSON.parse(data));
    if (result.success) {
      return result.data;
    }
  } catch {
    // ストリームの解析失敗は、利用者に詳細なパーサーエラーを表示しない。
  }

  throw new Error(STREAM_PARSE_ERROR_MESSAGE);
}

function extractEvents(buffer: string): ExtractedEvents {
  const events: NormalChatEvent[] = [];
  let remainingBuffer = buffer;
  let separatorIndex = remainingBuffer.indexOf("\n\n");

  while (separatorIndex !== -1) {
    const event = parseSseEvent(remainingBuffer.slice(0, separatorIndex));
    if (event) {
      events.push(event);
    }
    remainingBuffer = remainingBuffer.slice(separatorIndex + 2);
    separatorIndex = remainingBuffer.indexOf("\n\n");
  }

  return { events, remainingBuffer };
}

function processEvents(
  events: NormalChatEvent[],
  onEvent: (event: NormalChatEvent) => void,
): boolean {
  let receivedDoneEvent = false;

  for (const event of events) {
    onEvent(event);
    if (event.done) {
      receivedDoneEvent = true;
    }
  }

  return receivedDoneEvent;
}

function getApiErrorDetail(data: unknown): string | null {
  const result = apiErrorSchema.safeParse(data);
  return result.success ? result.data.detail : null;
}

async function getStreamErrorDetail(data: unknown): Promise<string | null> {
  if (!(data instanceof ReadableStream)) {
    return getApiErrorDetail(data);
  }

  try {
    const body = await new Response(data).text();
    return getApiErrorDetail(JSON.parse(body));
  } catch {
    return null;
  }
}

async function toChatError(error: unknown): Promise<Error> {
  if (axios.isAxiosError(error)) {
    const detail = await getStreamErrorDetail(error.response?.data);
    if (detail) {
      return new Error(detail);
    }
    if (!error.response) {
      return new Error("サーバーに接続できません");
    }
  }

  return error instanceof Error
    ? error
    : new Error("メッセージの送信に失敗しました");
}

export function getChatErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "メッセージの送信に失敗しました";
}

export async function getChatConversations(): Promise<ChatConversation[]> {
  const response = await apiClient.get<unknown>("/chat/conversations");
  return z
    .array(chatConversationSchema)
    .parse(response.data)
    .map(toChatConversation);
}

export async function getChatMessages(
  conversationId: string,
): Promise<ChatMessage[]> {
  const response = await apiClient.get<unknown>(
    `/chat/conversations/${conversationId}/messages`,
  );
  return z.array(chatMessageSchema).parse(response.data).map(toChatMessage);
}

export async function deleteChatConversation(
  conversationId: string,
): Promise<void> {
  await apiClient.delete(`/chat/conversations/${conversationId}`);
}

export async function streamNormalChat(
  request: NormalChatRequest,
  onEvent: (event: NormalChatEvent) => void,
): Promise<void> {
  let response;

  try {
    response = await apiClient.post<ReadableStream<Uint8Array>>(
      "/normal-chat",
      {
        conversation_id: request.conversationId,
        message: request.message,
        model: request.model,
      },
      {
        adapter: "fetch",
        responseType: "stream",
        timeout: 0,
      },
    );
  } catch (error) {
    throw await toChatError(error);
  }

  const reader = response.data.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let receivedDoneEvent = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");

      const extracted = extractEvents(buffer);
      buffer = extracted.remainingBuffer;
      receivedDoneEvent ||= processEvents(extracted.events, onEvent);

      if (done) {
        break;
      }
    }

    if (buffer.trim()) {
      const finalEvent = parseSseEvent(buffer);
      receivedDoneEvent ||= processEvents(
        finalEvent ? [finalEvent] : [],
        onEvent,
      );
    }

    if (!receivedDoneEvent) {
      throw new Error(STREAM_INCOMPLETE_ERROR_MESSAGE);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
