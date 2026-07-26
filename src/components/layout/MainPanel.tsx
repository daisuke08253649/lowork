import type { ReactNode } from "react";

type MainPanelProps = {
  children: ReactNode;
};

export function MainPanel({ children }: MainPanelProps) {
  return <main className="min-w-0 flex-1 overflow-y-auto bg-background">{children}</main>;
}
