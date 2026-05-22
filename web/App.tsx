import { BrowserRouter } from "react-router-dom";
import { Sidebar } from "./components/Sidebar.tsx";
import { AppRoutes } from "./routes.tsx";

export function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <Sidebar />
        <main className="main"><AppRoutes /></main>
      </div>
    </BrowserRouter>
  );
}
