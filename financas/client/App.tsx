import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
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
  new Date(iso).toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "short" });
const KIND_LABEL: Record<Kind, string> = { expense: "Saída", income: "Entrada", transfer: "Investimento" };
const signed = (t: Pick<Tx, "kind" | "amount_cents">) =>
  `${t.kind === "income" ? "+" : t.kind === "expense" ? "−" : ""}${brl(t.amount_cents)}`;

type Tab = "resumo" | "lancamentos" | "automacao";
type Sheet = { mode: "new" } | { mode: "edit"; tx: Tx } | { mode: "paste" } | null;

export function App() {
  const [auth, setAuth] = useState<boolean | null>(null);
  useEffect(() => { api<{ authenticated: boolean }>("/me").then((r) => setAuth(r.authenticated), () => setAuth(false)); }, []);
  if (auth === null) return <div className="center muted">Carregando…</div>;
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
      <img src="/icon.svg" alt="" width={72} height={72} />
      <h1>Finanças</h1>
      <input type="password" autoComplete="current-password" placeholder="Senha" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
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
  const [error, setError] = useState("");

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

  return (
    <div className="app">
      <header>
        <button className="icon" aria-label="Mês anterior" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
        <h1>{monthLabel(month)}</h1>
        <button className="icon" aria-label="Próximo mês" disabled={month >= thisMonth()} onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
      </header>

      <main>
        {error && <p className="error" role="alert">{error}</p>}
        {tab === "resumo" && (summary ? <Resumo s={summary} onReview={() => setTab("lancamentos")} /> : <p className="muted">Carregando…</p>)}
        {tab === "lancamentos" && (txs ? <Lancamentos txs={txs} onOpen={(tx) => setSheet({ mode: "edit", tx })} /> : <p className="muted">Carregando…</p>)}
        {tab === "automacao" && <Automacao token={meta?.ingestToken ?? ""} onPaste={() => setSheet({ mode: "paste" })} onLogout={async () => { await api("/logout", { method: "POST" }); onLogout(); }} />}
      </main>

      <button className="fab" aria-label="Novo lançamento" onClick={() => setSheet({ mode: "new" })}>+</button>
      <nav>
        {([["resumo", "Resumo"], ["lancamentos", "Lançamentos"], ["automacao", "Automação"]] as [Tab, string][]).map(([id, label]) => (
          <button key={id} className={tab === id ? "active" : ""} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>

      {sheet && meta && (
        <div className="backdrop" onClick={(e) => { if (e.target === e.currentTarget) setSheet(null); }}>
          <div className="sheet" role="dialog" aria-modal="true">
            {sheet.mode === "paste"
              ? <PasteForm onClose={() => setSheet(null)} onSaved={() => { setSheet(null); load(); }} />
              : <TxForm meta={meta} tx={sheet.mode === "edit" ? sheet.tx : null} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); load(); }} />}
          </div>
        </div>
      )}
    </div>
  );
}

function Resumo({ s, onReview }: { s: Summary; onReview: () => void }) {
  const balance = s.income - s.expense;
  const maxCat = Math.max(1, ...s.categories.map((c) => c.total));
  const maxHist = Math.max(1, ...s.history.flatMap((h) => [h.income, h.expense]));
  return (
    <>
      <section className="tiles">
        <div className="tile wide">
          <span className="label">Saldo do mês</span>
          <strong className="hero">{balance < 0 ? "−" : ""}{brl(Math.abs(balance))}</strong>
        </div>
        <div className="tile"><span className="label">Entradas</span><strong>{brl(s.income)}</strong></div>
        <div className="tile"><span className="label">Saídas</span><strong>{brl(s.expense)}</strong></div>
        {s.invested > 0 && <div className="tile wide row"><span className="label">Movimentado em investimentos</span><strong>{brl(s.invested)}</strong></div>}
      </section>

      {s.needsReview > 0 && (
        <button className="notice" onClick={onReview}>
          <span>⚠ {s.needsReview} {s.needsReview === 1 ? "lançamento precisa" : "lançamentos precisam"} de revisão</span><span>›</span>
        </button>
      )}

      <section className="card">
        <h2>Gastos por categoria</h2>
        {s.categories.length === 0 && <p className="muted">Nenhum gasto neste mês.</p>}
        <ul className="bars">
          {s.categories.map((c) => (
            <li key={c.category} title={`${c.category}: ${brl(c.total)} em ${c.count} lançamento(s)`}>
              <div className="bar-head"><span>{c.category}</span><span className="num">{brl(c.total)}</span></div>
              <div className="track"><div className="fill" style={{ width: `${Math.max(1.5, (c.total / maxCat) * 100)}%` }} /></div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Últimos 6 meses</h2>
        <div className="legend"><span><i className="sw in" />Entradas</span><span><i className="sw out" />Saídas</span></div>
        <div className="cols" role="img" aria-label="Entradas e saídas dos últimos 6 meses; valores na tabela abaixo">
          {s.history.map((h) => (
            <div className="col" key={h.month}>
              <div className="pair">
                <div className="colbar in" style={{ height: `${(h.income / maxHist) * 100}%` }} title={`${monthLabel(h.month)} · Entradas: ${brl(h.income)}`} />
                <div className="colbar out" style={{ height: `${(h.expense / maxHist) * 100}%` }} title={`${monthLabel(h.month)} · Saídas: ${brl(h.expense)}`} />
              </div>
              <span className="tick">{monthLabel(h.month, true).replace(".", "")}</span>
            </div>
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

function Lancamentos({ txs, onOpen }: { txs: Tx[]; onOpen: (t: Tx) => void }) {
  const [onlyReview, setOnlyReview] = useState(false);
  const reviewCount = txs.filter((t) => t.needs_review).length;
  const groups = useMemo(() => {
    const map = new Map<string, Tx[]>();
    for (const t of txs) {
      if (onlyReview && !t.needs_review) continue;
      const k = dayLabel(t.occurred_at);
      map.set(k, [...(map.get(k) ?? []), t]);
    }
    return [...map];
  }, [txs, onlyReview]);

  return (
    <>
      {reviewCount > 0 && (
        <label className="check"><input type="checkbox" checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)} /> Só os que precisam de revisão ({reviewCount})</label>
      )}
      {groups.length === 0 && <p className="muted">Nenhum lançamento neste mês. Toque em + para adicionar ou configure a aba Automação.</p>}
      {groups.map(([day, items]) => (
        <section className="card list" key={day}>
          <h2>{day}</h2>
          {items.map((t) => (
            <button className="tx" key={t.id} onClick={() => onOpen(t)}>
              <span className="tx-main">
                <span className="tx-desc">{t.needs_review && <span className="flag" title="Precisa de revisão">⚠ </span>}{t.description}</span>
                <span className="tx-sub">{t.category} · {t.account}</span>
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

function TxForm({ meta, tx, onClose, onSaved }: { meta: Meta; tx: Tx | null; onClose: () => void; onSaved: () => void }) {
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

  const base = kind === "expense" ? meta.expenseCategories : kind === "income" ? meta.incomeCategories : ["Investimentos"];
  const categories = base.includes(category) ? base : [category, ...base];
  const pickKind = (k: Kind) => {
    setKind(k);
    const list = k === "expense" ? meta.expenseCategories : k === "income" ? meta.incomeCategories : ["Investimentos"];
    if (!list.includes(category)) setCategory(k === "transfer" ? "Investimentos" : k === "income" ? "Recebimentos" : "Outros");
  };

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await fn(); onSaved(); } catch (err) { setError((err as Error).message); setBusy(false); }
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    const body = { kind, amount, description, category, account, occurred_at: new Date(when).toISOString() };
    run(() => api(tx ? `/transactions/${tx.id}` : "/transactions", { method: tx ? "PATCH" : "POST", body }));
  };

  return (
    <form onSubmit={save}>
      <div className="sheet-head"><h2>{tx ? "Editar lançamento" : "Novo lançamento"}</h2><button type="button" className="icon" aria-label="Fechar" onClick={onClose}>✕</button></div>
      <div className="segmented" role="group" aria-label="Tipo">
        {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
          <button type="button" key={k} className={kind === k ? "active" : ""} aria-pressed={kind === k} onClick={() => pickKind(k)}>{KIND_LABEL[k]}</button>
        ))}
      </div>
      <Field label="Valor (R$)"><input inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus={!tx} /></Field>
      <Field label="Descrição"><input value={description} maxLength={80} onChange={(e) => setDescription(e.target.value)} required /></Field>
      <div className="two">
        <Field label="Categoria"><select value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Conta"><select value={account} onChange={(e) => setAccount(e.target.value)}>{[...new Set([account, ...meta.accounts])].map((a) => <option key={a}>{a}</option>)}</select></Field>
      </div>
      <Field label="Data e hora"><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required /></Field>
      {tx?.raw_text && <p className="raw"><span className="label">Notificação original</span>{tx.raw_text}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        {tx && <button type="button" className="danger" disabled={busy} onClick={() => { if (confirm("Excluir este lançamento?")) run(() => api(`/transactions/${tx.id}`, { method: "DELETE" })); }}>Excluir</button>}
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
      <div className="sheet-head"><h2>Colar notificação</h2><button type="button" className="icon" aria-label="Fechar" onClick={onClose}>✕</button></div>
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
      <button onClick={async () => { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); }}>{done ? "Copiado ✓" : "Copiar"}</button>
    </div>
  );
}

function Automacao({ token, onPaste, onLogout }: { token: string; onPaste: () => void; onLogout: () => void }) {
  const url = `${location.origin}/api/ingest`;
  return (
    <>
      <section className="card">
        <h2>Como os lançamentos chegam sozinhos</h2>
        <p>O iPhone não deixa nenhum app ler as notificações de outro. O caminho é o app <b>Atalhos</b>, da Apple, enviar cada movimentação para este endereço:</p>
        <Copy label="Endereço (URL)" value={url} />
        <Copy label="Token (cabeçalho Authorization)" value={`Bearer ${token}`} />
      </section>

      <section className="card">
        <h2>1 · Compras com Apple Pay — 100% automático</h2>
        <ol>
          <li>Atalhos → <b>Automação</b> → <b>+</b> → <b>Transação</b>.</li>
          <li>Marque seus cartões (Nubank, Mercado Pago, XP) e escolha <b>Executar imediatamente</b>.</li>
          <li>Adicione a ação <b>Obter conteúdo do URL</b>: cole o endereço acima, método <b>POST</b>.</li>
          <li>Em Cabeçalhos, crie <code>Authorization</code> com o token acima.</li>
          <li>Corpo da requisição <b>JSON</b> com três campos de texto, usando as variáveis da “Entrada do atalho”: <code>merchant</code> = Estabelecimento, <code>amount</code> = Valor, <code>card</code> = Cartão ou Passe.</li>
        </ol>
      </section>

      <section className="card">
        <h2>2 · Pix e avisos por SMS ou e-mail — automático</h2>
        <ol>
          <li>Atalhos → Automação → <b>+</b> → <b>Mensagem</b> (ou <b>E-mail</b>).</li>
          <li>Filtre por “A mensagem contém” <code>R$</code> (ou pelo remetente do banco) e escolha <b>Executar imediatamente</b>.</li>
          <li>Mesma ação <b>Obter conteúdo do URL</b>, com corpo JSON: <code>text</code> = conteúdo da mensagem e, se quiser, <code>app</code> = nome do banco.</li>
        </ol>
      </section>

      <section className="card">
        <h2>3 · Notificações push (Pix no Nubank etc.) — um toque</h2>
        <p>Crie um atalho “Registrar notificações” com as ações <b>Fazer captura de tela</b> → <b>Extrair texto da imagem</b> → <b>Obter conteúdo do URL</b> (corpo JSON com <code>text</code> = texto extraído). Ative em Ajustes → Acessibilidade → Toque → <b>Tocar atrás</b>. Com a central de notificações aberta, dois toques atrás do iPhone registram tudo o que estiver na tela; repetidos são ignorados.</p>
        <button className="secondary" onClick={onPaste}>Colar texto de uma notificação agora</button>
      </section>

      <section className="card">
        <h2>Instalar como app</h2>
        <p>No Safari: botão <b>Compartilhar</b> → <b>Adicionar à Tela de Início</b>.</p>
        <button className="secondary" onClick={onLogout}>Sair</button>
      </section>
    </>
  );
}
