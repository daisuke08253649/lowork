import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { ProjectFileOperation } from "@/api/chat";

type DiffPreviewProps = {
  error: string | null;
  fileOperation: ProjectFileOperation | null;
  isApplying: boolean;
  onApply: () => void;
  onClose: () => void;
};

export function DiffPreview({
  error,
  fileOperation,
  isApplying,
  onApply,
  onClose,
}: DiffPreviewProps) {
  const action = fileOperation?.action === "create" ? "作成" : "編集";
  const title = fileOperation
    ? `${fileOperation.filename} を${action}します`
    : "ファイル操作を確認";

  return (
    <AlertDialog
      open={fileOperation !== null}
      onOpenChange={(open) => {
        if (!open && !isApplying) {
          onClose();
        }
      }}
    >
      <AlertDialogContent className="max-w-3xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            ファイルの内容を確認してから適用してください。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <pre className="mt-4 max-h-[50vh] overflow-auto rounded-md bg-muted p-4 text-left text-sm whitespace-pre-wrap break-words">
          <code>{fileOperation?.content || "（内容は空です）"}</code>
        </pre>
        {error ? (
          <p className="mt-3 text-sm text-destructive">{error}</p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={isApplying}
            render={<Button variant="outline" />}
          >
            キャンセル
          </AlertDialogCancel>
          <Button disabled={isApplying} onClick={onApply}>
            {isApplying ? "適用中..." : "適用する"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
