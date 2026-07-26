import { z } from "zod";

import { apiClient } from "@/api/client";

const ollamaStatusSchema = z.object({
  available: z.boolean(),
});

const ollamaModelsSchema = z.object({
  models: z.array(z.string()),
});

export type OllamaStatus = z.infer<typeof ollamaStatusSchema>;
export type OllamaModels = z.infer<typeof ollamaModelsSchema>;

export async function getOllamaStatus(): Promise<OllamaStatus> {
  const response = await apiClient.get<unknown>("/ollama/status");
  return ollamaStatusSchema.parse(response.data);
}

export async function getOllamaModels(): Promise<OllamaModels> {
  const response = await apiClient.get<unknown>("/ollama/models");
  return ollamaModelsSchema.parse(response.data);
}
