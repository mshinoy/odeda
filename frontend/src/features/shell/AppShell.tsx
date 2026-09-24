import { Settings } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/today", label: "Today" },
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
  return (
    <div className="min-h-svh">
      <header className="bg-background/85 sticky top-0 z-20 border-b backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <nav className="flex items-center gap-1">
            {navItems.map((item) => (
              <NavLink key={item.to} to={item.to} className={navLinkClass}>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <NavLink
            to="/settings"
            aria-label="Settings"
            className={(state) => cn(navLinkClass(state), "ml-auto px-2")}
          >
            <Settings className="size-4" />
          </NavLink>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
