import { NavLink, Outlet } from "react-router-dom";
import { cn } from "@/lib/utils";

// Where the training pages live, one tab each: the plan, the race, the load behind both,
// and how the running has been going. Plan is the page `/train` itself.
const tabs = [
  { to: "/train", label: "Plan", end: true },
  { to: "/train/race", label: "Race", end: false },
  { to: "/train/load", label: "Load", end: false },
  { to: "/train/trends", label: "Trends", end: false },
] as const;

/** Train: the plan, the race, the load and the trends under one nav entry. */
export function TrainLayout() {
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Train" className="flex items-center gap-1">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                isActive
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
