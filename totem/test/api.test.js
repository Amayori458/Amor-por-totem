'use strict';
// Testes da API do totem: sobem o servidor de verdade numa porta livre e numa pasta temporária.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const { limparConfig, PADRAO, tipoImagem, argsNavegador, interpretarImpressoras, impressoraAutomatica } = require('../server.js');

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

test('config pública traz todos os tamanhos e nunca o PIN', async () => {
  const { status, dados: c } = await req('/api/config');
  assert.equal(status, 200);
  assert.deepEqual(c.formatos.map((f) => f.id), ['10x15', '13x18', '15x20', '15x15', '13x13', '9x13']);
  assert.ok(c.formatos.every((f) => f.ativo));
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

  // pedido: tamanho que não existe é recusado; o válido gera número e arquivo na pasta
  assert.equal((await req('/api/pedidos', { metodo: 'POST', corpo: { itens: [{ formato: '30x40', copias: 1 }] } })).status, 400);
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
  cfg.formatos.find((f) => f.id === '9x13').ativo = false; // tamanho desligado no painel deixa de ser aceito
  assert.equal((await req('/api/admin/config', { metodo: 'PUT', admin: token, corpo: cfg })).status, 200);
  const p2 = (await req('/api/pedidos', { metodo: 'POST', corpo: { itens: [{ formato: '10x15', copias: 4 }], total: 0.01 } })).dados;
  assert.equal(p2.numero, 2);
  assert.equal(p2.total, 10);
  assert.equal((await req('/api/pedidos', { metodo: 'POST', corpo: { itens: [{ formato: '9x13', copias: 1 }] } })).status, 400);
  assert.equal((await req('/api/config')).dados.formatos.some((f) => f.id === '9x13'), false);

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

test('impressoras: lê a resposta do Windows e escolhe a ASK-400 sozinho', () => {
  const varias = interpretarImpressoras(
    JSON.stringify([
      { Name: 'Microsoft Print to PDF', DriverName: 'Microsoft Print To PDF', Default: true, WorkOffline: false },
      { Name: 'FUJIFILM ASK-400', DriverName: 'FUJIFILM ASK-400', Default: false, WorkOffline: true },
      { Name: 'HP LaserJet', DriverName: 'HP Universal', Default: false, WorkOffline: false },
      { Name: '', Default: false },
    ]),
  );
  assert.deepEqual(varias.map((i) => i.nome), ['Microsoft Print to PDF', 'FUJIFILM ASK-400', 'HP LaserJet']);
  assert.deepEqual(varias[0], { nome: 'Microsoft Print to PDF', driver: 'Microsoft Print To PDF', padrao: true, desligada: false, virtual: true });
  assert.equal(varias[1].desligada, true);
  assert.equal(impressoraAutomatica(varias), 'FUJIFILM ASK-400');

  // uma impressora só: o Windows devolve um objeto, não uma lista
  const uma = interpretarImpressoras('{"Name":"Foto do balcão","DriverName":"Fujifilm ASK 400 Series","Default":false,"WorkOffline":false}');
  assert.equal(uma.length, 1);
  assert.equal(impressoraAutomatica(uma), 'Foto do balcão'); // reconhece pelo driver mesmo com outro nome

  // nada instalado, resposta vazia ou quebrada: lista vazia, nenhuma escolha
  assert.deepEqual(interpretarImpressoras(''), []);
  assert.deepEqual(interpretarImpressoras('erro qualquer'), []);
  assert.equal(impressoraAutomatica(interpretarImpressoras(JSON.stringify([{ Name: 'HP LaserJet', DriverName: 'HP' }]))), '');
});

test('impressão direta: papel pela medida e leitura da resposta do Windows', async () => {
  const { papelPara, interpretarResposta } = require('../server.js');
  const papeis = [
    { nome: '(4x6)', largura: 101.6, altura: 152.4 },
    { nome: '(6x8)', largura: 203.2, altura: 152.4 }, // alguns drivers descrevem o papel deitado
    { nome: 'A4', largura: 210, altura: 297 },
  ];
  assert.equal(papelPara({ largura: 102, altura: 152 }, papeis).nome, '(4x6)');
  assert.equal(papelPara({ largura: 152, altura: 203 }, papeis).nome, '(6x8)');
  assert.equal(papelPara({ largura: 127, altura: 178 }, papeis), null); // 13x18 não cabe em nenhum
  assert.equal(papelPara({ largura: 102, altura: 152 }, []), null);

  assert.deepEqual(interpretarResposta('aviso qualquer\r\n{"ok":true,"papel":"(4x6)","folhas":3}\r\n'), { ok: true, papel: '(4x6)', folhas: 3 });
  // script que nem chegou a rodar (erro de sintaxe, PowerShell ausente): falha ANTES de imprimir,
  // que é o que libera a impressão de reserva pelo navegador
  for (const lixo of ['', 'ParserError: At line:3', '{"sem":"ok"}']) {
    const r = interpretarResposta(lixo);
    assert.equal(r.ok, false);
    assert.equal(r.fase, 'preparo');
  }

  // fora do Windows a rota responde "não disponível, antes de imprimir" e a verificação não acusa erro por isso
  if (process.platform !== 'win32') {
    const p = (await req('/api/pedidos', { metodo: 'POST', corpo: { itens: [{ formato: '10x15', copias: 1 }] } })).dados;
    await req(`/api/pedidos/${p.id}/itens/1`, { metodo: 'PUT', bruto: JPG });
    const r = (await req(`/api/pedidos/${p.id}/imprimir`, { metodo: 'POST' })).dados;
    assert.equal(r.ok, false);
    assert.deepEqual(r.grupos.map((g) => [g.formato, g.fase, g.codigo]), [['10x15', 'preparo', 'sem-windows']]);
    const { token } = (await req('/api/admin/entrar', { metodo: 'POST', corpo: { pin: '864213' } })).dados;
    const d = (await req('/api/admin/diagnostico', { admin: token })).dados;
    assert.ok(d.itens.some((i) => i.titulo === 'Programa do totem' && i.estado === 'ok'));
    assert.ok(d.itens.some((i) => i.titulo === 'Impressora' && i.estado === 'aviso'));
    assert.equal((await req('/api/admin/diagnostico')).status, 401);
  }
});

test('produtos com gabarito: ímã e bolinha entram no pedido como folhas, com preço por unidade', async () => {
  const cfg0 = (await req('/api/config')).dados;
  assert.deepEqual(cfg0.modelos.map((m) => [m.id, m.janelas.length, m.janelas[0].forma]), [['ima', 2, 'retangulo'], ['bolinha', 2, 'elipse']]);
  // as janelas cabem dentro da máscara e o arquivo da máscara existe
  for (const m of cfg0.modelos) {
    for (const j of m.janelas) {
      assert.ok(j.x >= 0, m.id);
      assert.ok(j.y >= 0, m.id);
      assert.ok(j.x + j.l <= m.mascara.largura, m.id);
      assert.ok(j.y + j.a <= m.mascara.altura, m.id);
    }
    assert.equal((await req(`/modelos/${m.arquivo}`)).status, 200);
  }
  // ímã: janelas de 65 x 90 mm
  const ima = cfg0.modelos[0];
  const mm = ima.folha.largura / ima.mascara.largura;
  assert.equal(Math.round(ima.janelas[0].l * mm), 65);
  assert.equal(Math.round(ima.janelas[0].a * mm), 90);

  const { token } = (await req('/api/admin/entrar', { metodo: 'POST', corpo: { pin: '864213' } })).dados;
  const cfg = (await req('/api/admin/config', { admin: token })).dados.config;
  cfg.modelos = [{ id: 'ima', nome: 'Ímã de geladeira', preco: 4, ativo: true, janelas: [] }, { id: 'bolinha', ativo: false }, { id: 'intruso', nome: 'x' }];
  const salvo = (await req('/api/admin/config', { metodo: 'PUT', admin: token, corpo: cfg })).dados.config;
  assert.deepEqual(salvo.modelos.map((m) => [m.id, m.nome, m.preco, m.ativo, m.janelas.length]), [['ima', 'Ímã de geladeira', 4, true, 2], ['bolinha', 'Bolinha de Natal', 0, false, 2]]);

  // 3 ímãs = 1 folha cheia + 1 folha com uma janela; mais 2 fotos 10x15 a 2,50
  const p = (await req('/api/pedidos', { metodo: 'POST', corpo: { itens: [{ formato: '10x15', copias: 2 }, { modelo: 'ima', unidades: 2 }, { modelo: 'ima', unidades: 1 }] } })).dados;
  assert.equal(p.total, 2 * 2.5 + 3 * 4);
  assert.equal((await req(`/api/pedidos/${p.id}/itens/2`, { metodo: 'PUT', bruto: JPG })).status, 200);
  const gravado = (await req('/api/admin/pedidos', { admin: token })).dados.pedidos.find((x) => x.id === p.id);
  assert.deepEqual(gravado.itens.map((i) => [i.arquivo, i.formatoNome, i.largura, i.altura, i.unidades || 0]), [
    ['001_10x15_2x.jpg', '10x15', 102, 152, 0],
    ['002_ima_2un.jpg', 'Ímã de geladeira', 102, 152, 2],
    ['003_ima_1un.jpg', 'Ímã de geladeira', 102, 152, 1],
  ]);
  assert.equal(gravado.totalCopias, 5);
  // produto desligado ou inexistente é recusado; unidades nunca passam do número de janelas
  assert.equal((await req('/api/pedidos', { metodo: 'POST', corpo: { itens: [{ modelo: 'bolinha', unidades: 2 }] } })).status, 400);
  assert.equal((await req('/api/pedidos', { metodo: 'POST', corpo: { itens: [{ modelo: 'intruso', unidades: 1 }] } })).status, 400);
  assert.equal((await req('/api/pedidos', { metodo: 'POST', corpo: { itens: [{ modelo: 'ima', unidades: 99 }] } })).dados.total, 8);
});
