import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { listImports } from "../api/client";
import { useAuth } from "../contexts/AuthContext";

const OVERVIEW_NAV = { to: "/overview", label: "Overview", icon: "📊" };

const NAV_GROUPS = [
  {
    label: "Transactions",
    items: [
      { to: "/transactions", label: "Transactions", icon: "↕" },
      { to: "/budgets", label: "Budgets", icon: "💰" },
      { to: "/recurring", label: "Recurring", icon: "🔁" },
    ],
  },
  {
    label: "Reports",
    items: [
      { to: "/monthly", label: "Monthly", icon: "📅" },
      { to: "/yearly", label: "Yearly", icon: "📆" },
      { to: "/trends", label: "Trends", icon: "📈" },
      { to: "/categories", label: "Categories", icon: "🏷️" },
      { to: "/merchants", label: "Merchants", icon: "🏪" },
      { to: "/tags", label: "Tags", icon: "🔖" },
      { to: "/transfers", label: "Transfers", icon: "↔" },
    ],
  },
  {
    label: "Manage",
    items: [
      { to: "/accounts", label: "Accounts", icon: "🏦" },
      { to: "/cardholders", label: "Card Holders", icon: "💳" },
      { to: "/imports", label: "Imports", icon: "📋" },
      { to: "/duplicates", label: "Duplicates", icon: "⚠️" },
      { to: "/debug", label: "Debug", icon: "🔧" },
    ],
  },
];

const HELP_NAV = { to: "/help", label: "Help", icon: "❓" };

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors " +
  (isActive ? "bg-indigo-600 text-white" : "text-gray-300 hover:bg-gray-800 hover:text-white");

export default function Sidebar({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
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
    <aside
      className={`fixed inset-y-0 left-0 z-30 w-56 bg-gray-900 text-gray-100 flex flex-col transition-transform duration-300 md:sticky md:top-0 md:h-screen md:translate-x-0 ${isOpen ? "translate-x-0" : "-translate-x-full"}`}
    >
      <div className="px-6 py-5 border-b border-gray-700">
        <span className="text-lg font-semibold tracking-tight">Budget</span>
      </div>
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <div className="space-y-1 mb-4">
          <NavLink to={OVERVIEW_NAV.to} className={navLinkClass} onClick={onClose}>
            <span>{OVERVIEW_NAV.icon}</span>
            {OVERVIEW_NAV.label}
          </NavLink>
        </div>
        {NAV_GROUPS.map(({ label, items }) => (
          <div key={label} className="mt-4">
            <div className="px-3 mb-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              {label}
            </div>
            <div className="space-y-1">
              {items.map(({ to, label: itemLabel, icon }) => (
                <NavLink key={to} to={to} className={navLinkClass} onClick={onClose}>
                  <span>{icon}</span>
                  {itemLabel}
                  {to === "/imports" && hasInProgress && (
                    <span className="ml-auto h-3 w-3 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" />
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
        <div className="mt-4 space-y-1">
          <NavLink to={HELP_NAV.to} className={navLinkClass} onClick={onClose}>
            <span>{HELP_NAV.icon}</span>
            {HELP_NAV.label}
          </NavLink>
        </div>
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
