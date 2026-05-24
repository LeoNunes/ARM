import { Routes, Route } from "react-router-dom";
import { Dashboard } from "./pages/Dashboard.tsx";
import { Browse } from "./pages/Browse.tsx";
import { SkillsRepos } from "./pages/SkillsRepos.tsx";
import { SkillsRepoDetail } from "./pages/SkillsRepoDetail.tsx";
import { WorkingRepos } from "./pages/WorkingRepos.tsx";
import { WorkingRepoDetail } from "./pages/WorkingRepoDetail.tsx";
import { Settings } from "./pages/Settings.tsx";
import { Diff } from "./pages/Diff.tsx";
import { ActivityLog } from "./pages/ActivityLog.tsx";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/browse" element={<Browse />} />
      <Route path="/skills-repos" element={<SkillsRepos />} />
      <Route path="/skills-repos/:id" element={<SkillsRepoDetail />} />
      <Route path="/working-repos" element={<WorkingRepos />} />
      <Route path="/working-repos/:id" element={<WorkingRepoDetail />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/diff" element={<Diff />} />
      <Route path="/activity" element={<ActivityLog />} />
    </Routes>
  );
}
