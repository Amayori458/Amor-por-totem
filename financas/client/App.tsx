import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, brl, Unauthorized, type Kind, type Meta, type Summary, type Tx } from "./api.ts";

const TZ = "America/Sao_Paulo";
const thisMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date()).slice(0, 7);
const shiftMonth = (m: string, by: number) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const monthLabel = (m: string, short = false) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 15)).toLocaleDateString("pt-BR", short ? { month: "short" } : { month: "long", year: "numeric" });
};
const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "long", day: "numeric", month: "short" });
const KIND_LABEL: Record<Kind, string> = { expense: "Saída", income: "Entrada", transfer: "Investimento" };
const signed = (t: Pick<Tx, "kind" | "amount_cents">) =>
  `${t.kind === "income" ? "+" : t.kind === "expense" ? "−" : ""}${brl(t.amount_cents)}`;

const CATEGORY_ICON: Record<string, string> = {
  "Alimentação": "🍽️", "Mercado": "🛒", "Transporte": "🚗", "Moradia": "🏠", "Saúde": "💊", "Assinaturas": "🔁",
  "Compras": "🛍️", "Lazer": "🎬", "Educação": "📚", "Transferências": "💸", "Salário": "💼", "Recebimentos": "📥",
  "Rendimentos": "📈", "Investimentos": "📊",
};
const iconFor = (category: string) => CATEGORY_ICON[category] ?? "🧾";

type Tab = "resumo" | "lancamentos" | "automacao";
type Sheet = { mode: "new" } | { mode: "edit"; tx: Tx } | { mode: "paste" } | null;
type KindFilter = "all" | "expense" | "income" | "review";
interface Filter { kind: KindFilter; category: string | null; q: string }
const NO_FILTER: Filter = { kind: "all", category: null, q: "" };

// ---------- ícones ----------
const I = ({ d, size = 22 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const ICON = {
  home: "M4 11.5 12 4l8 7.5M6 10v9.5h4.5V15h3v4.5H18V10",
  list: "M8 6.5h12M8 12h12M8 17.5h12M4 6.5h.01M4 12h.01M4 17.5h.01",
  bolt: "M13 3 5 13.5h6L10.5 21 19 10h-6.2L13 3Z",
  plus: "M12 5v14M5 12h14",
  left: "m14.5 6-6 6 6 6",
  right: "m9.5 6 6 6-6 6",
  close: "M6 6l12 12M18 6 6 18",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 4.5 4.5",
  up: "M12 19V5m-6 6 6-6 6 6",
  down: "M12 5v14m-6-6 6 6 6-6",
  alert: "M12 8.5v4.5m0 3.5h.01M10.3 4.2 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z",
  copy: "M9 9h10v11H9zM5 15V4h10",
  check: "m5 12.5 4.5 4.5L19 7.5",
};

/** Anima um número até o valor final (desligado para quem pede menos movimento). */
function useCountUp(target: number, ms = 650) {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setValue(target); from.current = target; return; }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = Math.round(a + (target - a) * eased);
      setValue(v); from.current = v;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

export function App() {
  const [auth, setAuth] = useState<boolean | null>(null);
  useEffect(() => { api<{ authenticated: boolean }>("/me").then((r) => setAuth(r.authenticated), () => setAuth(false)); }, []);
  if (auth === null) return <div className="center"><div className="spinner" aria-label="Carregando" /></div>;
  if (!auth) return <Login onDone={() => setAuth(true)} />;
  return <Main onLogout={() => setAuth(false)} />;
}

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    try { await api("/login", { method: "POST", body: { password } }); onDone(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <form className="center login" onSubmit={submit}>
      <div className="login-mark"><img src="/icon.svg" alt="" width={64} height={64} /></div>
      <h1>Finanças</h1>
      <p className="muted">Seu dinheiro, organizado sozinho.</p>
      <input type="password" autoComplete="current-password" placeholder="Senha" aria-label="Senha" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" disabled={busy || !password}>{busy ? "Entrando…" : "Entrar"}</button>
    </form>
  );
}

function Main({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("resumo");
  const [month, setMonth] = useState(thisMonth);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [txs, setTxs] = useState<Tx[] | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [filter, setFilter] = useState<Filter>(NO_FILTER);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([api<Summary>(`/summary?month=${month}`), api<Tx[]>(`/transactions?month=${month}`)]);
      setSummary(s); setTxs(t); setError("");
    } catch (err) {
      if (err instanceof Unauthorized) onLogout(); else setError((err as Error).message);
    }
  }, [month, onLogout]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api<Meta>("/meta").then(setMeta, () => {}); }, []);
  // Lançamentos chegam pelo Atalho com o app fechado: recarrega ao voltar para ele.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const go = (t: Tab, f?: Filter) => { if (f) setFilter(f); setTab(t); window.scrollTo({ top: 0 }); };
  const saved = (msg: string) => { setSheet(null); setToast(msg); load(); };

  return (
    <div className="app">
      <header>
        <button className="icon" aria-label="Mês anterior" onClick={() => setMonth(shiftMonth(month, -1))}><I d={ICON.left} /></button>
        <button className="month" onClick={() => setMonth(thisMonth())} title="Voltar ao mês atual">{monthLabel(month)}</button>
        <button className="icon" aria-label="Próximo mês" disabled={month >= thisMonth()} onClick={() => setMonth(shiftMonth(month, 1))}><I d={ICON.right} /></button>
      </header>

      <main key={tab} className="view">
        {error && <p className="error" role="alert">{error}</p>}
        {tab === "resumo" && (summary
          ? <Resumo s={summary} onReview={() => go("lancamentos", { ...NO_FILTER, kind: "review" })} onCategory={(c) => go("lancamentos", { kind: "expense", category: c, q: "" })} onKind={(k) => go("lancamentos", { ...NO_FILTER, kind: k })} />
          : <Skeleton />)}
        {tab === "lancamentos" && (txs ? <Lancamentos txs={txs} filter={filter} setFilter={setFilter} onOpen={(tx) => setSheet({ mode: "edit", tx })} /> : <Skeleton />)}
        {tab === "automacao" && <Automacao token={meta?.ingestToken ?? ""} onPaste={() => setSheet({ mode: "paste" })} onLogout={async () => { await api("/logout", { method: "POST" }); onLogout(); }} />}
      </main>

      <div className="dock">
        <nav>
          {([["resumo", "Resumo", ICON.home], ["lancamentos", "Lançamentos", ICON.list], ["automacao", "Automação", ICON.bolt]] as [Tab, string, string][]).map(([id, label, icon]) => (
            <button key={id} className={tab === id ? "active" : ""} aria-current={tab === id ? "page" : undefined} onClick={() => go(id)}>
              <I d={icon} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <button className="fab" aria-label="Novo lançamento" onClick={() => setSheet({ mode: "new" })}><I d={ICON.plus} size={26} /></button>
      </div>

      {toast && <div className="toast" role="status"><I d={ICON.check} size={18} />{toast}</div>}

      {sheet && meta && (
        <div className="backdrop" onClick={(e) => { if (e.target === e.currentTarget) setSheet(null); }}>
          <div className="sheet" role="dialog" aria-modal="true">
            <div className="grabber" />
            {sheet.mode === "paste"
              ? <PasteForm onClose={() => setSheet(null)} onSaved={() => saved("Notificação registrada")} />
              : <TxForm meta={meta} tx={sheet.mode === "edit" ? sheet.tx : null} onClose={() => setSheet(null)} onSaved={saved} />}
          </div>
        </div>
      )}
    </div>
  );
}

function Skeleton() {
  return <div className="skeleton" aria-label="Carregando"><div style={{ height: 190 }} /><div style={{ height: 220 }} /><div style={{ height: 180 }} /></div>;
}

function Resumo({ s, onReview, onCategory, onKind }: { s: Summary; onReview: () => void; onCategory: (c: string) => void; onKind: (k: KindFilter) => void }) {
  const balance = s.income - s.expense;
  const shown = useCountUp(balance);
  const spentPct = s.income > 0 ? Math.round((s.expense / s.income) * 100) : null;
  const maxCat = Math.max(1, ...s.categories.map((c) => c.total));
  const maxHist = Math.max(1, ...s.history.flatMap((h) => [h.income, h.expense]));
  const [active, setActive] = useState(s.history.length - 1);
  useEffect(() => { setActive(s.history.length - 1); }, [s.month, s.history.length]);
  const act = s.history[Math.min(active, s.history.length - 1)];

  return (
    <>
      <section className="hero">
        <span className="hero-label">Saldo do mês</span>
        <strong className="hero-value num">{shown < 0 ? "−" : ""}{brl(Math.abs(shown))}</strong>
        {spentPct !== null && (
          <div className="hero-meter" title={`Saídas equivalem a ${spentPct}% das entradas`}>
            <div className="hero-track"><div className="hero-fill" style={{ width: `${Math.min(100, spentPct)}%` }} /></div>
            <span>Você gastou {spentPct}% do que entrou</span>
          </div>
        )}
        <div className="hero-stats">
          <button onClick={() => onKind("income")}><span className="chip-ic"><I d={ICON.down} size={16} /></span><span><small>Entradas</small><b className="num">{brl(s.income)}</b></span></button>
          <button onClick={() => onKind("expense")}><span className="chip-ic"><I d={ICON.up} size={16} /></span><span><small>Saídas</small><b className="num">{brl(s.expense)}</b></span></button>
        </div>
      </section>

      {s.needsReview > 0 && (
        <button className="notice" onClick={onReview}>
          <I d={ICON.alert} size={20} />
          <span>{s.needsReview} {s.needsReview === 1 ? "lançamento precisa" : "lançamentos precisam"} de revisão</span>
          <I d={ICON.right} size={18} />
        </button>
      )}

      {s.invested > 0 && (
        <section className="card row"><span className="avatar">📊</span><span className="grow"><span className="label">Movimentado em investimentos</span><b className="num">{brl(s.invested)}</b></span></section>
      )}

      <section className="card">
        <h2>Para onde foi o dinheiro</h2>
        {s.categories.length === 0 && <p className="muted">Nenhum gasto neste mês.</p>}
        <ul className="bars">
          {s.categories.map((c, i) => (
            <li key={c.category}>
              <button onClick={() => onCategory(c.category)} title={`${c.category}: ${brl(c.total)} em ${c.count} lançamento(s) — toque para ver`}>
                <span className="avatar">{iconFor(c.category)}</span>
                <span className="grow">
                  <span className="bar-head"><span>{c.category}</span><span className="num">{brl(c.total)}</span></span>
                  <span className="track"><span className="fill" style={{ width: `${Math.max(2, (c.total / maxCat) * 100)}%`, animationDelay: `${i * 60}ms` }} /></span>
                  <span className="bar-sub">{c.count} {c.count === 1 ? "lançamento" : "lançamentos"} · {s.expense ? Math.round((c.total / s.expense) * 100) : 0}% das saídas</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Últimos 6 meses</h2>
        {act && (
          <div className="readout" aria-live="polite">
            <span className="readout-month">{monthLabel(act.month)}</span>
            <span><i className="sw in" />Entradas <b className="num">{brl(act.income)}</b></span>
            <span><i className="sw out" />Saídas <b className="num">{brl(act.expense)}</b></span>
          </div>
        )}
        <div className="cols">
          {s.history.map((h, i) => (
            <button className={`col ${i === active ? "on" : ""}`} key={h.month} aria-pressed={i === active}
              aria-label={`${monthLabel(h.month)}: entradas ${brl(h.income)}, saídas ${brl(h.expense)}`}
              onClick={() => setActive(i)} onPointerEnter={() => setActive(i)}>
              <span className="pair">
                <span className="colbar in" style={{ height: `${(h.income / maxHist) * 100}%`, animationDelay: `${i * 50}ms` }} />
                <span className="colbar out" style={{ height: `${(h.expense / maxHist) * 100}%`, animationDelay: `${i * 50 + 25}ms` }} />
              </span>
              <span className="tick">{monthLabel(h.month, true).replace(".", "")}</span>
            </button>
          ))}
        </div>
        <details>
          <summary>Ver em tabela</summary>
          <table>
            <thead><tr><th>Mês</th><th>Entradas</th><th>Saídas</th></tr></thead>
            <tbody>{s.history.map((h) => <tr key={h.month}><td>{monthLabel(h.month)}</td><td className="num">{brl(h.income)}</td><td className="num">{brl(h.expense)}</td></tr>)}</tbody>
          </table>
        </details>
      </section>

      {s.accounts.length > 0 && (
        <section className="card">
          <h2>Por conta</h2>
          <table>
            <thead><tr><th>Conta</th><th>Entradas</th><th>Saídas</th></tr></thead>
            <tbody>{s.accounts.map((a) => <tr key={a.account}><td>{a.account}</td><td className="num">{brl(a.income)}</td><td className="num">{brl(a.expense)}</td></tr>)}</tbody>
          </table>
        </section>
      )}
    </>
  );
}

function Lancamentos({ txs, filter, setFilter, onOpen }: { txs: Tx[]; filter: Filter; setFilter: (f: Filter) => void; onOpen: (t: Tx) => void }) {
  const reviewCount = txs.filter((t) => t.needs_review).length;
  const visible = useMemo(() => {
    const q = filter.q.trim().toLowerCase();
    return txs.filter((t) =>
      (filter.kind === "all" || (filter.kind === "review" ? t.needs_review : t.kind === filter.kind)) &&
      (!filter.category || t.category === filter.category) &&
      (!q || `${t.description} ${t.category} ${t.account}`.toLowerCase().includes(q)));
  }, [txs, filter]);
  const groups = useMemo(() => {
    const map = new Map<string, Tx[]>();
    for (const t of visible) { const k = dayLabel(t.occurred_at); map.set(k, [...(map.get(k) ?? []), t]); }
    return [...map];
  }, [visible]);
  const total = visible.reduce((sum, t) => sum + (t.kind === "income" ? t.amount_cents : t.kind === "expense" ? -t.amount_cents : 0), 0);
  const chips: [KindFilter, string][] = [["all", "Todos"], ["expense", "Saídas"], ["income", "Entradas"], ["review", `Revisar${reviewCount ? ` (${reviewCount})` : ""}`]];

  return (
    <>
      <label className="search"><I d={ICON.search} size={18} /><input type="search" placeholder="Buscar lançamento" aria-label="Buscar lançamento" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} /></label>
      <div className="chips" role="group" aria-label="Filtros">
        {filter.category && <button className="on removable" onClick={() => setFilter({ ...filter, category: null })}>{iconFor(filter.category)} {filter.category} <I d={ICON.close} size={14} /></button>}
        {chips.map(([id, label]) => (
          <button key={id} className={filter.kind === id ? "on" : ""} aria-pressed={filter.kind === id} onClick={() => setFilter({ ...filter, kind: id })}>{label}</button>
        ))}
      </div>
      {visible.length > 0 && <p className="tally">{visible.length} {visible.length === 1 ? "lançamento" : "lançamentos"} · <b className="num">{total < 0 ? "−" : total > 0 ? "+" : ""}{brl(Math.abs(total))}</b></p>}
      {groups.length === 0 && (
        <div className="empty"><span>🗂️</span><p>{txs.length ? "Nada encontrado com esses filtros." : "Nenhum lançamento neste mês. Toque em + para adicionar ou configure a aba Automação."}</p></div>
      )}
      {groups.map(([day, items]) => (
        <section className="card list" key={day}>
          <h2>{day}</h2>
          {items.map((t) => (
            <button className="tx" key={t.id} onClick={() => onOpen(t)}>
              <span className={`avatar ${t.needs_review ? "warn" : ""}`}>{t.needs_review ? <I d={ICON.alert} size={18} /> : iconFor(t.category)}</span>
              <span className="tx-main">
                <span className="tx-desc">{t.description}</span>
                <span className="tx-sub">{t.needs_review ? "Revisar · " : ""}{t.category} · {t.account}</span>
              </span>
              <span className={`num amount ${t.kind}`}>{signed(t)}</span>
            </button>
          ))}
        </section>
      ))}
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function SheetHead({ title, onClose }: { title: string; onClose: () => void }) {
  return <div className="sheet-head"><h2>{title}</h2><button type="button" className="icon" aria-label="Fechar" onClick={onClose}><I d={ICON.close} size={20} /></button></div>;
}

function TxForm({ meta, tx, onClose, onSaved }: { meta: Meta; tx: Tx | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const toLocal = (iso?: string) => {
    const d = iso ? new Date(iso) : new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };
  const [kind, setKind] = useState<Kind>(tx?.kind ?? "expense");
  const [amount, setAmount] = useState(tx ? (tx.amount_cents / 100).toFixed(2).replace(".", ",") : "");
  const [description, setDescription] = useState(tx?.description ?? "");
  const [category, setCategory] = useState(tx?.category ?? "Outros");
  const [account, setAccount] = useState(tx?.account ?? meta.accounts[0]);
  const [when, setWhen] = useState(toLocal(tx?.occurred_at));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const listFor = (k: Kind) => (k === "expense" ? meta.expenseCategories : k === "income" ? meta.incomeCategories : ["Investimentos"]);
  const categories = listFor(kind).includes(category) ? listFor(kind) : [category, ...listFor(kind)];
  const pickKind = (k: Kind) => {
    setKind(k);
    if (!listFor(k).includes(category)) setCategory(k === "transfer" ? "Investimentos" : k === "income" ? "Recebimentos" : "Outros");
  };

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true); setError("");
    try { await fn(); onSaved(msg); } catch (err) { setError((err as Error).message); setBusy(false); }
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    const body = { kind, amount, description, category, account, occurred_at: new Date(when).toISOString() };
    run(() => api(tx ? `/transactions/${tx.id}` : "/transactions", { method: tx ? "PATCH" : "POST", body }), tx ? "Lançamento atualizado" : "Lançamento adicionado");
  };

  return (
    <form onSubmit={save}>
      <SheetHead title={tx ? "Editar lançamento" : "Novo lançamento"} onClose={onClose} />
      <div className="segmented" role="group" aria-label="Tipo">
        {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
          <button type="button" key={k} className={kind === k ? "active" : ""} aria-pressed={kind === k} onClick={() => pickKind(k)}>{KIND_LABEL[k]}</button>
        ))}
      </div>
      <label className="amount-input"><span>R$</span><input inputMode="decimal" placeholder="0,00" aria-label="Valor em reais" style={{ width: `${Math.max(4, amount.length) + 0.5}ch` }} value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus={!tx} /></label>
      <Field label="Descrição"><input value={description} maxLength={80} placeholder="Ex.: Padaria, Uber, Salário" onChange={(e) => setDescription(e.target.value)} required /></Field>
      <div className="field">
        <span>Categoria</span>
        <div className="chips wrap" role="group" aria-label="Categoria">
          {categories.map((c) => <button type="button" key={c} className={category === c ? "on" : ""} aria-pressed={category === c} onClick={() => setCategory(c)}>{iconFor(c)} {c}</button>)}
        </div>
      </div>
      <div className="two">
        <Field label="Conta"><select value={account} onChange={(e) => setAccount(e.target.value)}>{[...new Set([account, ...meta.accounts])].map((a) => <option key={a}>{a}</option>)}</select></Field>
        <Field label="Data e hora"><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required /></Field>
      </div>
      {tx?.raw_text && <p className="raw"><span className="label">Notificação original</span>{tx.raw_text}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        {tx && <button type="button" className="danger" disabled={busy} onClick={() => { if (confirm("Excluir este lançamento?")) run(() => api(`/transactions/${tx.id}`, { method: "DELETE" }), "Lançamento excluído"); }}>Excluir</button>}
        <button className="primary" disabled={busy}>{tx?.needs_review ? "Confirmar" : "Salvar"}</button>
      </div>
    </form>
  );
}

function PasteForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    try { await api("/ingest", { method: "POST", body: { text } }); onSaved(); }
    catch (err) { setError((err as Error).message); setBusy(false); }
  };
  return (
    <form onSubmit={submit}>
      <SheetHead title="Colar notificação" onClose={onClose} />
      <Field label="Texto da notificação do banco (uma ou várias)">
        <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Compra aprovada\nCompra de R$ 25,90 APROVADA em PADARIA…"} required autoFocus />
      </Field>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions"><button className="primary" disabled={busy || !text.trim()}>Registrar</button></div>
    </form>
  );
}

function Copy({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="copy">
      <span className="label">{label}</span>
      <code>{value}</code>
      <button onClick={async () => { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); }}>
        <I d={done ? ICON.check : ICON.copy} size={16} />{done ? "Copiado" : "Copiar"}
      </button>
    </div>
  );
}

function Step({ badge, title, tag, children, open }: { badge: string; title: string; tag: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="card step" open={open}>
      <summary><span className="avatar">{badge}</span><span className="grow"><b>{title}</b><span className="bar-sub">{tag}</span></span><I d={ICON.right} size={18} /></summary>
      <div className="step-body">{children}</div>
    </details>
  );
}

function Automacao({ token, onPaste, onLogout }: { token: string; onPaste: () => void; onLogout: () => void }) {
  const url = `${location.origin}/api/ingest`;
  return (
    <>
      <section className="card">
        <h2>Lançamentos que chegam sozinhos</h2>
        <p>O iPhone não deixa nenhum app ler as notificações de outro. O caminho é o app <b>Atalhos</b>, da Apple, enviar cada movimentação para este endereço:</p>
        <Copy label="Endereço (URL)" value={url} />
        <Copy label="Token (cabeçalho Authorization)" value={`Bearer ${token}`} />
      </section>

      <Step badge="💳" title="Compras com Apple Pay" tag="100% automático" open>
        <ol>
          <li>Atalhos → <b>Automação</b> → <b>+</b> → <b>Transação</b>.</li>
          <li>Marque seus cartões (Nubank, Mercado Pago, XP) e escolha <b>Executar imediatamente</b>.</li>
          <li>Adicione a ação <b>Obter conteúdo do URL</b>: cole o endereço acima, método <b>POST</b>.</li>
          <li>Em Cabeçalhos, crie <code>Authorization</code> com o token acima.</li>
          <li>Corpo da requisição <b>JSON</b> com três campos de texto, usando as variáveis da “Entrada do atalho”: <code>merchant</code> = Estabelecimento, <code>amount</code> = Valor, <code>card</code> = Cartão ou Passe.</li>
        </ol>
      </Step>

      <Step badge="✉️" title="Pix e avisos por SMS ou e-mail" tag="Automático">
        <ol>
          <li>Atalhos → Automação → <b>+</b> → <b>Mensagem</b> (ou <b>E-mail</b>).</li>
          <li>Filtre por “A mensagem contém” <code>R$</code> (ou pelo remetente do banco) e escolha <b>Executar imediatamente</b>.</li>
          <li>Mesma ação <b>Obter conteúdo do URL</b>, com corpo JSON: <code>text</code> = conteúdo da mensagem e, se quiser, <code>app</code> = nome do banco.</li>
        </ol>
      </Step>

      <Step badge="🔔" title="Notificações push (Pix no Nubank etc.)" tag="Um toque">
        <p>Crie um atalho “Registrar notificações” com as ações <b>Fazer captura de tela</b> → <b>Extrair texto da imagem</b> → <b>Obter conteúdo do URL</b> (corpo JSON com <code>text</code> = texto extraído). Ative em Ajustes → Acessibilidade → Toque → <b>Tocar atrás</b>. Com a central de notificações aberta, dois toques atrás do iPhone registram tudo o que estiver na tela; repetidos são ignorados.</p>
        <button className="secondary" onClick={onPaste}>Colar texto de uma notificação agora</button>
      </Step>

      <Step badge="📲" title="Instalar como app" tag="Tela de Início">
        <p>No Safari: botão <b>Compartilhar</b> → <b>Adicionar à Tela de Início</b>.</p>
      </Step>

      <button className="secondary" onClick={onLogout}>Sair</button>
    </>
  );
}
