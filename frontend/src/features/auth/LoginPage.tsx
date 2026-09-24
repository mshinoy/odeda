import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLogin } from "@/features/auth/useLogin";
import { safeNextPath } from "@/features/auth/safeNextPath";

export function LoginPage() {
  const [password, setPassword] = useState("");
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const login = useLogin();

  function submit(event: FormEvent) {
    event.preventDefault();
    login.mutate(password, {
      onSuccess: () => navigate(safeNextPath(params.get("next")), { replace: true }),
    });
  }

  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      <form onSubmit={submit} className="flex w-full max-w-xs flex-col gap-3">
        <Input
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          aria-label="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoFocus
        />
        <Button type="submit" disabled={login.isPending || password === ""}>
          Sign in
        </Button>
        {login.error && <p className="text-delta-bad text-sm">{login.error.message}</p>}
      </form>
    </main>
  );
}
