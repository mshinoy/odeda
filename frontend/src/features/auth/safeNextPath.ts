/**
 * Where to go after signing in. Only same-app paths are followed, so a crafted
 * `?next=https://elsewhere` or `//elsewhere` link cannot bounce the user off-site.
 */
export function safeNextPath(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return "/";
  }
  if (next.startsWith("/login")) return "/";
  return next;
}
