import axios from "axios";
import { z } from "zod";

import { apiClient } from "@/api/client";

const apiErrorSchema = z.object({
  detail: z.string(),
});

export type ApplyFileOperationRequest = {
  action: "create" | "edit";
  content: string;
  filename: string;
  projectId: string;
};

export async function applyFileOperation(
  request: ApplyFileOperationRequest,
): Promise<void> {
  await apiClient.post(
    "/files/apply",
    {
      project_id: request.projectId,
      action: request.action,
      filename: request.filename,
      content: request.content,
    },
    { timeout: 0 },
  );
}

export function getFileOperationErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const result = apiErrorSchema.safeParse(error.response?.data);
    if (result.success) {
      return result.data.detail;
    }
    if (!error.response) {
      return "サーバーに接続できません";
    }
  }

  return error instanceof Error
    ? error.message
    : "ファイル操作の適用に失敗しました";
}
