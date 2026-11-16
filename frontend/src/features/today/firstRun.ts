import type { SetupStatus } from "@/api/queries/useBasics";

export interface FirstRunStep {
  key: "basics" | "garmin" | "sync" | "password";
  title: string;
  detail: string;
  done: boolean;
}

/**
 * The card is for a brand-new install only: it shows while there is not a single
 * activity, and is gone the moment the first sync lands. Someone who loaded demo data
 * or imported a file has activities and never sees it.
 */
export function showFirstRun(setup: SetupStatus | undefined): boolean {
  return setup !== undefined && setup.activities === 0;
}

/** The steps in the order a person should do them, each with whether it is done. */
export function firstRunSteps(setup: SetupStatus): FirstRunStep[] {
  const steps: FirstRunStep[] = [
    {
      key: "basics",
      title: "Check the basics",
      detail: "Your time zone and heart-rate limits. Every load number is worked out from them.",
      done: setup.basics_saved,
    },
    {
      key: "garmin",
      title: "Connect Garmin",
      detail: "Your password is used once to get a token and is never stored.",
      done: setup.garmin_connected,
    },
    {
      key: "sync",
      title: "Start the sync",
      detail: "It shows the size and the time before it starts, and can be stopped and resumed.",
      // Only meaningful once connected; with no activities it is never "done" here,
      // because the card disappears as soon as the first one arrives.
      done: false,
    },
  ];
  if (!setup.password_set) {
    steps.push({
      key: "password",
      title: "Set a password",
      detail: "Without one, anyone who can reach this page can read your data.",
      done: false,
    });
  }
  return steps;
}
