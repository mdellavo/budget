import { NavLink } from "react-router-dom";

const NAV = [
  { to: "/overview", label: "Overview", icon: "📊" },
  { to: "/transactions", label: "Transactions", icon: "↕" },
  { to: "/accounts", label: "Accounts", icon: "🏦" },
  { to: "/merchants", label: "Merchants", icon: "🏪" },
  { to: "/categories", label: "Categories", icon: "🏷️" },
  { to: "/imports",   label: "Imports",   icon: "📋" },
  { to: "/recurring", label: "Recurring", icon: "🔁" },
  { to: "/monthly",   label: "Monthly",   icon: "📅" },
];

export default function Sidebar() {
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
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
