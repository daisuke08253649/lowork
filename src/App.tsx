import { Navigate, Route, Routes } from "react-router";

import { MainPanel } from "@/components/layout/MainPanel";
import { Sidebar } from "@/components/layout/Sidebar";
import { NormalChat } from "@/pages/NormalChat";
import { ProjectList } from "@/pages/ProjectList";
import { Settings } from "@/pages/Settings";
import "@/store/themeStore";
import "./App.css";

function App() {
  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar />
      <MainPanel>
        <Routes>
          <Route path="/" element={<NormalChat />} />
          <Route path="/projects" element={<ProjectList />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </MainPanel>
    </div>
  );
}

export default App;
