import { FolderKanban, MessageSquarePlus, Settings } from "lucide-react";
import { useLocation, useNavigate } from "react-router";

import { Button } from "@/components/ui/button";

const navigationItems = [
  { label: "新しいチャット", path: "/", icon: MessageSquarePlus },
  { label: "プロジェクト", path: "/projects", icon: FolderKanban },
  { label: "設定", path: "/settings", icon: Settings },
];

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="border-b px-4 py-5">
        <p className="text-lg font-semibold tracking-tight">lowork</p>
        <p className="mt-1 text-xs text-muted-foreground">ローカルAIアシスタント</p>
      </div>

      <nav className="space-y-1 p-3" aria-label="メインナビゲーション">
        {navigationItems.map(({ icon: Icon, label, path }) => (
          <Button
            key={path}
            className="w-full justify-start"
            variant={location.pathname === path ? "secondary" : "ghost"}
            onClick={() => navigate(path)}
          >
            <Icon aria-hidden="true" />
            {label}
          </Button>
        ))}
      </nav>

      <div className="mx-3 border-t" />

      <section className="min-h-0 flex-1 px-3 py-4" aria-labelledby="history-heading">
        <h2 id="history-heading" className="px-2 text-xs font-medium text-muted-foreground">
          チャット履歴
        </h2>
        <p className="px-2 pt-3 text-sm text-muted-foreground">履歴はまだありません</p>
      </section>
    </aside>
  );
}
