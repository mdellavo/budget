import { useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Sidebar from "./components/Sidebar";
import LoginPage from "./pages/LoginPage";
import OverviewPage from "./pages/OverviewPage";
import TransactionsPage from "./pages/TransactionsPage";
import AccountsPage from "./pages/AccountsPage";
import MerchantsPage from "./pages/MerchantsPage";
import MerchantMergePage from "./pages/MerchantMergePage";
import ImportsPage from "./pages/ImportsPage";
import RecurringPage from "./pages/RecurringPage";
import MonthlyPage from "./pages/MonthlyPage";
import YearlyPage from "./pages/YearlyPage";
import CategoriesPage from "./pages/CategoriesPage";
import CardHoldersPage from "./pages/CardHoldersPage";
import TrendPage from "./pages/TrendPage";
import BudgetPage from "./pages/BudgetPage";
import HelpPage from "./pages/HelpPage";
import DuplicatesPage from "./pages/DuplicatesPage";
import TagsPage from "./pages/TagsPage";
import TransfersPage from "./pages/TransfersPage";
import DebugPage from "./pages/DebugPage";

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <div className="flex min-h-screen bg-gray-50">
                  {sidebarOpen && (
                    <div
                      className="fixed inset-0 z-20 bg-black/40 md:hidden"
                      onClick={() => setSidebarOpen(false)}
                    />
                  )}
                  <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
                  <main className="flex-1 min-w-0 overflow-y-auto">
                    <header className="md:hidden sticky top-0 z-10 flex items-center gap-3 h-14 px-4 bg-gray-900 text-white shrink-0">
                      <button
                        onClick={() => setSidebarOpen(true)}
                        aria-label="Open menu"
                        className="p-1 rounded hover:bg-gray-700"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-6 w-6"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M4 6h16M4 12h16M4 18h16"
                          />
                        </svg>
                      </button>
                      <span className="text-base font-semibold">Budget</span>
                    </header>
                    <Routes>
                      <Route path="/" element={<Navigate to="/overview" replace />} />
                      <Route path="/overview" element={<OverviewPage />} />
                      <Route path="/transactions" element={<TransactionsPage />} />
                      <Route path="/accounts" element={<AccountsPage />} />
                      <Route path="/merchants" element={<MerchantsPage />} />
                      <Route path="/merchants/merge" element={<MerchantMergePage />} />
                      <Route path="/imports" element={<ImportsPage />} />
                      <Route path="/recurring" element={<RecurringPage />} />
                      <Route path="/monthly" element={<MonthlyPage />} />
                      <Route path="/yearly" element={<YearlyPage />} />
                      <Route path="/categories" element={<CategoriesPage />} />
                      <Route path="/cardholders" element={<CardHoldersPage />} />
                      <Route path="/trends" element={<TrendPage />} />
                      <Route path="/budgets" element={<BudgetPage />} />
                      <Route path="/duplicates" element={<DuplicatesPage />} />
                      <Route path="/tags" element={<TagsPage />} />
                      <Route path="/transfers" element={<TransfersPage />} />
                      <Route path="/debug" element={<DebugPage />} />
                      <Route path="/help" element={<HelpPage />} />
                    </Routes>
                  </main>
                </div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
