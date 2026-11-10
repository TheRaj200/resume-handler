import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { FloatApp } from "./FloatApp";
import "../styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <StrictMode>
    <FloatApp />
  </StrictMode>,
);
