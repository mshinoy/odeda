import { createBrowserRouter, Navigate } from "react-router-dom";
import { ActivitiesPage } from "@/features/activities/ActivitiesPage";
import { ActivityPage } from "@/features/activity/ActivityPage";
import { ComparePage } from "@/features/compare/ComparePage";
import { GearPage } from "@/features/gear/GearPage";
import { HealthPage } from "@/features/health/HealthPage";
import { LoginPage } from "@/features/auth/LoginPage";
import { MapPage } from "@/features/map/MapPage";
import { PlanPage } from "@/features/plan/PlanPage";
import { RoutesToMap } from "@/features/routes/RoutesToMap";
import { Redirect } from "@/features/shell/Redirect";
import { LoadTab } from "@/features/train/LoadTab";
import { TrainLayout } from "@/features/train/TrainLayout";
import { RoutePage } from "@/features/routes/RoutePage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { AppShell } from "@/features/shell/AppShell";
import { NotFound } from "@/features/shell/NotFound";
import { RouteError } from "@/features/shell/RouteError";
import { RacePage } from "@/features/race/RacePage";
import { TodayPage } from "@/features/today/TodayPage";
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
          { path: "status", element: <TodayPage /> },
          {
            // Train: the plan, the race, the load and the trends, one tab each.
            path: "train",
            element: <TrainLayout />,
            children: [
              { index: true, element: <PlanPage /> },
              { path: "race", element: <RacePage /> },
              { path: "load", element: <LoadTab /> },
              { path: "trends", element: <TrendsPage /> },
            ],
          },
          // The old addresses keep working, with their query.
          { path: "plan", element: <Redirect to="/train" /> },
          { path: "race", element: <Redirect to="/train/race" /> },
          { path: "trends", element: <Redirect to="/train/trends" /> },
          { path: "activities", element: <ActivitiesPage /> },
          { path: "activities/:id", element: <ActivityPage /> },
          { path: "map", element: <MapPage /> },
          { path: "health", element: <HealthPage /> },
          // The list of routes lives on the map now; old links keep their ?route= and ?kind=.
          { path: "routes", element: <RoutesToMap /> },
          { path: "routes/:id", element: <RoutePage /> },
          { path: "compare", element: <ComparePage /> },
          { path: "settings", element: <SettingsPage /> },
          { path: "gear", element: <GearPage /> },
          { path: "*", element: <NotFound /> },
        ],
      },
    ],
  },
]);
