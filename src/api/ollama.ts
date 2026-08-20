import axios from "axios";
import { z } from "zod";

import { apiClient } from "@/api/client";

const ollamaStatusSchema = z.object({
  available: z.boolean(),
});

const ollamaModelsSchema = z.object({
  models: z.array(z.string()),
});

const modelCompatibilitySchema = z.object({
  status: z.enum(["available", "warning", "unavailable", "unknown"]),
  required_memory_gb: z.number().nullable(),
});

const availableModelSchema = z.object({
  name: z.string(),
  variants: z.array(
    z.object({
      label: z.string().nullable(),
      pull_model: z.string(),
      compatibility: modelCompatibilitySchema,
    }),
  ),
});

const availableModelsSchema = z.object({
  models: z.array(availableModelSchema),
});

const pullEventSchema = z.object({
  completed: z.number().optional(),
  digest: z.string().optional(),
  error: z.string().optional(),
  status: z.string().optional(),
  total: z.number().optional(),
});

const apiErrorSchema = z.object({
  detail: z.string(),
});

export type OllamaStatus = z.infer<typeof ollamaStatusSchema>;
export type OllamaModels = z.infer<typeof ollamaModelsSchema>;
export type ModelCompatibility = z.infer<typeof modelCompatibilitySchema>;
export type AvailableModel = z.infer<typeof availableModelSchema>;
export type AvailableModelVariant = AvailableModel["variants"][number];
export type OllamaPullEvent = z.infer<typeof pullEventSchema>;

export async function getOllamaStatus(): Promise<OllamaStatus> {
  const response = await apiClient.get<unknown>("/ollama/status");
  return ollamaStatusSchema.parse(response.data);
}

export async function getOllamaModels(): Promise<OllamaModels> {
  const response = await apiClient.get<unknown>("/ollama/models");
  return ollamaModelsSchema.parse(response.data);
}

export async function getAvailableModels(): Promise<AvailableModel[]> {
  const response = await apiClient.get<unknown>("/ollama/available-models", {
    timeout: 0,
  });
  return availableModelsSchema.parse(response.data).models;
}

function parseSseEvent(eventText: string): OllamaPullEvent | null {
  const data = eventText
    .split("\n")
    .find((line) => line.startsWith("data:"))
    ?.slice("data:".length)
    .trim();
  if (!data) {
    return null;
  }
  return pullEventSchema.parse(JSON.parse(data));
}

function extractSseEvents(buffer: string): {
  events: OllamaPullEvent[];
  remainingBuffer: string;
} {
  const events: OllamaPullEvent[] = [];
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

async function getStreamErrorMessage(error: unknown): Promise<string> {
  if (!axios.isAxiosError(error)) {
    return "モデルのダウンロードを開始できません";
  }
  const data = error.response?.data;
  const errorData =
    data instanceof ReadableStream ? await new Response(data).text() : data;
  let parsedData: unknown = errorData;
  if (typeof errorData === "string") {
    try {
      parsedData = JSON.parse(errorData);
    } catch {
      parsedData = errorData;
    }
  }
  const parsed = apiErrorSchema.safeParse(parsedData);
  if (parsed.success) {
    return parsed.data.detail;
  }
  if (!error.response) {
    return "バックエンドに接続できません";
  }
  return error.response.status === 503
    ? "Ollamaに接続できません"
    : "モデルのダウンロードを開始できません";
}

async function toPullError(error: unknown): Promise<Error> {
  return new Error(await getStreamErrorMessage(error));
}

async function toPullStreamError(error: unknown): Promise<Error> {
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return new Error("モデルのダウンロード進捗を処理できません");
  }
  return error instanceof Error
    ? error
    : new Error("モデルのダウンロード進捗を処理できません");
}

export async function streamOllamaPull(
  model: string,
  onEvent: (event: OllamaPullEvent) => void,
): Promise<void> {
  let response;
  try {
    response = await apiClient.post<unknown>(
      "/ollama/pull",
      { model },
      {
        adapter: "fetch",
        responseType: "stream",
        timeout: 0,
      },
    );
  } catch (error) {
    throw await toPullError(error);
  }

  if (!(response.data instanceof ReadableStream)) {
    throw new Error("モデルのダウンロード進捗を受信できません");
  }

  const reader = response.data.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
      const extracted = extractSseEvents(buffer);
      buffer = extracted.remainingBuffer;
      extracted.events.forEach(onEvent);
      if (done) {
        break;
      }
    }
    if (buffer.trim()) {
      const event = parseSseEvent(buffer);
      if (event) {
        onEvent(event);
      }
    }
  } catch (error) {
    throw await toPullStreamError(error);
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
