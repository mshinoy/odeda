import { SectionCard } from "@/components/SectionCard";
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
import {
  fitbitStage,
  signinNotice,
  storedSummary,
  syncSummary,
} from "@/features/settings/fitbitSummary";
import { errorMessage } from "@/features/settings/garminSignIn";

/**
 * The Fitbit account: the scale, and the only source that knows what you weigh.
 *
 * Two routes in and they are here for different reasons. The consent flow is the
 * normal one. The export import below it needs no credential at all, which makes it
 * both the fallback if Google retires the Web API and the fastest way to load years of
 * history without touching the 150-an-hour budget.
 */
/**
 * Open Google's consent page, then finish with the address it lands on. The same steps
 * connect for the first time and renew a sign-in Google is about to end (D9).
 */
function ConsentSteps({ label, onDone }: { label: string; onDone?: () => void }) {
  const connect = useFitbitConnect();
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

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => void openConsent()}>
          {label}
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
        Approve the weight permission, then paste the address you land on — unless it landed back
        here, in which case you are already connected.
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
              onSuccess: () => {
                setConsentUrl(null);
                onDone?.();
              },
            })
          }
        >
          Finish connecting
        </Button>
      </div>
      {connect.error && <p className="text-delta-bad text-sm">{connect.error.message}</p>}
      {localError && <p className="text-delta-bad text-sm">{localError}</p>}
    </div>
  );
}

export function FitbitPanel() {
  const status = useFitbitStatus();
  const disconnect = useFitbitDisconnect();
  const sync = useFitbitSync();
  const [reconnecting, setReconnecting] = useState(false);

  const stage = status.data ? fitbitStage(status.data) : null;
  const notice = status.data ? signinNotice(status.data) : null;

  return (
    <SectionCard title="Fitbit (the scale)" question="Where your weigh-ins come from.">
      {status.isPending && <Skeleton className="h-24 w-full" />}
      {status.error && <p className="text-delta-bad text-sm">{status.error.message}</p>}

      {status.data && stage === "no_credentials" && (
        <div className="flex w-full flex-col gap-2">
          <StatusDot
            tone="neutral"
            label="No Google Health app registered. Nothing can connect until there is one."
          />
          <p className="text-muted-foreground text-sm">
            Create a Web application OAuth client in Google Cloud, enable the Google Health API, and
            put its client ID and secret in the environment as GOOGLE_HEALTH_CLIENT_ID and
            GOOGLE_HEALTH_CLIENT_SECRET, then restart. While the client is unverified you also have
            to add yourself as a test user on its Audience page, or consent will fail.
          </p>
          <p className="text-muted-foreground text-xs break-all">
            The redirect URL it has to be registered with is {status.data.redirect_uri}
          </p>
        </div>
      )}

      {status.data && stage === "not_connected" && (
        <div className="flex w-full flex-col gap-3">
          <StatusDot tone="neutral" label="Not connected. No weigh-ins can arrive." />
          <ConsentSteps label="Connect Fitbit" />
        </div>
      )}

      {status.data && stage === "connected" && (
        <div className="flex w-full flex-col gap-3 rounded-lg border p-4">
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
              <Button variant="outline" size="sm" onClick={() => setReconnecting((open) => !open)}>
                Reconnect
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
          {notice && <StatusDot tone={notice.tone} label={notice.text} />}
          {(reconnecting || notice?.urgent) && (
            <ConsentSteps label="Open Google to reconnect" onDone={() => setReconnecting(false)} />
          )}
          {sync.data && (
            <p className="text-muted-foreground text-sm" role="status">
              {syncSummary(sync.data)}
            </p>
          )}
          {sync.error && <p className="text-delta-bad text-sm">{sync.error.message}</p>}
          {disconnect.error && <p className="text-delta-bad text-sm">{disconnect.error.message}</p>}
        </div>
      )}

      <FitbitImportForm />
    </SectionCard>
  );
}
