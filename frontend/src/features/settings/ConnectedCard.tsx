import { useState } from "react";
import type { GarminConnection } from "@/api/adapters";
import { useGarminDisconnect } from "@/api/queries/useGarmin";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusDot } from "@/components/StatusDot";
import { formatAgo } from "@/lib/format";

interface ConnectedCardProps {
  connection: GarminConnection;
  onDisconnected: () => void;
}

/** The connected state: when the tokens were last refreshed, and the way out. */
export function ConnectedCard({ connection, onDisconnected }: ConnectedCardProps) {
  const [confirming, setConfirming] = useState(false);
  const disconnect = useGarminDisconnect();

  return (
    <div className="flex max-w-lg flex-wrap items-center justify-between gap-4 rounded-lg border p-4">
      <div className="flex flex-col gap-1">
        <StatusDot tone="good" label="Connected" />
        <p className="text-muted-foreground text-xs">
          Tokens refreshed {formatAgo(connection.tokensUpdatedAt)}
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
        Disconnect
      </Button>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect Garmin?</DialogTitle>
            <DialogDescription>
              The saved tokens are deleted and no sync can run until you sign in again. Nothing
              already downloaded is touched.
            </DialogDescription>
          </DialogHeader>
          {disconnect.error && <p className="text-delta-bad text-sm">{disconnect.error.message}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              disabled={disconnect.isPending}
              onClick={() =>
                disconnect.mutate(undefined, {
                  onSuccess: () => {
                    setConfirming(false);
                    onDisconnected();
                  },
                })
              }
            >
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
