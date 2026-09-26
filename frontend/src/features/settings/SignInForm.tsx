import { useState, type Dispatch, type FormEvent } from "react";
import { useGarminLogin, useGarminMfa } from "@/api/queries/useGarmin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SignInEvent, SignInState } from "@/features/settings/garminSignIn";

interface SignInFormProps {
  state: SignInState;
  dispatch: Dispatch<SignInEvent>;
}

/** Email and password, then the code if Garmin asks for one. */
export function SignInForm({ state, dispatch }: SignInFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const login = useGarminLogin();
  const mfa = useGarminMfa();

  const onMfa = state.stage.kind === "mfa";
  const challengeId = state.stage.kind === "mfa" ? state.stage.challengeId : "";
  const pending = login.isPending || mfa.isPending;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (onMfa) {
      mfa.mutate(
        { challengeId, code: code.trim() },
        {
          onSuccess: (result) => {
            setCode("");
            dispatch({ type: "connected", displayName: result.display_name });
          },
          onError: (error) => dispatch({ type: "failed", error }),
        },
      );
      return;
    }
    login.mutate(
      { email: email.trim(), password },
      {
        // The password leaves the form the moment it has been sent, whichever way
        // the exchange went: it is not needed again on either path.
        onSuccess: (result) => {
          setPassword("");
          dispatch({ type: "login_answered", result });
        },
        onError: (error) => {
          setPassword("");
          dispatch({ type: "failed", error });
        },
      },
    );
  }

  return (
    <form onSubmit={submit} className="flex max-w-sm flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="garmin-email">Email</Label>
        <Input
          id="garmin-email"
          type="email"
          autoComplete="username"
          value={email}
          disabled={onMfa}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="garmin-password">Password</Label>
        <Input
          id="garmin-password"
          type="password"
          autoComplete="current-password"
          value={password}
          disabled={onMfa}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>

      {onMfa && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="garmin-code">Code</Label>
          <Input
            id="garmin-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoFocus
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending || submitDisabled(onMfa, email, password, code)}>
          {onMfa ? "Verify" : "Connect"}
        </Button>
        {onMfa && (
          <Button type="button" variant="ghost" onClick={() => dispatch({ type: "restart" })}>
            Start again
          </Button>
        )}
      </div>
    </form>
  );
}

function submitDisabled(onMfa: boolean, email: string, password: string, code: string): boolean {
  return onMfa ? code.trim() === "" : email.trim() === "" || password === "";
}
