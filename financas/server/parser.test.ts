import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAmountCents, parseNotifications } from "./parser.js";

const one = (text: string, hints = {}) => {
  const r = parseNotifications(text, hints);
  assert.equal(r.length, 1, `esperava 1 lançamento em: ${text}`);
  return r[0];
};

test("valores em reais", () => {
  assert.equal(parseAmountCents("1.234,56"), 123456);
  assert.equal(parseAmountCents("R$ 25,90"), 2590);
  assert.equal(parseAmountCents(25.9), 2590);
  assert.equal(parseAmountCents("25.90"), 2590);
  assert.equal(parseAmountCents("1.500"), 150000);
  assert.equal(parseAmountCents("abc"), null);
});

test("Nubank: compra no cartão", () => {
  const p = one("Compra aprovada\nCompra de R$ 25,90 APROVADA em PADARIA BELA VISTA para o cartão com final 1234.", { app: "Nubank" });
  assert.deepEqual([p.amountCents, p.kind, p.description, p.category, p.account, p.needsReview],
    [2590, "expense", "PADARIA BELA VISTA", "Alimentação", "Nubank", false]);
});

test("Nubank: transferência recebida", () => {
  const p = one("Transferência recebida\nVocê recebeu uma transferência de R$ 1.200,00 de Maria de Souza.", { app: "Nubank" });
  assert.deepEqual([p.amountCents, p.kind, p.description, p.category], [120000, "income", "Maria de Souza", "Recebimentos"]);
});

test("Nubank: transferência enviada", () => {
  const p = one("Transferência enviada\nSua transferência de R$ 50,00 para João Pereira foi enviada com sucesso.", { app: "Nubank" });
  assert.deepEqual([p.amountCents, p.kind, p.description, p.category], [5000, "expense", "João Pereira", "Transferências"]);
});

test("Mercado Pago: pagamento e recebimento", () => {
  const a = one("Mercado Pago\nVocê pagou R$ 30,00 para UBER DO BRASIL");
  assert.deepEqual([a.kind, a.description, a.category, a.account], ["expense", "UBER DO BRASIL", "Transporte", "Mercado Pago"]);
  const b = one("Mercado Pago\nVocê recebeu R$ 80,00 de Carlos Lima via Pix");
  assert.deepEqual([b.kind, b.description, b.account], ["income", "Carlos Lima", "Mercado Pago"]);
});

test("XP: cartão e investimento", () => {
  const a = one("XP: Compra aprovada no cartão final 9876: R$ 349,90 em AMAZON BR");
  assert.deepEqual([a.amountCents, a.kind, a.description, a.category, a.account], [34990, "expense", "AMAZON BR", "Compras", "XP"]);
  const b = one("XP Investimentos\nSua aplicação de R$ 2.000,00 em CDB Banco XP foi realizada.");
  assert.deepEqual([b.kind, b.category, b.account], ["transfer", "Investimentos", "XP"]);
});

test("estorno conta como entrada", () => {
  const p = one("Estorno de compra\nO estorno de R$ 99,00 em LOJA X foi aprovado", { app: "Nubank" });
  assert.equal(p.kind, "income");
});

test("várias notificações de uma captura de tela (OCR)", () => {
  const r = parseNotifications([
    "Nubank", "agora", "Compra aprovada",
    "Compra de R$ 12,00 APROVADA em IFOOD para o cartão com final 1234.",
    "Mercado Pago", "há 5 min",
    "Você recebeu R$ 80,00 de Carlos Lima",
    "WhatsApp", "Oi, tudo bem?",
  ].join("\n"));
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((p) => [p.account, p.kind, p.amountCents]), [["Nubank", "expense", 1200], ["Mercado Pago", "income", 8000]]);
});

test("Carteira (Apple Pay): campos estruturados", () => {
  const p = one("", { merchant: "Posto Shell", amount: "R$ 150,00", card: "Nubank Mastercard" });
  assert.deepEqual([p.amountCents, p.kind, p.description, p.category, p.account, p.needsReview],
    [15000, "expense", "Posto Shell", "Transporte", "Nubank", false]);
});

test("texto sem pista vai para revisão; texto sem valor é ignorado", () => {
  assert.equal(one("Movimentação de R$ 10,00 na sua conta").needsReview, true);
  assert.equal(parseNotifications("Sua fatura está disponível").length, 0);
});
