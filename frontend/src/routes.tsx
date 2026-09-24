import { createBrowserRouter } from "react-router-dom";
import { ActivityPage } from "@/features/activity/ActivityPage";
import { LoginPage } from "@/features/auth/LoginPage";
import { LatestActivityRedirect } from "@/features/activity/LatestActivityRedirect";
import { AppShell } from "@/features/shell/AppShell";
import { NotBuiltYet } from "@/features/shell/NotBuiltYet";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    element: <AppShell />,
    children: [
      { index: true, element: <LatestActivityRedirect /> },
      { path: "activities/:id", element: <ActivityPage /> },
      { path: "*", element: <NotBuiltYet /> },
    ],
  },
]);
