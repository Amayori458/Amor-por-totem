import express, { type NextFunction, type Request, type Response } from "express";
import crypto from "node:crypto";
import { db, ensureSchema } from "./db.ts";
import { ACCOUNTS, EXPENSE_CATEGORIES, INCOME_CATEGORIES, parseAmountCents, parseNotifications, type Parsed } from "./parser.ts";

const TZ = "America/Sao_Paulo";
const COOKIE = "fin_session";
const SESSION_DAYS = 90;

const env = (k: string) => process.env[k] ?? "";
const secret = () => crypto.createHash("sha256").update(`${env("APP_PASSWORD")}|${env("INGEST_TOKEN")}|sess`).digest();
const sign = (v: string) => crypto.createHmac("sha256", secret()).update(v).digest("hex");
const safeEq = (a: string, b: string) => {
  const x = crypto.createHash("sha256").update(a).digest();
  const y = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(x, y);
};

function hasSession(req: Request): boolean {
  const raw = (req.headers.cookie ?? "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!raw) return false;
  const [exp, sig] = raw.split(".");
  return !!exp && !!sig && Number(exp) > Date.now() && safeEq(sig, sign(exp));
}

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (hasSession(req)) return next();
  res.status(401).json({ error: "Faça login" });
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const currentMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
const monthOf = (req: Request) => (typeof req.query.month === "string" && MONTH_RE.test(req.query.month) ? req.query.month : currentMonth());

const COLS = `id, occurred_at, amount_cents, kind, description, category, account, source, raw_text, needs_review`;

async function insertParsed(p: Parsed, source: string, when: Date) {
  // Mesma notificação reenviada em até 10 minutos não gera lançamento duplicado.
  const bucket = Math.floor(when.getTime() / 600_000);
  const dedupe = crypto.createHash("sha1").update(`${p.rawText.toLowerCase().replace(/\s+/g, " ")}|${p.amountCents}|${bucket}`).digest("hex");
  const r = await db().query(
    `INSERT INTO transactions (occurred_at, amount_cents, kind, description, category, account, source, raw_text, needs_review, dedupe_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (dedupe_key) DO NOTHING RETURNING ${COLS}`,
    [when, p.amountCents, p.kind, p.description, p.category, p.account, source, p.rawText, p.needsReview, dedupe],
  );
  return r.rows[0] ?? null;
}

export const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "200kb" }));
app.use(express.text({ type: "text/plain", limit: "200kb" }));

app.use("/api", (_req, _res, next) => { ensureSchema().then(() => next(), next); });
app.param("id", (req, res, next, id) => (/^\d{1,15}$/.test(id) ? next() : res.status(404).json({ error: "Não encontrado" })));

// ---------- sessão ----------
app.post("/api/login", (req, res) => {
  const pass = env("APP_PASSWORD");
  if (!pass) return res.status(500).json({ error: "APP_PASSWORD não configurada no servidor" });
  if (typeof req.body?.password !== "string" || !safeEq(req.body.password, pass)) {
    return setTimeout(() => res.status(401).json({ error: "Senha incorreta" }), 600);
  }
  const exp = String(Date.now() + SESSION_DAYS * 86_400_000);
  const secure = req.headers["x-forwarded-proto"] === "https" || req.secure ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${exp}.${sign(exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
  res.json({ ok: true });
});
app.post("/api/logout", (_req, res) => {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
  res.json({ ok: true });
});
app.get("/api/me", (req, res) => res.json({ authenticated: hasSession(req) }));

// ---------- entrada automática (Atalhos do iPhone) ----------
app.post("/api/ingest", wrap(async (req, res) => {
  const token = env("INGEST_TOKEN");
  const given = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "") || String(req.query.token ?? "");
  // Vale o token do Atalho ou a sessão do app (botão "Colar notificação").
  if (!hasSession(req) && (!token || !given || !safeEq(given, token))) return res.status(401).json({ error: "Token inválido" });

  const body = typeof req.body === "string" ? { text: req.body } : (req.body ?? {});
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 5000) : undefined);
  const parsed = parseNotifications(str(body.text) ?? "", {
    app: str(body.app), merchant: str(body.merchant), card: str(body.card), amount: body.amount,
  });
  if (!parsed.length) return res.status(422).json({ ok: false, created: 0, message: "Nenhum valor em R$ encontrado no texto" });

  const source = str(body.merchant) ? "carteira" : "notificacao";
  const now = new Date();
  const created = [];
  for (const p of parsed) {
    const row = await insertParsed(p, source, now);
    if (row) created.push(row);
  }
  const fmt = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  res.json({
    ok: true,
    created: created.length,
    duplicates: parsed.length - created.length,
    // Texto curto para o Atalho exibir como notificação.
    message: created.length
      ? created.map((t) => `${t.kind === "income" ? "+" : t.kind === "expense" ? "−" : ""}${fmt(t.amount_cents)} ${t.description} (${t.category})`).join("\n")
      : "Já estava registrado",
  });
}));

// ---------- app ----------
app.get("/api/meta", requireAuth, wrap(async (_req, res) => {
  const r = await db().query(`SELECT DISTINCT account FROM transactions`);
  const accounts = [...new Set([...ACCOUNTS, ...r.rows.map((x) => x.account as string)])];
  res.json({ accounts, expenseCategories: EXPENSE_CATEGORIES, incomeCategories: INCOME_CATEGORIES, ingestToken: env("INGEST_TOKEN") });
}));

app.get("/api/transactions", requireAuth, wrap(async (req, res) => {
  const r = await db().query(
    `SELECT ${COLS} FROM transactions
     WHERE to_char(occurred_at AT TIME ZONE '${TZ}', 'YYYY-MM') = $1
     ORDER BY occurred_at DESC, id DESC`, [monthOf(req)]);
  res.json(r.rows);
}));

app.get("/api/summary", requireAuth, wrap(async (req, res) => {
  const month = monthOf(req);
  const local = `occurred_at AT TIME ZONE '${TZ}'`;
  const [totals, cats, accounts, history, review] = await Promise.all([
    db().query(`SELECT kind, COALESCE(SUM(amount_cents),0) AS total FROM transactions WHERE to_char(${local},'YYYY-MM') = $1 GROUP BY kind`, [month]),
    db().query(`SELECT category, SUM(amount_cents) AS total, COUNT(*)::int AS count FROM transactions WHERE kind='expense' AND to_char(${local},'YYYY-MM') = $1 GROUP BY category ORDER BY total DESC`, [month]),
    db().query(`SELECT account, SUM(CASE WHEN kind='income' THEN amount_cents ELSE 0 END) AS income, SUM(CASE WHEN kind='expense' THEN amount_cents ELSE 0 END) AS expense FROM transactions WHERE to_char(${local},'YYYY-MM') = $1 AND kind <> 'transfer' GROUP BY account ORDER BY expense DESC`, [month]),
    db().query(
      `SELECT to_char(m, 'YYYY-MM') AS month,
              COALESCE(SUM(amount_cents) FILTER (WHERE kind='income'),0) AS income,
              COALESCE(SUM(amount_cents) FILTER (WHERE kind='expense'),0) AS expense
       FROM generate_series(to_date($1,'YYYY-MM') - interval '5 months', to_date($1,'YYYY-MM'), interval '1 month') AS m
       LEFT JOIN transactions t ON date_trunc('month', t.${local}) = m
       GROUP BY m ORDER BY m`, [month]),
    db().query(`SELECT COUNT(*)::int AS n FROM transactions WHERE needs_review`),
  ]);
  const t = Object.fromEntries(totals.rows.map((x) => [x.kind, x.total]));
  res.json({
    month,
    income: t.income ?? 0, expense: t.expense ?? 0, invested: t.transfer ?? 0,
    categories: cats.rows, accounts: accounts.rows, history: history.rows, needsReview: review.rows[0].n,
  });
}));

function readFields(body: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  const errors: string[] = [];
  const text = (k: string, max: number) => {
    if (body[k] === undefined) { if (!partial) errors.push(k); return; }
    const v = typeof body[k] === "string" ? (body[k] as string).trim().slice(0, max) : "";
    if (!v) errors.push(k); else out[k] = v;
  };
  if (body.amount !== undefined || !partial) {
    const c = parseAmountCents(body.amount);
    if (!c || c > 2_000_000_000) errors.push("amount"); else out.amount_cents = c;
  }
  if (body.kind !== undefined || !partial) {
    if (!["expense", "income", "transfer"].includes(body.kind as string)) errors.push("kind"); else out.kind = body.kind;
  }
  text("description", 80); text("category", 40); text("account", 40);
  if (body.occurred_at !== undefined) {
    const d = new Date(String(body.occurred_at));
    if (Number.isNaN(d.getTime())) errors.push("occurred_at"); else out.occurred_at = d;
  }
  if (typeof body.needs_review === "boolean") out.needs_review = body.needs_review;
  return { out, errors };
}

app.post("/api/transactions", requireAuth, wrap(async (req, res) => {
  const { out, errors } = readFields(req.body ?? {}, false);
  if (errors.length) return res.status(400).json({ error: `Campos inválidos: ${errors.join(", ")}` });
  const r = await db().query(
    `INSERT INTO transactions (occurred_at, amount_cents, kind, description, category, account, source)
     VALUES (COALESCE($1, now()),$2,$3,$4,$5,$6,'manual') RETURNING ${COLS}`,
    [out.occurred_at ?? null, out.amount_cents, out.kind, out.description, out.category, out.account]);
  res.status(201).json(r.rows[0]);
}));

app.patch("/api/transactions/:id", requireAuth, wrap(async (req, res) => {
  const { out, errors } = readFields(req.body ?? {}, true);
  if (errors.length) return res.status(400).json({ error: `Campos inválidos: ${errors.join(", ")}` });
  if (out.needs_review === undefined) out.needs_review = false; // editar = revisado
  const keys = Object.keys(out);
  const r = await db().query(
    `UPDATE transactions SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1 RETURNING ${COLS}`,
    [req.params.id, ...keys.map((k) => out[k])]);
  if (!r.rowCount) return res.status(404).json({ error: "Não encontrado" });
  res.json(r.rows[0]);
}));

app.delete("/api/transactions/:id", requireAuth, wrap(async (req, res) => {
  const r = await db().query(`DELETE FROM transactions WHERE id = $1`, [req.params.id]);
  res.status(r.rowCount ? 200 : 404).json({ ok: !!r.rowCount });
}));

app.use("/api", (_req, res) => res.status(404).json({ error: "Rota não encontrada" }));
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Erro no servidor" });
});
