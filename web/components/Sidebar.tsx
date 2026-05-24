import { NavLink } from "react-router-dom";

export function Sidebar() {
  return (
    <nav className="sidebar">
      <h1>Skills Manager</h1>
      <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>Dashboard</NavLink>
      <NavLink to="/browse" className={({ isActive }) => (isActive ? "active" : "")}>Browse</NavLink>
      <NavLink to="/skills-repos" className={({ isActive }) => (isActive ? "active" : "")}>Skills repos</NavLink>
      <NavLink to="/working-repos" className={({ isActive }) => (isActive ? "active" : "")}>Working repos</NavLink>
      <NavLink to="/settings" className={({ isActive }) => (isActive ? "active" : "")}>Settings</NavLink>
      <NavLink to="/activity" className={({ isActive }) => (isActive ? "active" : "")}>Activity</NavLink>
    </nav>
  );
}
