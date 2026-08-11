import { FileText, Folder, FolderOpen, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import {
  getProjectErrorMessage,
  getProjectFileTree,
  getProjectIndexStatus,
  type FileTreeNode,
  type IndexStatus,
} from "@/api/projects";
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const INDEX_STATUS_POLL_INTERVAL_MS = 2_000;

type FileTreeProps = {
  projectId: string;
};

type TreeNodeProps = {
  depth: number;
  node: FileTreeNode;
};

function TreeNode({ depth, node }: TreeNodeProps) {
  const [isOpen, setIsOpen] = useState(true);
  const isDirectory = node.type === "directory";
  const hasChildren = node.children.length > 0;

  function handleFileClick(): void {
    // ファイルプレビューはMVPの対象外。将来の機能追加用にクリック領域だけを用意する。
  }

  return (
    <li>
      {isDirectory ? (
        <button
          aria-expanded={isOpen}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          type="button"
          onClick={() => setIsOpen((open) => !open)}
        >
          {isOpen ? (
            <FolderOpen className="size-4 shrink-0" aria-hidden="true" />
          ) : (
            <Folder className="size-4 shrink-0" aria-hidden="true" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
      ) : (
        <button
          className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          type="button"
          onClick={handleFileClick}
        >
          <FileText className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{node.name}</span>
        </button>
      )}

      {isDirectory && isOpen && hasChildren ? (
        <TreeNodes depth={depth + 1} nodes={node.children} />
      ) : null}
    </li>
  );
}

function TreeNodes({ depth, nodes }: { depth: number; nodes: FileTreeNode[] }) {
  return (
    <ul>
      {nodes.map((node) => (
        <TreeNode key={node.path} depth={depth} node={node} />
      ))}
    </ul>
  );
}

function IndexProgress({ indexStatus }: { indexStatus: IndexStatus }) {
  if (indexStatus.status === "done") {
    return null;
  }

  const isError = indexStatus.status === "error";
  const label = isError
    ? "インデックスの作成に失敗しました"
    : "インデックスを作成中";

  return (
    <div className="border-t px-4 py-3">
      <Progress value={indexStatus.progress}>
        <ProgressLabel className={cn(isError && "text-destructive")}>
          {label}
        </ProgressLabel>
        <ProgressValue />
      </Progress>
    </div>
  );
}

export function FileTree({ projectId }: FileTreeProps) {
  const [tree, setTree] = useState<FileTreeNode | null>(null);
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;
    let intervalId: number | undefined;

    async function loadTree(): Promise<void> {
      try {
        const result = await getProjectFileTree(projectId);
        if (isActive) {
          setTree(result);
          setTreeError(null);
        }
      } catch (loadError) {
        if (isActive) {
          setTreeError(
            getProjectErrorMessage(
              loadError,
              "ファイルツリーの取得に失敗しました",
            ),
          );
        }
      }
    }

    async function loadIndexStatus(): Promise<void> {
      try {
        const result = await getProjectIndexStatus(projectId);
        if (isActive) {
          setIndexStatus(result);
          setStatusError(null);
          if (result.status !== "indexing" && intervalId !== undefined) {
            window.clearInterval(intervalId);
          }
        }
      } catch (loadError) {
        if (isActive) {
          setStatusError(
            getProjectErrorMessage(
              loadError,
              "インデックス進捗の取得に失敗しました",
            ),
          );
        }
      }
    }

    void loadTree();
    void loadIndexStatus();
    intervalId = window.setInterval(() => {
      void loadIndexStatus();
    }, INDEX_STATUS_POLL_INTERVAL_MS);

    return () => {
      isActive = false;
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
    };
  }, [projectId]);

  const error = treeError ?? statusError;

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l bg-card">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">ファイルツリー</h2>
      </div>

      {error ? (
        <div className="flex gap-2 px-4 py-3 text-sm text-destructive">
          <TriangleAlert
            className="mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          <p>{error}</p>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {tree ? (
          <ul>
            <TreeNode depth={0} node={tree} />
          </ul>
        ) : !error ? (
          <p className="px-4 py-2 text-sm text-muted-foreground">
            読み込み中...
          </p>
        ) : null}
      </div>

      {indexStatus ? <IndexProgress indexStatus={indexStatus} /> : null}
    </aside>
  );
}
