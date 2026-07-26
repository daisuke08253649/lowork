import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";

import { getOllamaStatus } from "@/api/ollama";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const POLLING_INTERVAL_MS = 5_000;

export function OllamaWarningBanner() {
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function checkStatus(): Promise<void> {
      try {
        const status = await getOllamaStatus();
        if (isMounted) {
          setIsAvailable(status.available);
        }
      } catch {
        if (isMounted) {
          setIsAvailable(false);
        }
      }
    }

    void checkStatus();
    const intervalId = window.setInterval(
      () => void checkStatus(),
      POLLING_INTERVAL_MS,
    );

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  if (isAvailable !== false) {
    return null;
  }

  return (
    <Alert variant="destructive" className="mx-3 mt-3 w-auto">
      <TriangleAlert aria-hidden="true" />
      <AlertTitle>Ollamaに接続できません</AlertTitle>
      <AlertDescription>
        Ollamaを起動すると自動的に再接続します。
      </AlertDescription>
    </Alert>
  );
}
