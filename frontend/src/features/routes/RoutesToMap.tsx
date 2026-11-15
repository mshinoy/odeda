import { Navigate, useLocation } from "react-router-dom";

/** The routes list lives on the map; an old `/routes?route=3` link lands on `/map?route=3`. */
export function RoutesToMap() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: "/map", search }} replace />;
}
