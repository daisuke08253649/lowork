import axios from "axios";
import { z } from "zod";

import { apiClient } from "@/api/client";

const apiErrorSchema = z.object({
  detail: z.string(),
});

const fileContentSchema = z.object({
  path: z.string(),
  content: z.string(),
  content_hash: z.string(),
});

const saveFileContentResponseSchema = z.object({
  content_hash: z.string(),
});

export type FileContent = {
  content: string;
  contentHash: string;
  path: string;
};

export type SaveFileContentRequest = {
  content: string;
  expectedHash: string;
  path: string;
  projectId: string;
};

export type ApplyFileOperationRequest = {
  action: "create" | "edit";
  content: string;
  // 指定した場合、現在の内容がこのハッシュと一致するときだけ書き込む。
  expectedHash?: string;
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
      expected_hash: request.expectedHash,
    },
    { timeout: 0 },
  );
}

export async function getFileContent(
  projectId: string,
  path: string,
): Promise<FileContent> {
  const response = await apiClient.get<unknown>(
    `/projects/${projectId}/files/content`,
    { params: { path } },
  );
  const result = fileContentSchema.parse(response.data);
  return {
    content: result.content,
    contentHash: result.content_hash,
    path: result.path,
  };
}

export async function saveFileContent(
  request: SaveFileContentRequest,
): Promise<string> {
  const response = await apiClient.put<unknown>(
    `/projects/${request.projectId}/files/content`,
    {
      path: request.path,
      content: request.content,
      expected_hash: request.expectedHash,
    },
    // 書き込みはサーバー側で中断できないため、途中で失敗扱いにせず完了を待つ。
    { timeout: 0 },
  );
  return saveFileContentResponseSchema.parse(response.data).content_hash;
}

export function isFileConflictError(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 409;
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
