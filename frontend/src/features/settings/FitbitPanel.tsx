import { useState } from "react";
import {
  fetchFitbitAuthorizeUrl,
  useFitbitConnect,
  useFitbitDisconnect,
  useFitbitStatus,
  useFitbitSync,
} from "@/api/queries/useFitbit";
import { StatusDot } from "@/components/StatusDot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { FitbitImportForm } from "@/features/settings/FitbitImportForm";
import { fitbitStage, storedSummary, syncSummary } from "@/features/settings/fitbitSummary";
import { errorMessage } from "@/features/settings/garminSignIn";

/**
 * The Fitbit account: the scale, and the only source that knows what you weigh.
 *
 * Two routes in and they are here for different reasons. The consent flow is the
 * normal one. The export import below it needs no credential at all, which makes it
 * both the fallback if Google retires the Web API and the fastest way to load years of
 * history without touching the 150-an-hour budget.
 */
export function FitbitPanel() {
  const status = useFitbitStatus();
  const connect = useFitbitConnect();
  const disconnect = useFitbitDisconnect();
  const sync = useFitbitSync();

  const [redirect, setRedirect] = useState("");
  const [consentUrl, setConsentUrl] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  async function openConsent() {
    setLocalError(null);
    try {
      const url = await fetchFitbitAuthorizeUrl();
      setConsentUrl(url);
      // Popup blockers are common and silent, so the address is shown either way.
      window.open(url, "_blank", "noopener");
    } catch (error) {
      setLocalError(errorMessage(error));
    }
  }

  const stage = status.data ? fitbitStage(status.data) : null;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-muted-foreground text-xs">Fitbit (the scale)</h2>

      {status.isPending && <Skeleton className="h-24 w-full" />}
      {status.error && <p className="text-delta-bad text-sm">{status.error.message}</p>}

      {status.data && stage === "no_credentials" && (
        <div className="flex max-w-lg flex-col gap-2">
          <StatusDot
            tone="neutral"
            label="No Fitbit app registered. Nothing can connect until there is one."
          />
          <p className="text-muted-foreground text-sm">
            Register a Personal app at dev.fitbit.com/apps and put its client ID and secret in the
            environment as FITBIT_CLIENT_ID and FITBIT_CLIENT_SECRET, then restart.
          </p>
          <p className="text-muted-foreground text-xs break-all">
            The redirect URL it has to be registered with is {status.data.redirect_uri}
          </p>
        </div>
      )}

      {status.data && stage === "not_connected" && (
        <div className="flex max-w-lg flex-col gap-3">
          <StatusDot tone="neutral" label="Not connected. No weigh-ins can arrive." />
          <div>
            <Button type="button" variant="outline" size="sm" onClick={() => void openConsent()}>
              Connect Fitbit
            </Button>
          </div>

          {consentUrl && (
            <p className="text-muted-foreground text-xs break-all">
              Blocked as a popup? Open{" "}
              <a className="underline" href={consentUrl} target="_blank" rel="noreferrer">
                {consentUrl}
              </a>
            </p>
          )}

          <p className="text-muted-foreground text-sm">
            Approve the weight permission, then paste the address you land on — unless it landed
            back here, in which case you are already connected.
          </p>

          <Input
            aria-label="Fitbit redirect address"
            placeholder="http://localhost:8000/api/fitbit/callback?code=…"
            value={redirect}
            onChange={(event) => setRedirect(event.target.value)}
          />
          <div>
            <Button
              type="button"
              size="sm"
              disabled={connect.isPending || redirect.trim() === ""}
              onClick={() =>
                connect.mutate(redirect.trim(), {
                  // The code is a credential while it lives, and single-use besides.
                  onSettled: () => setRedirect(""),
                  onSuccess: () => setConsentUrl(null),
                })
              }
            >
              Finish connecting
            </Button>
          </div>
          {connect.error && <p className="text-delta-bad text-sm">{connect.error.message}</p>}
        </div>
      )}

      {status.data && stage === "connected" && (
        <div className="flex max-w-lg flex-col gap-3 rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <StatusDot tone="good" label="Connected" />
              <p className="text-muted-foreground text-xs">{storedSummary(status.data)}</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={sync.isPending}
                onClick={() => sync.mutate()}
              >
                {sync.isPending ? "Syncing…" : "Sync weigh-ins"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={disconnect.isPending}
                onClick={() => disconnect.mutate()}
              >
                Disconnect
              </Button>
            </div>
          </div>
          {sync.data && (
            <p className="text-muted-foreground text-sm" role="status">
              {syncSummary(sync.data)}
            </p>
          )}
          {sync.error && <p className="text-delta-bad text-sm">{sync.error.message}</p>}
          {disconnect.error && <p className="text-delta-bad text-sm">{disconnect.error.message}</p>}
        </div>
      )}

      {localError && <p className="text-delta-bad text-sm">{localError}</p>}

      <FitbitImportForm />
    </section>
  );
}
