import { createBrowserRouter, Navigate } from "react-router-dom";
import { ActivitiesPage } from "@/features/activities/ActivitiesPage";
import { ActivityPage } from "@/features/activity/ActivityPage";
import { ComparePage } from "@/features/compare/ComparePage";
import { LoginPage } from "@/features/auth/LoginPage";
import { MapPage } from "@/features/map/MapPage";
import { RoutePage } from "@/features/routes/RoutePage";
import { RoutesPage } from "@/features/routes/RoutesPage";
import { AppShell } from "@/features/shell/AppShell";
import { NotBuiltYet } from "@/features/shell/NotBuiltYet";
import { RouteError } from "@/features/shell/RouteError";
import { StatusPage } from "@/features/status/StatusPage";
import { TrendsPage } from "@/features/trends/TrendsPage";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage />, errorElement: <RouteError /> },
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      {
        // A view that throws shows its error here, with the nav still usable.
        errorElement: <RouteError />,
        children: [
          { index: true, element: <Navigate to="/status" replace /> },
          { path: "status", element: <StatusPage /> },
          { path: "activities", element: <ActivitiesPage /> },
          { path: "activities/:id", element: <ActivityPage /> },
          { path: "map", element: <MapPage /> },
          { path: "routes", element: <RoutesPage /> },
          { path: "routes/:id", element: <RoutePage /> },
          { path: "compare", element: <ComparePage /> },
          { path: "trends", element: <TrendsPage /> },
          { path: "*", element: <NotBuiltYet /> },
        ],
      },
    ],
  },
]);
