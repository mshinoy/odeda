import { ChevronDown } from "lucide-react";
import { useState, type Dispatch } from "react";
import { fetchSigninUrl, useGarminTicket } from "@/api/queries/useGarmin";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { errorMessage, type SignInEvent, type SignInState } from "@/features/settings/garminSignIn";

interface TicketFallbackProps {
  state: SignInState;
  dispatch: Dispatch<SignInEvent>;
}

/**
 * D44: Garmin's web sign-in sets its cookies from JavaScript, so a browser has to do
 * that half. The ticket it leaves in the address bar exchanges for tokens from here.
 * A 503 on the password route opens this, because retyping cannot fix that failure.
 */
export function TicketFallback({ state, dispatch }: TicketFallbackProps) {
  const [ticket, setTicket] = useState("");
  const [signinUrl, setSigninUrl] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const exchange = useGarminTicket();

  async function openSignin() {
    setLocalError(null);
    try {
      const url = await fetchSigninUrl();
      setSigninUrl(url);
      // Popup blockers are common and silent, so the address is shown either way.
      window.open(url, "_blank", "noopener");
    } catch (error) {
      setLocalError(errorMessage(error));
    }
  }

  function submit() {
    exchange.mutate(ticket.trim(), {
      // A ticket is a credential while it lives, and single-use besides.
      onSuccess: (result) => {
        setTicket("");
        setSigninUrl(null);
        dispatch({ type: "connected", displayName: result.display_name });
      },
      onError: (error) => {
        setTicket("");
        dispatch({ type: "failed", error });
      },
    });
  }

  return (
    <Collapsible
      open={state.fallbackOpen}
      onOpenChange={(open) => dispatch({ type: "toggle_fallback", open })}
      className="max-w-lg border-t"
    >
      <CollapsibleTrigger className="group text-muted-foreground hover:text-foreground focus-visible:ring-ring flex w-full items-center justify-between rounded-sm py-3 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none">
        <span>Sign in through a browser instead</span>
        <ChevronDown
          aria-hidden
          className="size-4 transition-transform duration-150 group-data-[state=open]:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-3 pb-6">
        <p className="text-muted-foreground text-sm">
          Sign in on Garmin's own page, then paste the address you land on.
        </p>

        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => void openSignin()}>
            Open Garmin sign-in
          </Button>
        </div>

        {signinUrl && (
          <p className="text-muted-foreground text-xs break-all">
            Blocked as a popup? Open{" "}
            <a className="underline" href={signinUrl} target="_blank" rel="noreferrer">
              {signinUrl}
            </a>
          </p>
        )}

        <Input
          aria-label="Sign-in address"
          placeholder="https://connect.garmin.com/modern/?ticket=ST-…"
          value={ticket}
          onChange={(event) => setTicket(event.target.value)}
        />

        <div>
          <Button
            type="button"
            size="sm"
            disabled={exchange.isPending || ticket.trim() === ""}
            onClick={submit}
          >
            Finish sign-in
          </Button>
        </div>

        {localError && <p className="text-delta-bad text-sm">{localError}</p>}
      </CollapsibleContent>
    </Collapsible>
  );
}
