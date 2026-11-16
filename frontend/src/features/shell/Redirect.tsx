import { Navigate, useLocation } from "react-router-dom";

/** An old address lands on its new home and keeps its query, so `?week=...` links still work. */
export function Redirect({ to }: { to: string }) {
  const { search } = useLocation();
  return <Navigate to={{ pathname: to, search }} replace />;
}
