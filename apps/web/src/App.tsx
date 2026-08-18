import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { VaultDashboardProvider } from "./hooks/useVaultDashboard";
import { Analytics } from "./pages/Analytics";
import { Home } from "./pages/Home";
import { Safety } from "./pages/Safety";
import { Swap } from "./pages/Swap";
import { Vault } from "./pages/Vault";

export function App() {
  return (
    <BrowserRouter>
      <VaultDashboardProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Home />} />
            <Route path="vault" element={<Vault />} />
            <Route path="swap" element={<Swap />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="safety" element={<Safety />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </VaultDashboardProvider>
    </BrowserRouter>
  );
}
