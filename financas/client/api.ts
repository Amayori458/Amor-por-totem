export type Kind = "expense" | "income" | "transfer";

export interface Tx {
  id: number;
  occurred_at: string;
  amount_cents: number;
  kind: Kind;
  description: string;
  category: string;
  account: string;
  source: string;
  raw_text: string | null;
  needs_review: boolean;
}

export interface Summary {
  month: string;
  income: number;
  expense: number;
  invested: number;
  categories: { category: string; total: number; count: number }[];
  accounts: { account: string; income: number; expense: number }[];
  history: { month: string; income: number; expense: number }[];
  needsReview: number;
}

export interface Meta {
  accounts: string[];
  expenseCategories: string[];
  incomeCategories: string[];
  ingestToken: string;
}

export class Unauthorized extends Error {}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? "GET",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/login") throw new Unauthorized();
  if (!res.ok) throw new Error(data.error ?? data.message ?? "Algo deu errado");
  return data as T;
}

export const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
