// Interpreta o texto de notificações bancárias (Nubank, Mercado Pago, XP e genéricas)
// e devolve lançamentos estruturados. Sem dependências: é usado pelo servidor e pelos testes.

export type Kind = "expense" | "income" | "transfer";

export interface Parsed {
  amountCents: number;
  kind: Kind;
  description: string;
  category: string;
  account: string;
  needsReview: boolean;
  rawText: string;
}

export const EXPENSE_CATEGORIES = [
  "Alimentação", "Mercado", "Transporte", "Moradia", "Saúde", "Assinaturas",
  "Compras", "Lazer", "Educação", "Transferências", "Outros",
];
export const INCOME_CATEGORIES = ["Salário", "Recebimentos", "Rendimentos", "Outros"];
export const ACCOUNTS = ["Nubank", "Mercado Pago", "XP", "Outros"];

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const AMOUNT_RE = /R\$\s*(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)/i;

/** "1.234,56" → 123456; aceita também números (25.9) e "25.90". */
export function parseAmountCents(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(Math.abs(value) * 100) : null;
  if (typeof value !== "string") return null;
  let s = value.replace(/[^\d.,]/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function detectAccount(text: string, hint?: string): string {
  const t = norm(`${hint ?? ""} ${text}`);
  if (/\bnu(bank)?\b|\broxinho\b/.test(t)) return "Nubank";
  if (/mercado\s*pago|\bmp\b/.test(t)) return "Mercado Pago";
  if (/\bxp\b/.test(t)) return "XP";
  const h = (hint ?? "").trim();
  return h ? h.slice(0, 40) : "Outros";
}

const INVEST = /\b(aplicacao|aplicou|resgate|resgatou|investiu|investimento|caixinha|guardou|reservou|compra de ativo|venda de ativo|tesouro direto|cdb|ordem executada)\b/;
const INCOME = /\b(recebeu|recebida|recebido|recebimento|estorn\w+|reembols\w+|cashback|rende\w+|rendimento\w*|deposito|depositado|caiu na conta|dividendo\w*|proventos?|creditad\w+|credito em conta)\b/;
const EXPENSE = /\b(compra|comprou|pagou|pagamento|paga|enviada|enviado|enviou|transferiu|debito|debitad\w+|saque|sacou|fatura|boleto|cobranca)\b/;

export function detectKind(text: string): { kind: Kind; sure: boolean } {
  const t = norm(text);
  if (/\bestorn|\breembols/.test(t)) return { kind: "income", sure: true };
  if (INVEST.test(t)) return { kind: "transfer", sure: true };
  if (INCOME.test(t)) return { kind: "income", sure: true };
  if (EXPENSE.test(t)) return { kind: "expense", sure: true };
  return { kind: "expense", sure: false };
}

const CATEGORY_RULES: [string, RegExp][] = [
  ["Assinaturas", /netflix|spotify|prime video|amazon prime|disney|hbo|\bmax\b|youtube|icloud|apple\.com|google one|globoplay|deezer|chatgpt|openai|claude/],
  ["Transporte", /\buber\b|\b99\b|99app|99 ?pop|\bposto\b|combusti|shell|ipiranga|petrobras|estacion|pedagio|sem parar|metro\b|bilhete|onibus|cabify/],
  ["Mercado", /supermerc|\bmercado\b|mercadinho|atacad|carrefour|assai|pao de acucar|hortifruti|sacolao|\bextra\b|big bompreco|zaffari|\bdia\b/],
  ["Alimentação", /ifood|rappi|restaurante|padaria|lanch|pizza|burger|burguer|\bcafe\b|cafeteria|\bbar\b|sorvet|acai|mcdonald|bk\b|subway|churrasc|sushi|doceria|confeitaria/],
  ["Saúde", /farmac|drogaria|\bdroga|drogasil|hospital|clinica|laborat|dentista|odonto|unimed|academia|smart ?fit/],
  ["Compras", /amazon|mercado ?livre|shopee|magalu|magazine|shein|aliexpress|americanas|casas bahia|renner|riachuelo|\bc&a\b|zara|kabum/],
  ["Moradia", /aluguel|condominio|energia|\benel\b|cpfl|cemig|sabesp|\bagua\b|\bgas\b|internet|\bvivo\b|\bclaro\b|\btim\b|\boi\b|iptu/],
  ["Lazer", /cinema|cinemark|ingresso|sympla|steam|playstation|xbox|nintendo|teatro|show\b/],
  ["Educação", /escola|faculdade|universidade|curso|udemy|alura|livraria/],
];

export function categorize(kind: Kind, description: string, text: string): string {
  if (kind === "transfer") return "Investimentos";
  const t = norm(`${description} ${text}`).replace(/mercado\s*pago/g, " ");
  if (kind === "income") {
    if (/salario|folha|holerite|pagamento de salario/.test(t)) return "Salário";
    if (/rende|rendimento|dividendo|provento|cashback|juros/.test(t)) return "Rendimentos";
    return "Recebimentos";
  }
  for (const [cat, re] of CATEGORY_RULES) if (re.test(t)) return cat;
  if (/\bpix\b|transfer/.test(t)) return "Transferências";
  return "Outros";
}

const clean = (s: string) =>
  s.replace(/\s+/g, " ").replace(/^[\s:\-–"“]+|[\s:\-–"”.]+$/g, "").slice(0, 80);

/** Tenta achar o estabelecimento/pessoa: "em LOJA", "para Fulano", "de Fulano". */
export function extractCounterparty(text: string, kind: Kind): string | null {
  const m = AMOUNT_RE.exec(text);
  const after = m ? text.slice(m.index + m[0].length) : "";
  const stop = String.raw`(?=\s+(?:para\s+o\s+cart|no\s+cart|com\s+(?:o\s+)?cart|com\s+final|cart[aã]o\s+final|foi\s|no\s+valor|[àa]s\s+\d|em\s+\d{1,2}\/|via\s+pix|pelo\s+pix)|\s*[.,;!]|\s*$)`;
  const em = new RegExp(String.raw`\bem\s+(?!\d+x\b)(.+?)${stop}`, "i");
  const para = new RegExp(String.raw`\bpara\s+(?!o\s+cart|a\s+sua|sua\s|seu\s|voc)(.+?)${stop}`, "i");
  const de = new RegExp(String.raw`\bde\s+(?!R\$|um\s|uma\s)(.+?)${stop}`, "i");
  const order = kind === "income" ? [de, em, para] : [em, para, de];
  for (const src of [after, text]) {
    for (const re of order) {
      const hit = re.exec(src);
      const val = hit && clean(hit[1]);
      if (val && val.length >= 2 && !/^R\$/i.test(val) && !/^(pix|transfer[eê]ncia|compra|pagamento)$/i.test(val)) return val;
    }
    if (kind === "income" && src === after) continue;
  }
  return null;
}

export interface ParseHints {
  app?: string;      // nome do app/banco, se o Atalho souber
  merchant?: string; // estabelecimento (gatilho "Transação" da Carteira)
  amount?: unknown;  // valor já separado
  card?: string;     // nome do cartão na Carteira
}

function parseChunk(context: string, line: string, hints: ParseHints): Parsed | null {
  const m = AMOUNT_RE.exec(line);
  const amountCents = m ? parseAmountCents(m[1]) : null;
  if (!amountCents) return null;
  const text = context ? `${context} — ${line}` : line;
  const { kind, sure } = detectKind(text);
  const party = extractCounterparty(line, kind);
  const description = party ?? clean(context.split(" — ").pop() || line.replace(new RegExp(String.raw`(?:\bde\s+)?${AMOUNT_RE.source}`, "i"), "").trim());
  return {
    amountCents,
    kind,
    description: description || "Lançamento",
    category: categorize(kind, party ?? "", text),
    account: detectAccount(text, hints.app ?? hints.card),
    needsReview: !sure || !party,
    rawText: text.slice(0, 1000),
  };
}

/**
 * Recebe o texto de uma ou várias notificações (colado, compartilhado ou vindo de OCR
 * de uma captura de tela) e devolve um lançamento por valor em R$ encontrado.
 */
export function parseNotifications(text: string, hints: ParseHints = {}): Parsed[] {
  // Caminho estruturado: gatilho "Transação" da Carteira (Apple Pay) manda valor + estabelecimento.
  const hinted = parseAmountCents(hints.amount);
  if (hinted && hints.merchant) {
    const raw = [hints.card, hints.merchant, String(hints.amount), text].filter(Boolean).join(" · ");
    const kind: Kind = /\bestorn|\breembols/.test(norm(text)) ? "income" : "expense";
    return [{
      amountCents: hinted,
      kind,
      description: clean(hints.merchant),
      category: categorize(kind, hints.merchant, ""),
      account: detectAccount(`${hints.card ?? ""} ${text}`, hints.app ?? hints.card),
      needsReview: false,
      rawText: raw.slice(0, 1000),
    }];
  }

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: Parsed[] = [];
  let context: string[] = []; // até 2 linhas antes do valor: nome do app e título
  for (const line of lines) {
    if (AMOUNT_RE.test(line)) {
      const p = parseChunk(context.join(" — "), line, hints);
      if (p) out.push(p);
      context = [];
    } else if (!/^(agora|h[aá]\s+\d+|\d{1,2}:\d{2}|ontem|hoje)\b/i.test(line)) {
      context = [...context, line.slice(0, 120)].slice(-2);
    }
  }
  return out;
}
