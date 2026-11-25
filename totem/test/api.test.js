'use strict';
// Testes da API do totem: sobem o servidor de verdade numa porta livre e numa pasta temporária.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const { limparConfig, PADRAO, tipoImagem, argsNavegador } = require('../server.js');

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
let base;
let proc;
let dados;

const portaLivre = () =>
  new Promise((ok) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });

async function req(caminho, { metodo = 'GET', corpo, bruto, admin } = {}) {
  const headers = {};
  if (admin) headers['X-Admin'] = admin;
  if (corpo) headers['Content-Type'] = 'application/json';
  const r = await fetch(base + caminho, { method: metodo, headers, body: bruto || (corpo ? JSON.stringify(corpo) : undefined) });
  const tipo = r.headers.get('content-type') || '';
  return { status: r.status, dados: tipo.includes('json') ? await r.json() : await r.arrayBuffer() };
}

before(async () => {
  dados = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-teste-'));
  const porta = await portaLivre();
  base = `http://127.0.0.1:${porta}`;
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, TOTEM_PORTA: String(porta), TOTEM_DADOS: dados }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${base}/api/config`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('servidor não subiu');
});

after(() => {
  proc.kill();
  fs.rmSync(dados, { recursive: true, force: true });
});

test('config pública só mostra tamanhos ativos e nunca o PIN', async () => {
  const { status, dados: c } = await req('/api/config');
  assert.equal(status, 200);
  assert.deepEqual(c.formatos.map((f) => f.id), ['10x15']);
  assert.equal('pin' in c, false);
  assert.equal(c.mostrarPrecos, false);
});

test('fluxo completo: sessão, envio, pedido, painel', async () => {
  const s = (await req('/api/sessoes', { metodo: 'POST' })).dados;
  assert.match(s.id, /^[a-f0-9]{24}$/);

  // arquivo que não é imagem é recusado
  const ruim = await req(`/api/sessoes/${s.id}/fotos?nome=virus.exe`, { metodo: 'POST', bruto: Buffer.from('MZ isto não é foto') });
  assert.equal(ruim.status, 415);

  const envio = await req(`/api/sessoes/${s.id}/fotos?nome=praia.jpg&w=4000&h=3000`, { metodo: 'POST', bruto: JPG });
  assert.equal(envio.status, 201);
  const fid = envio.dados.id;

  // sem a miniatura a foto ainda não aparece no totem
  let estado = (await req(`/api/sessoes/${s.id}`)).dados;
  assert.equal(estado.fotos.length, 0);
  assert.equal(estado.pendentes, 1);
  assert.equal((await req(`/api/sessoes/${s.id}/fotos/${fid}/mini`, { metodo: 'POST', bruto: JPG })).status, 200);
  estado = (await req(`/api/sessoes/${s.id}`)).dados;
  assert.deepEqual(estado.fotos, [{ id: fid, nome: 'praia.jpg', w: 4000, h: 3000 }]);
  assert.equal((await req(`/api/sessoes/${s.id}/fotos/${fid}`)).dados.byteLength, JPG.length);

  // pedido: tamanho inativo é recusado; o válido gera número e arquivo na pasta
  assert.equal((await req('/api/pedidos', { metodo: 'POST', corpo: { itens: [{ formato: '15x20', copias: 1 }] } })).status, 400);
  assert.equal((await req('/api/pedidos', { metodo: 'POST', corpo: { itens: [] } })).status, 400);
  const p = (await req('/api/pedidos', { metodo: 'POST', corpo: { itens: [{ formato: '10x15', copias: 3, nome: 'praia.jpg' }] } })).dados;
  assert.equal(p.numero, 1);
  assert.equal((await req(`/api/pedidos/${p.id}/itens/1`, { metodo: 'PUT', bruto: JPG })).status, 200);
  assert.equal((await req(`/api/pedidos/${p.id}/itens/9`, { metodo: 'PUT', bruto: JPG })).status, 404);
  assert.equal((await req(`/api/pedidos/${p.id}/concluir`, { metodo: 'POST', corpo: { impresso: true } })).status, 200);
  assert.ok(fs.existsSync(path.join(dados, 'pedidos', p.id, '001_10x15_3x.jpg')));

  // encerrar a sessão apaga as fotos do cliente
  assert.equal((await req(`/api/sessoes/${s.id}`, { metodo: 'DELETE' })).status, 200);
  assert.equal(fs.existsSync(path.join(dados, 'sessoes', s.id)), false);
  assert.equal((await req(`/api/sessoes/${s.id}/info`)).status, 404);

  // painel: PIN errado, PIN certo, lista de pedidos
  assert.equal((await req('/api/admin/pedidos')).status, 401);
  assert.equal((await req('/api/admin/entrar', { metodo: 'POST', corpo: { pin: '0000' } })).status, 401);
  const { token } = (await req('/api/admin/entrar', { metodo: 'POST', corpo: { pin: '1234' } })).dados;
  const lista = (await req('/api/admin/pedidos', { admin: token })).dados.pedidos;
  assert.equal(lista.length, 1);
  assert.equal(lista[0].status, 'impresso');
  assert.equal(lista[0].totalCopias, 3);
  assert.equal(lista[0].itens[0].recebido, true);

  // preços: ligados no painel, o servidor calcula o total (nunca confia no totem)
  const cfg = (await req('/api/admin/config', { admin: token })).dados.config;
  cfg.mostrarPrecos = true;
  cfg.formatos[0].preco = 2.5;
  assert.equal((await req('/api/admin/config', { metodo: 'PUT', admin: token, corpo: cfg })).status, 200);
  const p2 = (await req('/api/pedidos', { metodo: 'POST', corpo: { itens: [{ formato: '10x15', copias: 4 }], total: 0.01 } })).dados;
  assert.equal(p2.numero, 2);
  assert.equal(p2.total, 10);

  // trocar o PIN invalida o padrão
  assert.equal((await req('/api/admin/pin', { metodo: 'POST', admin: token, corpo: { novo: '12' } })).status, 400);
  assert.equal((await req('/api/admin/pin', { metodo: 'POST', admin: token, corpo: { novo: '864213' } })).status, 200);
  assert.equal((await req('/api/admin/entrar', { metodo: 'POST', corpo: { pin: '1234' } })).status, 401);
  assert.equal((await req('/api/admin/entrar', { metodo: 'POST', corpo: { pin: '864213' } })).status, 200);
  assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(path.join(dados, 'config.json'), 'utf8'))).includes('864213'), false);
});

test('arquivos estáticos não escapam da pasta public', async () => {
  for (const c of ['/..%2fserver.js', '/%2e%2e/server.js', '/js/..%2f..%2fserver.js', '/dados/config.json', '/server.js']) {
    assert.equal((await req(c)).status, 404, c);
  }
  assert.equal((await req('/')).status, 200);
  assert.equal((await req('/enviar')).status, 200);
  assert.equal((await req('/js/totem.js')).status, 200);
});

test('limparConfig valida o que vem do painel', () => {
  const c = limparConfig(
    { loja: '  ', maxFotos: 99999, dpi: 'abc', bordaMm: -3, enderecoPublico: 'javascript:alert(1)', formatos: [{ nome: 'Grande', largura: 300, altura: 200, preco: -5, ativo: false }, { nome: '', largura: 1, altura: 1 }], wifi: { ssid: 'Loja', senha: 'x', tipo: 'XYZ' } },
    structuredClone(PADRAO),
  );
  assert.equal(c.loja, PADRAO.loja);
  assert.equal(c.maxFotos, 500);
  assert.equal(c.dpi, PADRAO.dpi);
  assert.equal(c.bordaMm, 0);
  assert.equal(c.enderecoPublico, '');
  assert.deepEqual(c.formatos, [{ id: 'grande', nome: 'Grande', largura: 200, altura: 300, preco: 0, ativo: true }]);
  assert.deepEqual(c.wifi, { ssid: 'Loja', senha: 'x', tipo: 'WPA' });
});

test('reconhece imagens pelo conteúdo e monta os argumentos do navegador', () => {
  assert.equal(tipoImagem(JPG), 'jpg');
  assert.equal(tipoImagem(Buffer.from('RIFF0000WEBPVP8 ')), 'webp');
  assert.equal(tipoImagem(Buffer.from('<svg onload=alert(1)>')), null);
  const totem = argsNavegador('totem', 'http://localhost:3000/');
  assert.ok(totem.includes('--kiosk') && totem.includes('--kiosk-printing'));
  assert.equal(argsNavegador('teste', 'x').includes('--kiosk-printing'), false);
});
