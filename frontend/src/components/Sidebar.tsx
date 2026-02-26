import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { listImports } from "../api/client";
import { useAuth } from "../contexts/AuthContext";

const NAV = [
  { to: "/overview", label: "Overview", icon: "📊" },
  { to: "/budgets", label: "Budgets", icon: "💰" },
  { to: "/transactions", label: "Transactions", icon: "↕" },
  { to: "/accounts", label: "Accounts", icon: "🏦" },
  { to: "/merchants", label: "Merchants", icon: "🏪" },
  { to: "/cardholders", label: "Card Holders", icon: "💳" },
  { to: "/categories", label: "Categories", icon: "🏷️" },
  { to: "/imports", label: "Imports", icon: "📋" },
  { to: "/recurring", label: "Recurring", icon: "🔁" },
  { to: "/monthly", label: "Monthly", icon: "📅" },
  { to: "/trends", label: "Trends", icon: "📈" },
  { to: "/help", label: "Help", icon: "❓" },
];

export default function Sidebar() {
  const { user, logout } = useAuth();
  const [hasInProgress, setHasInProgress] = useState(false);

  useEffect(() => {
    async function check() {
      try {
        const data = await listImports({ limit: 20, sort_by: "imported_at", sort_dir: "desc" });
        setHasInProgress(data.items.some((i) => i.status === "in-progress"));
      } catch {
        // ignore transient errors
      }
    }
    check();
    const id = setInterval(check, 3000);
    return () => clearInterval(id);
  }, []);

  return (
    <aside className="w-56 shrink-0 bg-gray-900 text-gray-100 flex flex-col h-screen sticky top-0">
      <div className="px-6 py-5 border-b border-gray-700">
        <span className="text-lg font-semibold tracking-tight">Budget</span>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors " +
              (isActive
                ? "bg-indigo-600 text-white"
                : "text-gray-300 hover:bg-gray-800 hover:text-white")
            }
          >
            <span>{icon}</span>
            {label}
            {to === "/imports" && hasInProgress && (
              <span className="ml-auto h-3 w-3 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" />
            )}
          </NavLink>
        ))}
      </nav>
      {user && (
        <div className="px-4 py-3 border-t border-gray-700 text-sm">
          <div className="text-gray-300 truncate">{user.name}</div>
          <button onClick={logout} className="text-gray-500 hover:text-white text-xs mt-1">
            Sign out
          </button>
        </div>
      )}
    </aside>
  );
}
