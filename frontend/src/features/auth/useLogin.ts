import { useMutation } from "@tanstack/react-query";
import { api, unwrap } from "@/api/client";

/** Exchanges the app password for a session cookie (set by the server). */
export function useLogin() {
  return useMutation({
    mutationFn: async (password: string) =>
      unwrap(await api.POST("/api/auth/login", { body: { password } })),
  });
}
