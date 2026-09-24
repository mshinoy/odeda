import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/App";
import { initTheme } from "@/design/theme";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("index.html is missing #root");

// Before the first render, so the first paint already has the right theme.
initTheme();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
