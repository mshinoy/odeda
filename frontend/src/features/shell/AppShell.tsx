import { Footprints, Settings } from "lucide-react";
import { NavLink, Outlet, ScrollRestoration } from "react-router-dom";
import { useAutoSync } from "@/api/queries/useStatus";
import { cn } from "@/lib/utils";

// Six since D11 added the plan: Today · Plan · Activities · Map · Health · Trends.
const navItems = [
  { to: "/status", label: "Today" },
  { to: "/plan", label: "Plan" },
  { to: "/activities", label: "Activities" },
  { to: "/map", label: "Map" },
  { to: "/health", label: "Health" },
  { to: "/trends", label: "Trends" },
] as const;

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return cn(
    "rounded-md px-3 py-1.5 text-sm transition-colors",
    isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
  );
}

export function AppShell() {
  // Here rather than on Settings: a run that lands while any page is open refreshes it.
  useAutoSync();

  return (
    <div className="min-h-svh">
      <header className="bg-background/85 sticky top-0 z-20 border-b backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1480px] items-center gap-6 px-8">
          <nav className="flex items-center gap-1">
            {navItems.map((item) => (
              <NavLink key={item.to} to={item.to} className={navLinkClass}>
                {item.label}
              </NavLink>
            ))}
          </nav>
          {/* Gear and Settings stay in the corner, out of the nav. */}
          <NavLink
            to="/gear"
            aria-label="Gear"
            className={(state) => cn(navLinkClass(state), "ml-auto px-2")}
          >
            <Footprints className="size-4" />
          </NavLink>
          <NavLink
            to="/settings"
            aria-label="Settings"
            className={(state) => cn(navLinkClass(state), "px-2")}
          >
            <Settings className="size-4" />
          </NavLink>
        </div>
      </header>
      <main className="short:py-3 mx-auto max-w-[1480px] px-8 py-6">
        <Outlet />
      </main>
      {/* A new page opens at the top; Back returns to where the list was scrolled. */}
      <ScrollRestoration />
    </div>
  );
}
