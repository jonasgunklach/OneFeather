// Centralized API client. Attaches the session token (set at login) as a
// Bearer header and points at the OneFeather server.
export const API_BASE = "http://localhost:3001";

export function getToken(): string | null {
  return localStorage.getItem("of_token");
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem("of_token", token);
  else localStorage.removeItem("of_token");
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

export async function api(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = authHeaders(options.headers as Record<string, string>);
  return fetch(`${API_BASE}${path}`, { ...options, headers });
}

// JSON GET helper.
export async function apiGet<T = any>(path: string): Promise<T> {
  const res = await api(path);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

// JSON POST/PUT helper.
export async function apiSend(path: string, method: string, body?: any): Promise<Response> {
  return api(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
