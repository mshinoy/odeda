import { useReducer } from "react";
import { useGarminStatus } from "@/api/queries/useGarmin";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot } from "@/components/StatusDot";
import { ConnectedCard } from "@/features/settings/ConnectedCard";
import { SignInForm } from "@/features/settings/SignInForm";
import { TicketFallback } from "@/features/settings/TicketFallback";
import { initialSignInState, signInReducer } from "@/features/settings/garminSignIn";
import { cn } from "@/lib/utils";

/**
 * The Garmin account: connected, or the three routes to becoming connected.
 *
 * The flow's state is the reducer's; the three children below are presentational
 * and report what happened back through `dispatch`.
 */
export function GarminPanel() {
  const status = useGarminStatus();
  const [state, dispatch] = useReducer(signInReducer, initialSignInState);

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-muted-foreground text-xs">Garmin account</h2>

      {status.isPending && <Skeleton className="h-24 w-full" />}
      {status.error && <p className="text-delta-bad text-sm">{status.error.message}</p>}

      {status.data &&
        (status.data.connected ? (
          <ConnectedCard
            connection={status.data}
            onDisconnected={() => dispatch({ type: "restart" })}
          />
        ) : (
          <div className="flex flex-col gap-6">
            <p className="text-muted-foreground text-sm">
              <StatusDot
                tone="neutral"
                label="Not connected. Nothing can sync until you sign in."
              />
            </p>
            <SignInForm state={state} dispatch={dispatch} />
            <TicketFallback state={state} dispatch={dispatch} />
          </div>
        ))}

      {state.notice && (
        <p
          className={cn(
            "text-sm",
            state.notice.tone === "error" ? "text-delta-bad" : "text-muted-foreground",
          )}
          role="status"
        >
          <StatusDot
            tone={state.notice.tone === "error" ? "critical" : "neutral"}
            label={state.notice.message}
          />
        </p>
      )}
    </section>
  );
}
