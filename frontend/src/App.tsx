import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import OverviewPage from "./pages/OverviewPage";
import TransactionsPage from "./pages/TransactionsPage";
import AccountsPage from "./pages/AccountsPage";
import MerchantsPage from "./pages/MerchantsPage";
import MerchantMergePage from "./pages/MerchantMergePage";
import ImportsPage from "./pages/ImportsPage";
import RecurringPage from "./pages/RecurringPage";
import MonthlyPage from "./pages/MonthlyPage";
import CategoriesPage from "./pages/CategoriesPage";
import CardHoldersPage from "./pages/CardHoldersPage";
import TrendPage from "./pages/TrendPage";

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
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
            <Route path="/categories" element={<CategoriesPage />} />
            <Route path="/cardholders" element={<CardHoldersPage />} />
            <Route path="/trends" element={<TrendPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
