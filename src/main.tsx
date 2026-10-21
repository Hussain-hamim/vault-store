import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "@fontsource-variable/plus-jakarta-sans";
import "./styles.css";

// Number fields must only change by typing digits — not scroll or stepper keys.
document.addEventListener(
  "wheel",
  (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== "number")
      return;
    if (document.activeElement === target) event.preventDefault();
  },
  { passive: false },
);
document.addEventListener("keydown", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.type !== "number") return;
  if (event.key === "ArrowUp" || event.key === "ArrowDown") event.preventDefault();
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
