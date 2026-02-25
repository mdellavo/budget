import { createContext, useContext, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { loginUser } from "../api/client";

interface AuthUser {
  id: number;
  email: string;
  name: string;
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  loginWithGoogleToken: (data: { access_token: string; user: AuthUser }) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("auth_token"));
  const [user, setUser] = useState<AuthUser | null>(() => {
    const stored = localStorage.getItem("auth_user");
    if (!stored) return null;
    try {
      return JSON.parse(stored) as AuthUser;
    } catch {
      return null;
    }
  });
  const navigate = useNavigate();

  const login = useCallback(async (email: string, password: string) => {
    const data = await loginUser(email, password);
    localStorage.setItem("auth_token", data.access_token);
    localStorage.setItem("auth_user", JSON.stringify(data.user));
    setToken(data.access_token);
    setUser(data.user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    setToken(null);
    setUser(null);
    navigate("/login");
  }, [navigate]);

  const loginWithGoogleToken = useCallback((data: { access_token: string; user: AuthUser }) => {
    localStorage.setItem("auth_token", data.access_token);
    localStorage.setItem("auth_user", JSON.stringify(data.user));
    setToken(data.access_token);
    setUser(data.user);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, login, logout, loginWithGoogleToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
