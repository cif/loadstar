import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./index.css";
import App from "./App";
import { Landing } from "./components/landing";
import { ArchitectureDiagram } from "./components/architecture-diagram";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/demo" element={<App />} />
        <Route path="/arch" element={<ArchitectureDiagram />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
