'use strict';
// Envio pelo 4G: o QR passa a usar o endereço do túnel e, pela porta do túnel,
// só existe o que a página do celular precisa — nada de painel, pedidos ou configuração.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const pular = process.platform === 'win32'; // o túnel de mentira é um script com "#!"
let local;
let internet;
let proc;
let dados;

const portaLivre = () =>
  new Promise((ok) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });

async function req(base, caminho, { metodo = 'GET', corpo, bruto, admin } = {}) {
  const headers = {};
  if (admin) headers['X-Admin'] = admin;
  if (corpo) headers['Content-Type'] = 'application/json';
  const r = await fetch(base + caminho, { method: metodo, headers, body: bruto || (corpo ? JSON.stringify(corpo) : undefined) });
  const tipo = r.headers.get('content-type') || '';
  return { status: r.status, dados: tipo.includes('json') ? await r.json() : await r.arrayBuffer() };
}

async function esperar(fn, ms = 5000) {
  const fim = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > fim) throw new Error('tempo esgotado');
    await new Promise((r) => setTimeout(r, 100));
  }
}

before(async () => {
  if (pular) return;
  dados = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-internet-'));
  const [p1, p2] = [await portaLivre(), await portaLivre()];
  local = `http://127.0.0.1:${p1}`;
  internet = `http://127.0.0.1:${p2}`;
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, TOTEM_PORTA: String(p1), TOTEM_PORTA_INTERNET: String(p2), TOTEM_DADOS: dados, TOTEM_CLOUDFLARED: path.join(__dirname, '..', 'ferramentas', 'falso-cloudflared.js'), TOTEM_TUNEL_PING: '0' },
    stdio: 'ignore',
  });
  await esperar(() => fetch(`${local}/api/ping`).then((r) => r.ok, () => false));
});

after(() => {
  if (pular) return;
  proc.kill();
  fs.rmSync(dados, { recursive: true, force: true });
});

test('o QR Code usa o endereço da internet assim que o túnel conecta', { skip: pular }, async () => {
  const s = (await req(local, '/api/sessoes', { metodo: 'POST' })).dados;
  const estado = await esperar(async () => {
    const e = (await req(local, `/api/sessoes/${s.id}`)).dados;
    return e.viaInternet ? e : null;
  });
  assert.equal(estado.urlEnvio, `https://totem-de-teste.trycloudflare.com/enviar?s=${s.id}`);
  assert.equal((await req(local, '/api/config')).dados.viaInternet, true);
});

test('pela internet só existe a página do celular', { skip: pular }, async () => {
  const s = (await req(local, '/api/sessoes', { metodo: 'POST' })).dados;

  // o que o celular usa funciona
  assert.equal((await req(internet, '/api/ping')).status, 200);
  assert.equal((await req(internet, '/enviar')).status, 200);
  assert.equal((await req(internet, '/js/enviar.js')).status, 200);
  assert.equal((await req(internet, '/img/logo.png')).status, 200);
  assert.equal((await req(internet, `/api/sessoes/${s.id}/info`)).status, 200);
  const envio = await req(internet, `/api/sessoes/${s.id}/fotos?nome=a.jpg&w=100&h=80`, { metodo: 'POST', bruto: JPG });
  assert.equal(envio.status, 201);
  assert.equal((await req(internet, `/api/sessoes/${s.id}/fotos/${envio.dados.id}/mini`, { metodo: 'POST', bruto: JPG })).status, 200);
  assert.equal((await req(local, `/api/sessoes/${s.id}`)).dados.fotos.length, 1);

  // todo o resto não existe por ali, mesmo a conexão vindo de 127.0.0.1
  const { token } = (await req(local, '/api/admin/entrar', { metodo: 'POST', corpo: { pin: '1234' } })).dados;
  const fechados = [
    ['GET', '/'],
    ['GET', '/admin'],
    ['GET', '/vendor/qrcode.js'],
    ['GET', '/api/config'],
    ['POST', '/api/sessoes'],
    ['GET', `/api/sessoes/${s.id}`],
    ['DELETE', `/api/sessoes/${s.id}`],
    ['GET', `/api/sessoes/${s.id}/fotos/${envio.dados.id}`],
    ['DELETE', `/api/sessoes/${s.id}/fotos/${envio.dados.id}`],
    ['POST', '/api/pedidos'],
    ['POST', '/api/admin/entrar'],
    ['GET', '/api/admin/config'],
    ['GET', '/api/admin/pedidos'],
    ['POST', '/api/admin/encerrar'],
  ];
  for (const [metodo, caminho] of fechados) {
    const r = await req(internet, caminho, { metodo, admin: token, corpo: metodo === 'GET' || metodo === 'DELETE' ? undefined : { pin: '1234', itens: [] } });
    assert.equal(r.status, 404, `${metodo} ${caminho}`);
  }
  // um envio recusado (sessão que não existe) responde sem travar a conexão
  assert.equal((await req(internet, '/api/sessoes/aaaaaaaaaaaaaaaaaaaaaaaa/fotos', { metodo: 'POST', bruto: JPG })).status, 404);
});

test('desligar no painel devolve o QR à rede da loja e encerra o túnel', { skip: pular }, async () => {
  const { token } = (await req(local, '/api/admin/entrar', { metodo: 'POST', corpo: { pin: '1234' } })).dados;
  const antes = (await req(local, '/api/admin/config', { admin: token })).dados;
  assert.equal(antes.tunel.estado, 'ativo');
  const r = await req(local, '/api/admin/config', { metodo: 'PUT', admin: token, corpo: { ...antes.config, internet: false } });
  assert.equal(r.dados.tunel.estado, 'desligado');
  const s = (await req(local, '/api/sessoes', { metodo: 'POST' })).dados;
  assert.equal(s.viaInternet, false);
  assert.doesNotMatch(s.urlEnvio, /trycloudflare/);
});
