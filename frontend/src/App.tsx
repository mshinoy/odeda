import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";
import { queryClient } from "@/api/queryClient";
import { TooltipProvider } from "@/components/ui/tooltip";
import { router } from "@/routes";

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={150}>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
