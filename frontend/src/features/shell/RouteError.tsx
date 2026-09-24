import { isRouteErrorResponse, useRouteError } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";

function errorMessage(error: unknown): string {
  if (isRouteErrorResponse(error)) return `${error.status} ${error.statusText}`;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

/**
 * Shown instead of a blank page when a view throws while rendering. The message is the
 * real error, so a screenshot of it is enough to debug from.
 */
export function RouteError() {
  const error = useRouteError();
  console.error(error);

  return (
    <EmptyState
      message={errorMessage(error)}
      action={
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          Reload
        </Button>
      }
    />
  );
}
