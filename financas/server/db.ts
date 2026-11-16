import pg from "pg";

// NUMERIC/BIGINT chegam como string no driver; somas em centavos cabem em number.
pg.types.setTypeParser(20, (v) => Number(v));

let pool: pg.Pool | null = null;
let ready: Promise<void> | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS transactions (
  id            BIGSERIAL PRIMARY KEY,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  kind          TEXT NOT NULL CHECK (kind IN ('expense','income','transfer')),
  description   TEXT NOT NULL,
  category      TEXT NOT NULL,
  account       TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'manual',
  raw_text      TEXT,
  needs_review  BOOLEAN NOT NULL DEFAULT false,
  dedupe_key    TEXT UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transactions_occurred_at_idx ON transactions (occurred_at DESC);
`;

export function db(): pg.Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL não configurada");
    // Banco na mesma máquina/rede Docker não usa TLS; bancos hospedados (Supabase etc.) usam.
    const noSsl = process.env.DATABASE_SSL === "off" || /localhost|127\.0\.0\.1|\/var\/run/.test(url);
    pool = new pg.Pool({ connectionString: url, max: 3, ssl: noSsl ? undefined : { rejectUnauthorized: false } });
  }
  return pool;
}

/** Cria as tabelas na primeira chamada (idempotente). */
export function ensureSchema(): Promise<void> {
  ready ??= db().query(SCHEMA).then(() => undefined).catch((e) => { ready = null; throw e; });
  return ready;
}
