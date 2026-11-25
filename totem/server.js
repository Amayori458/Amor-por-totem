'use strict';
/*
 * Totem de revelação de fotos — Amor por Fotos
 * Servidor local sem dependências (Node 18+).
 *
 *   node server.js            só o servidor
 *   node server.js --totem    servidor + navegador em tela cheia, imprimindo sem diálogo
 *   node server.js --teste    servidor + navegador em janela normal (mostra o diálogo de impressão)
 */
if (Number(process.versions.node.split('.')[0]) < 18) {
  console.error(`Este totem precisa do Node.js 18 ou mais novo (encontrado: ${process.versions.node}). Baixe em https://nodejs.org`);
  process.exit(1);
}

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const RAIZ = __dirname;
const PUBLICO = path.join(RAIZ, 'public');
const DADOS = path.resolve(process.env.TOTEM_DADOS || path.join(RAIZ, 'dados'));
const PORTA = Number(process.env.TOTEM_PORTA || process.env.PORT || 3000);
// Porta que só o túnel da internet usa. Tudo que chega por ela é tratado como "de fora",
// mesmo vindo de 127.0.0.1 (o cloudflared roda no próprio totem).
const PORTA_INTERNET = Number(process.env.TOTEM_PORTA_INTERNET || PORTA + 1);
const ADMIN_REMOTO = process.env.TOTEM_ADMIN_REMOTO === '1';
const ARGS = new Set(process.argv.slice(2));

const DIR_SESSOES = path.join(DADOS, 'sessoes');
const DIR_PEDIDOS = path.join(DADOS, 'pedidos');
const ARQ_CONFIG = path.join(DADOS, 'config.json');
const ARQ_ESTADO = path.join(DADOS, 'estado.json');

const MAX_FOTO = 40 * 1024 * 1024; // por arquivo
const MAX_MINI = 2 * 1024 * 1024;
const MAX_JSON = 256 * 1024;
const SESSAO_OCIOSA_MS = 60 * 60 * 1000;

/* ───────────── Configuração ───────────── */

const PADRAO = {
  loja: 'Amor por Fotos',
  chamada: 'Revele suas fotos na hora',
  mensagemFinal: 'Retire suas fotos na impressora. Obrigado pelo carinho!',
  // Tamanhos da Fujifilm ASK-400 (300 dpi). Rolo de 6": 10x15, 15x15, 15x20. Rolo de 5": 9x13, 13x13, 13x18.
  // Ative no painel apenas os que o papel carregado na impressora consegue fazer.
  formatos: [
    { id: '10x15', nome: '10x15', largura: 102, altura: 152, preco: 0, ativo: true },
    { id: '15x20', nome: '15x20', largura: 152, altura: 203, preco: 0, ativo: false },
    { id: '15x15', nome: '15x15', largura: 152, altura: 152, preco: 0, ativo: false },
    { id: '13x18', nome: '13x18', largura: 127, altura: 178, preco: 0, ativo: false },
    { id: '9x13', nome: '9x13', largura: 89, altura: 127, preco: 0, ativo: false },
    { id: '13x13', nome: '13x13', largura: 127, altura: 127, preco: 0, ativo: false },
  ],
  mostrarPrecos: false,
  maxFotos: 100,
  maxCopias: 20,
  ociosoSeg: 120,
  pendrive: true,
  imprimir: true,
  permitirBorda: true,
  bordaMm: 4,
  dpi: 300,
  diasGuardar: 7,
  internet: true, // receber fotos pelo 4G/5G do cliente, por um túnel Cloudflare
  enderecoPublico: '',
  wifi: { ssid: '', senha: '', tipo: 'WPA' },
  pin: null, // { sal, hash } — enquanto for null, o PIN é 1234
};
const PIN_PADRAO = '1234';

let config = structuredClone(PADRAO);
let estado = { proximoNumero: 1 };

function erro(status, mensagem) {
  const e = new Error(mensagem);
  e.status = status;
  return e;
}

async function gravarJson(arquivo, dados) {
  const tmp = `${arquivo}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(dados, null, 2));
  await fsp.rename(tmp, arquivo);
}

async function lerJson(arquivo, reserva) {
  try {
    return JSON.parse(await fsp.readFile(arquivo, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn(`[aviso] não consegui ler ${path.basename(arquivo)}: ${e.message}`);
    return reserva;
  }
}

const texto = (v, max, reserva = '') => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : reserva);
const numero = (v, min, max, reserva) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : reserva;
};
const inteiro = (v, min, max, reserva) => Math.round(numero(v, min, max, reserva));
const logico = (v, reserva) => (typeof v === 'boolean' ? v : reserva);

function limparFormatos(lista, reserva) {
  if (!Array.isArray(lista)) return reserva;
  const usados = new Set();
  const saida = [];
  for (const f of lista.slice(0, 12)) {
    if (!f || typeof f !== 'object') continue;
    const nome = texto(f.nome, 20);
    if (!nome) continue;
    let a = numero(f.largura, 20, 620, NaN);
    let b = numero(f.altura, 20, 620, NaN);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (a > b) [a, b] = [b, a];
    const base = (texto(f.id, 24) || nome).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'formato';
    let id = base;
    for (let i = 2; usados.has(id); i++) id = `${base}-${i}`;
    usados.add(id);
    saida.push({ id, nome, largura: a, altura: b, preco: Math.round(numero(f.preco, 0, 9999, 0) * 100) / 100, ativo: logico(f.ativo, true) });
  }
  if (!saida.length) return reserva;
  if (!saida.some((f) => f.ativo)) saida[0].ativo = true;
  return saida;
}

function limparEndereco(v) {
  const s = texto(v, 200).replace(/\/+$/, '');
  if (!s) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.origin + u.pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/** Mescla o que veio (do disco ou do painel) sobre a configuração atual, validando tudo. */
function limparConfig(entrada, atual) {
  const e = entrada && typeof entrada === 'object' ? entrada : {};
  const w = e.wifi && typeof e.wifi === 'object' ? e.wifi : {};
  return {
    loja: texto(e.loja, 60) || atual.loja,
    chamada: texto(e.chamada, 80) || atual.chamada,
    mensagemFinal: texto(e.mensagemFinal, 160, atual.mensagemFinal),
    formatos: limparFormatos(e.formatos, atual.formatos),
    mostrarPrecos: logico(e.mostrarPrecos, atual.mostrarPrecos),
    maxFotos: inteiro(e.maxFotos, 1, 500, atual.maxFotos),
    maxCopias: inteiro(e.maxCopias, 1, 99, atual.maxCopias),
    ociosoSeg: inteiro(e.ociosoSeg, 30, 900, atual.ociosoSeg),
    pendrive: logico(e.pendrive, atual.pendrive),
    imprimir: logico(e.imprimir, atual.imprimir),
    permitirBorda: logico(e.permitirBorda, atual.permitirBorda),
    bordaMm: numero(e.bordaMm, 0, 20, atual.bordaMm),
    dpi: inteiro(e.dpi, 150, 600, atual.dpi),
    diasGuardar: inteiro(e.diasGuardar, 0, 365, atual.diasGuardar),
    internet: logico(e.internet, atual.internet),
    enderecoPublico: e.enderecoPublico === undefined ? atual.enderecoPublico : limparEndereco(e.enderecoPublico),
    wifi: {
      ssid: texto(w.ssid, 32, atual.wifi.ssid),
      senha: texto(w.senha, 63, atual.wifi.senha),
      tipo: ['WPA', 'WEP', 'nopass'].includes(w.tipo) ? w.tipo : atual.wifi.tipo,
    },
    pin: atual.pin,
  };
}

function hashPin(pin, sal) {
  return crypto.scryptSync(String(pin), sal, 32).toString('hex');
}

function pinConfere(pin) {
  if (typeof pin !== 'string' || !pin) return false;
  if (!config.pin) return pin === PIN_PADRAO;
  const a = Buffer.from(hashPin(pin, config.pin.sal), 'hex');
  const b = Buffer.from(config.pin.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ───────────── Rede ───────────── */

function enderecos() {
  const lista = [];
  for (const [nome, ifaces] of Object.entries(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.internal || i.family !== 'IPv4' || i.address.startsWith('169.254.')) continue;
      const privado = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address);
      const virtual = /virtual|vethernet|vmware|vbox|docker|wsl|hyper-v|loopback|bluetooth/i.test(nome);
      lista.push({ nome, ip: i.address, peso: (privado ? 0 : 2) + (virtual ? 1 : 0) });
    }
  }
  return lista.sort((a, b) => a.peso - b.peso).map(({ nome, ip }) => ({ nome, ip, url: `http://${ip}:${PORTA}` }));
}

/** Endereço que vai no QR Code: fixo (se configurado), túnel da internet ou rede local. */
function urlBase() {
  if (config.enderecoPublico) return config.enderecoPublico;
  if (config.internet && tunel.estado === 'ativo') return tunel.url;
  const e = enderecos();
  return e.length ? e[0].url : '';
}

/** O celular precisa estar no Wi-Fi da loja? Só quando o QR aponta para a rede local. */
function viaInternet() {
  return !!config.enderecoPublico || (config.internet && tunel.estado === 'ativo');
}

function urlEnvio(id) {
  const base = urlBase();
  return base ? `${base}/enviar?s=${id}` : '';
}

/** A requisição chegou pela porta do túnel (internet)? */
const ehExterno = (req) => req.socket.server === servidorInternet;

/** Só a tela do próprio totem é "local": mesma máquina e fora da porta do túnel. */
function ehLocal(req) {
  if (ehExterno(req)) return false;
  const a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

/* ───────────── Sessões (fotos recebidas, apagadas ao final) ───────────── */

/** @type {Map<string, {id:string, criada:number, vista:number, conectado:boolean, enviando:number, fotos:Array}>} */
const sessoes = new Map();

const novoId = (bytes = 12) => crypto.randomBytes(bytes).toString('hex');
const dirSessao = (id) => path.join(DIR_SESSOES, id);

function pegarSessao(id) {
  const s = sessoes.get(id);
  if (!s) throw erro(404, 'Esta sessão terminou. Leia o QR Code do totem de novo.');
  s.vista = Date.now();
  return s;
}

async function apagarSessao(id) {
  sessoes.delete(id);
  await fsp.rm(dirSessao(id), { recursive: true, force: true });
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function tipoImagem(b) {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 8 && b.subarray(0, 8).equals(PNG)) return 'png';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** Grava o corpo da requisição em disco, com limite de tamanho, e confere se é mesmo uma imagem. */
function receberImagem(req, destinoSemExt, limite, tipos = ['jpg', 'png', 'webp']) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length'] || 0) > limite) {
      req.resume();
      return reject(erro(413, 'Foto grande demais.'));
    }
    const tmp = `${destinoSemExt}.parte`;
    const saida = fs.createWriteStream(tmp);
    let total = 0;
    let cabeca = Buffer.alloc(0);
    let falha = null;
    let fim = false;
    const terminar = (e) => {
      if (fim) return;
      fim = true;
      saida.destroy();
      fs.rm(tmp, { force: true }, () => reject(e));
    };
    req.on('data', (parte) => {
      total += parte.length;
      if (cabeca.length < 16) cabeca = Buffer.concat([cabeca, parte]).subarray(0, 16);
      if (total > limite) {
        falha = falha || erro(413, 'Foto grande demais.');
        if (total > limite * 2) req.destroy();
        return;
      }
      if (!saida.write(parte)) {
        req.pause();
        saida.once('drain', () => req.resume());
      }
    });
    req.on('error', () => terminar(erro(400, 'O envio foi interrompido.')));
    req.on('close', () => {
      if (!req.complete) terminar(erro(400, 'O envio foi interrompido.'));
    });
    saida.on('error', (e) => terminar(erro(500, `Não consegui gravar a foto: ${e.message}`)));
    req.on('end', () => {
      if (falha) return terminar(falha);
      saida.end(async () => {
        if (fim) return;
        const ext = tipoImagem(cabeca);
        if (!ext || !tipos.includes(ext)) return terminar(erro(415, 'Este arquivo não é uma foto JPG, PNG ou WebP.'));
        fim = true;
        try {
          await fsp.rename(tmp, `${destinoSemExt}.${ext}`);
          resolve({ ext, tamanho: total });
        } catch (e) {
          fs.rm(tmp, { force: true }, () => reject(e));
        }
      });
    });
  });
}

function lerCorpo(req, limite = MAX_JSON) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let total = 0;
    req.on('data', (p) => {
      total += p.length;
      if (total > limite) {
        reject(erro(413, 'Dados grandes demais.'));
        req.destroy();
      } else partes.push(p);
    });
    req.on('end', () => resolve(Buffer.concat(partes)));
    req.on('error', reject);
  });
}

async function lerJsonCorpo(req) {
  const corpo = await lerCorpo(req);
  if (!corpo.length) return {};
  try {
    const v = JSON.parse(corpo.toString('utf8'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    throw erro(400, 'JSON inválido.');
  }
}

/* ───────────── Pedidos ───────────── */

const ID_PEDIDO = /^\d{4}-\d{2}-\d{2}_\d{4,}$/;
const dirPedido = (id) => {
  if (!ID_PEDIDO.test(id)) throw erro(404, 'Pedido não encontrado.');
  return path.join(DIR_PEDIDOS, id);
};

function hojeLocal(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function lerPedido(id) {
  const p = await lerJson(path.join(dirPedido(id), 'pedido.json'), null);
  if (!p) throw erro(404, 'Pedido não encontrado.');
  return p;
}

const gravarPedido = (p) => gravarJson(path.join(dirPedido(p.id), 'pedido.json'), p);

let filaNumero = Promise.resolve();
/** Reserva o próximo número de pedido (serializado para nunca repetir). */
function proximoNumero() {
  const r = filaNumero.then(async () => {
    const n = estado.proximoNumero;
    estado.proximoNumero = n + 1;
    await gravarJson(ARQ_ESTADO, estado);
    return n;
  });
  filaNumero = r.catch(() => {});
  return r;
}

async function criarPedido(dados) {
  const itensIn = Array.isArray(dados.itens) ? dados.itens : [];
  if (!itensIn.length) throw erro(400, 'O pedido está vazio.');
  if (itensIn.length > config.maxFotos) throw erro(400, `O limite é de ${config.maxFotos} fotos por pedido.`);
  const borda = config.permitirBorda && dados.borda === true;
  const itens = itensIn.map((it, i) => {
    const f = config.formatos.find((x) => x.ativo && x.id === (it && it.formato));
    if (!f) throw erro(400, 'Tamanho de foto indisponível.');
    const copias = inteiro(it.copias, 1, config.maxCopias, 1);
    const n = i + 1;
    return {
      n,
      arquivo: `${String(n).padStart(3, '0')}_${f.id}_${copias}x.jpg`,
      nome: texto(it.nome, 120),
      formato: f.id,
      formatoNome: f.nome,
      largura: f.largura,
      altura: f.altura,
      copias,
      preco: f.preco,
      recebido: false,
    };
  });
  const numeroPedido = await proximoNumero();
  const id = `${hojeLocal()}_${String(numeroPedido).padStart(4, '0')}`;
  const pedido = {
    id,
    numero: numeroPedido,
    criado: new Date().toISOString(),
    status: 'recebendo',
    borda,
    itens,
    totalFotos: itens.length,
    totalCopias: itens.reduce((s, i) => s + i.copias, 0),
    total: Math.round(itens.reduce((s, i) => s + i.copias * i.preco, 0) * 100) / 100,
  };
  await fsp.mkdir(dirPedido(id), { recursive: true });
  await gravarPedido(pedido);
  return pedido;
}

async function listarPedidos(limite = 300) {
  let nomes = [];
  try {
    nomes = (await fsp.readdir(DIR_PEDIDOS)).filter((n) => ID_PEDIDO.test(n));
  } catch {
    return [];
  }
  nomes.sort().reverse();
  const saida = [];
  for (const n of nomes.slice(0, limite)) {
    const p = await lerJson(path.join(DIR_PEDIDOS, n, 'pedido.json'), null);
    if (p) saida.push(p);
  }
  return saida;
}

/* ───────────── Limpeza automática ───────────── */

async function limpar() {
  const agora = Date.now();
  for (const s of [...sessoes.values()]) {
    if (agora - s.vista > SESSAO_OCIOSA_MS) await apagarSessao(s.id).catch(() => {});
  }
  if (config.diasGuardar > 0) {
    const corte = hojeLocal(new Date(agora - config.diasGuardar * 86400000));
    let nomes = [];
    try {
      nomes = await fsp.readdir(DIR_PEDIDOS);
    } catch {}
    for (const n of nomes) {
      if (ID_PEDIDO.test(n) && n.slice(0, 10) < corte) await fsp.rm(path.join(DIR_PEDIDOS, n), { recursive: true, force: true }).catch(() => {});
    }
  }
}

/* ───────────── Painel (PIN) ───────────── */

const tokensAdmin = new Map(); // token -> validade
let errosPin = 0;
let bloqueadoAte = 0;

function exigirAdmin(req) {
  if (!ADMIN_REMOTO && !ehLocal(req)) throw erro(403, 'O painel só abre no próprio totem.');
  const t = req.headers['x-admin'];
  const validade = typeof t === 'string' ? tokensAdmin.get(t) : 0;
  if (!validade || validade < Date.now()) {
    if (t) tokensAdmin.delete(t);
    throw erro(401, 'Digite o PIN do painel.');
  }
  tokensAdmin.set(t, Date.now() + 30 * 60 * 1000);
}

function exigirLocal(req) {
  if (!ehLocal(req)) throw erro(403, 'Disponível apenas na tela do totem.');
}

function configPublica() {
  const { pin, ...resto } = config;
  return { ...resto, formatos: config.formatos.filter((f) => f.ativo), urlBase: urlBase(), viaInternet: viaInternet() };
}

/* ───────────── Navegador do totem ───────────── */

let navegador = null;

function acharNavegador() {
  const existe = (p) => {
    try {
      return p && fs.statSync(p).isFile();
    } catch {
      return false;
    }
  };
  if (process.env.TOTEM_NAVEGADOR && existe(process.env.TOTEM_NAVEGADOR)) return process.env.TOTEM_NAVEGADOR;
  let candidatos = [];
  if (process.platform === 'win32') {
    const bases = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean);
    for (const rel of ['Google\\Chrome\\Application\\chrome.exe', 'Microsoft\\Edge\\Application\\msedge.exe']) {
      for (const b of bases) candidatos.push(path.join(b, rel));
    }
  } else if (process.platform === 'darwin') {
    candidatos = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
  } else {
    candidatos = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
  }
  return candidatos.find(existe) || null;
}

function argsNavegador(modo, url) {
  const comuns = ['--no-first-run', '--no-default-browser-check', '--disable-features=Translate,TranslateUI', '--disable-session-crashed-bubble'];
  if (modo === 'totem') {
    return [
      '--kiosk',
      '--kiosk-printing', // imprime direto na impressora padrão, sem diálogo
      `--user-data-dir=${path.join(DADOS, 'navegador')}`,
      '--disable-pinch',
      '--overscroll-history-navigation=0',
      '--noerrdialogs',
      '--disable-infobars',
      ...comuns,
      url,
    ];
  }
  return [`--user-data-dir=${path.join(DADOS, 'navegador-teste')}`, '--new-window', ...comuns, url];
}

function abrirNavegador(modo) {
  const exe = acharNavegador();
  const url = `http://localhost:${PORTA}/`;
  if (!exe) {
    console.log(`\n[aviso] Não encontrei o Chrome nem o Edge. Abra manualmente: ${url}`);
    return;
  }
  navegador = spawn(exe, argsNavegador(modo, url), { stdio: 'ignore', detached: false });
  navegador.on('error', (e) => console.log(`[aviso] não consegui abrir o navegador: ${e.message}`));
  navegador.on('exit', () => {
    navegador = null;
  });
}

function fecharNavegador() {
  if (!navegador || !navegador.pid) return;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(navegador.pid), '/T', '/F'], { stdio: 'ignore' });
    else navegador.kill();
  } catch {}
}

function abrirNoSistema(alvo) {
  const [cmd, args] =
    process.platform === 'win32' ? ['explorer.exe', [alvo]] : process.platform === 'darwin' ? ['open', [alvo]] : ['xdg-open', [alvo]];
  const p = spawn(cmd, args, { stdio: 'ignore', detached: true });
  p.on('error', () => {});
  p.unref();
}

/* ───────────── Túnel para a internet (fotos pelo 4G/5G) ─────────────
 * O totem abre um "quick tunnel" da Cloudflare (gratuito, sem conta): um endereço
 * https://….trycloudflare.com que leva só até a porta PORTA_INTERNET deste computador.
 * O QR Code passa a apontar para ele, então o cliente não precisa do Wi-Fi da loja.
 * As fotos atravessam o túnel criptografadas e não ficam guardadas na internet.
 */

const URL_TUNEL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const tunel = { estado: 'desligado', url: '', erro: '', proc: null, ocupado: false, tentativas: 0, falhas: 0, religar: null, vigia: null };

const estadoTunel = () => ({ estado: tunel.estado, url: tunel.url, erro: tunel.erro });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function caminhoCloudflared() {
  if (process.env.TOTEM_CLOUDFLARED) return process.env.TOTEM_CLOUDFLARED;
  const nome = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  const local = path.join(RAIZ, 'runtime', nome);
  if (fs.existsSync(local)) return local;
  return process.platform === 'win32' ? null : nome; // fora do Windows, usa o que estiver instalado
}

/** No Windows, baixa o cloudflared oficial para a pasta runtime (só na primeira vez). */
function baixarCloudflared() {
  return new Promise((resolve, reject) => {
    const p = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(RAIZ, 'instalar-tunel.ps1')], { stdio: 'ignore', windowsHide: true });
    p.on('error', reject);
    p.on('exit', (codigo) => (codigo === 0 ? resolve() : reject(new Error('não consegui baixar o programa do túnel (sem internet?)'))));
  });
}

/** O endereço público já chega até este totem? */
async function tunelResponde(url) {
  if (process.env.TOTEM_TUNEL_PING === '0') return true;
  try {
    const r = await fetch(`${url}/api/ping`, { signal: AbortSignal.timeout(8000) });
    return r.ok && (await r.json()).totem === true;
  } catch {
    return false;
  }
}

function falhaTunel(mensagem) {
  tunel.estado = 'erro';
  tunel.url = '';
  tunel.erro = mensagem;
  if (tunel.tentativas === 0) console.log(`  [internet] ${mensagem} — o QR usa o Wi-Fi da loja enquanto isso.`);
  if (!config.internet) return;
  const espera = Math.min(120, 5 * 2 ** Math.min(tunel.tentativas++, 5)) * 1000;
  clearTimeout(tunel.religar);
  tunel.religar = setTimeout(iniciarTunel, espera);
  tunel.religar.unref();
}

async function iniciarTunel() {
  if (!config.internet || tunel.proc || tunel.ocupado) return;
  tunel.ocupado = true;
  clearTimeout(tunel.religar);
  try {
    let exe = caminhoCloudflared();
    if (!exe) {
      tunel.estado = 'baixando';
      console.log('  [internet] baixando o programa do túnel (só na primeira vez)...');
      await baixarCloudflared();
      exe = caminhoCloudflared();
      if (!exe) throw new Error('o programa do túnel não foi instalado');
    }
    if (!config.internet) return;
    tunel.estado = 'conectando';
    tunel.erro = '';
    const p = spawn(exe, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${PORTA_INTERNET}`], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    tunel.proc = p;
    let saida = '';
    let achou = false;
    const ler = (parte) => {
      if (achou) return;
      saida = (saida + parte).slice(-8000);
      const m = URL_TUNEL.exec(saida);
      if (!m) return;
      achou = true;
      confirmarTunel(p, m[0]);
    };
    p.stdout.on('data', ler);
    p.stderr.on('data', ler);
    p.on('error', (e) => {
      if (tunel.proc === p) tunel.proc = null;
      falhaTunel(e.code === 'ENOENT' ? 'programa do túnel (cloudflared) não encontrado' : `túnel não abriu: ${e.message}`);
    });
    p.on('exit', () => {
      if (tunel.proc !== p) return;
      tunel.proc = null;
      clearInterval(tunel.vigia);
      if (config.internet) falhaTunel('a conexão com a internet caiu');
    });
  } catch (e) {
    falhaTunel(e.message);
  } finally {
    tunel.ocupado = false;
  }
}

/** Só troca o QR para o endereço da internet depois de ver que ele realmente responde. */
async function confirmarTunel(p, url) {
  for (let i = 0; i < 20 && tunel.proc === p; i++) {
    if (await tunelResponde(url)) {
      if (tunel.proc !== p) return;
      tunel.url = url;
      tunel.estado = 'ativo';
      tunel.erro = '';
      tunel.tentativas = 0;
      tunel.falhas = 0;
      console.log(`  [internet] pronto: ${url} — o cliente envia pelo 4G/5G, sem o Wi-Fi da loja.`);
      clearInterval(tunel.vigia);
      tunel.vigia = setInterval(() => vigiarTunel(p), 90 * 1000);
      tunel.vigia.unref();
      return;
    }
    await dormir(2000);
  }
  if (tunel.proc === p) p.kill(); // não respondeu: o 'exit' agenda uma nova tentativa
}

/** Confere de tempos em tempos; três falhas seguidas e o túnel é refeito (com endereço novo). */
async function vigiarTunel(p) {
  if (tunel.proc !== p || tunel.estado !== 'ativo') return;
  if (await tunelResponde(tunel.url)) {
    tunel.falhas = 0;
    return;
  }
  if (++tunel.falhas >= 3 && tunel.proc === p) p.kill();
}

function pararTunel() {
  clearTimeout(tunel.religar);
  clearInterval(tunel.vigia);
  const p = tunel.proc;
  tunel.proc = null;
  tunel.estado = 'desligado';
  tunel.url = '';
  tunel.erro = '';
  tunel.tentativas = 0;
  if (p) {
    try {
      p.kill();
    } catch {}
  }
}

/* ───────────── HTTP ───────────── */

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};
const PAGINAS = { '/': 'index.html', '/enviar': 'enviar.html', '/admin': 'admin.html' };
const SEGURANCA = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
};

function json(res, status, corpo) {
  const dados = Buffer.from(JSON.stringify(corpo));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': dados.length, 'Cache-Control': 'no-store', ...SEGURANCA });
  res.end(dados);
}

async function enviarArquivo(req, res, arquivo, tipo, cache = 'no-cache') {
  let info;
  try {
    info = await fsp.stat(arquivo);
    if (!info.isFile()) throw new Error('não é arquivo');
  } catch {
    throw erro(404, 'Não encontrado.');
  }
  res.writeHead(200, { 'Content-Type': tipo, 'Content-Length': info.size, 'Cache-Control': cache, ...SEGURANCA });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(arquivo).on('error', () => res.destroy()).pipe(res);
}

async function estatico(req, res, caminho) {
  const rel = PAGINAS[caminho] || caminho.replace(/^\/+/, '');
  const arquivo = path.resolve(PUBLICO, rel);
  if (arquivo !== PUBLICO && !arquivo.startsWith(PUBLICO + path.sep)) throw erro(404, 'Não encontrado.');
  const tipo = TIPOS[path.extname(arquivo).toLowerCase()];
  if (!tipo) throw erro(404, 'Não encontrado.');
  await enviarArquivo(req, res, arquivo, tipo);
}

/**
 * Rotas da API. Cada entrada: [método, regex, função(req, res, parâmetros, url), pública?].
 * Só as rotas marcadas como públicas respondem pela porta do túnel (internet): são as que
 * a página do celular usa. Todo o resto exige a tela do totem ou o PIN do painel.
 */
const PUBLICA = true;
const rotas = [
  ['GET', /^\/api\/config$/, async (req, res) => {
    exigirLocal(req); // traz a senha do Wi-Fi da loja: só a tela do totem pode ler
    json(res, 200, configPublica());
  }],
  ['GET', /^\/api\/ping$/, async (req, res) => json(res, 200, { totem: true }), PUBLICA],

  /* — sessão: criada pelo totem, alimentada pelo celular — */
  ['POST', /^\/api\/sessoes$/, async (req, res) => {
    exigirLocal(req);
    const id = novoId();
    await fsp.mkdir(dirSessao(id), { recursive: true });
    sessoes.set(id, { id, criada: Date.now(), vista: Date.now(), conectado: false, enviando: 0, fotos: [] });
    json(res, 201, { id, urlEnvio: urlEnvio(id), viaInternet: viaInternet() });
  }],
  ['GET', /^\/api\/sessoes\/([a-f0-9]{24})$/, async (req, res, [id]) => {
    exigirLocal(req);
    const s = pegarSessao(id);
    json(res, 200, {
      urlEnvio: urlEnvio(id), // muda sozinho quando o túnel conecta ou cai
      viaInternet: viaInternet(),
      conectado: s.conectado,
      pendentes: s.enviando + s.fotos.filter((f) => !f.pronta).length,
      fotos: s.fotos.filter((f) => f.pronta).map(({ id: fid, nome, w, h }) => ({ id: fid, nome, w, h })),
    });
  }],
  ['DELETE', /^\/api\/sessoes\/([a-f0-9]{24})$/, async (req, res, [id]) => {
    exigirLocal(req);
    await apagarSessao(id);
    json(res, 200, { ok: true });
  }],
  ['GET', /^\/api\/sessoes\/([a-f0-9]{24})\/info$/, async (req, res, [id]) => {
    const s = pegarSessao(id);
    s.conectado = true;
    json(res, 200, { loja: config.loja, maxFotos: config.maxFotos, restantes: Math.max(0, config.maxFotos - s.fotos.length) });
  }, PUBLICA],
  ['POST', /^\/api\/sessoes\/([a-f0-9]{24})\/fotos$/, async (req, res, [id], url) => {
    const s = pegarSessao(id);
    if (s.fotos.length + s.enviando >= config.maxFotos) {
      req.resume();
      throw erro(409, `O limite é de ${config.maxFotos} fotos por pedido.`);
    }
    const fid = novoId(8);
    s.enviando++;
    try {
      const { ext } = await receberImagem(req, path.join(dirSessao(id), fid), MAX_FOTO);
      if (!sessoes.has(id)) throw erro(404, 'Esta sessão terminou.');
      s.fotos.push({
        id: fid,
        ext,
        nome: texto(url.searchParams.get('nome'), 120) || 'foto',
        w: inteiro(url.searchParams.get('w'), 1, 60000, 0),
        h: inteiro(url.searchParams.get('h'), 1, 60000, 0),
        pronta: false,
      });
      s.vista = Date.now();
      json(res, 201, { id: fid });
    } finally {
      s.enviando--;
    }
  }, PUBLICA],
  ['POST', /^\/api\/sessoes\/([a-f0-9]{24})\/fotos\/([a-f0-9]{16})\/mini$/, async (req, res, [id, fid]) => {
    const s = pegarSessao(id);
    const f = s.fotos.find((x) => x.id === fid);
    if (!f) {
      req.resume();
      throw erro(404, 'Foto não encontrada.');
    }
    await receberImagem(req, path.join(dirSessao(id), `${fid}_mini`), MAX_MINI, ['jpg']);
    f.pronta = true;
    json(res, 200, { ok: true });
  }, PUBLICA],
  ['GET', /^\/api\/sessoes\/([a-f0-9]{24})\/fotos\/([a-f0-9]{16})(\/mini)?$/, async (req, res, [id, fid, mini]) => {
    exigirLocal(req);
    const f = pegarSessao(id).fotos.find((x) => x.id === fid);
    if (!f) throw erro(404, 'Foto não encontrada.');
    const arq = mini ? `${fid}_mini.jpg` : `${fid}.${f.ext}`;
    await enviarArquivo(req, res, path.join(dirSessao(id), arq), mini ? MIME.jpg : MIME[f.ext], 'private, max-age=3600');
  }],
  ['DELETE', /^\/api\/sessoes\/([a-f0-9]{24})\/fotos\/([a-f0-9]{16})$/, async (req, res, [id, fid]) => {
    exigirLocal(req);
    const s = pegarSessao(id);
    const f = s.fotos.find((x) => x.id === fid);
    if (f) {
      s.fotos = s.fotos.filter((x) => x !== f);
      await fsp.rm(path.join(dirSessao(id), `${fid}.${f.ext}`), { force: true });
      await fsp.rm(path.join(dirSessao(id), `${fid}_mini.jpg`), { force: true });
    }
    json(res, 200, { ok: true });
  }],

  /* — pedido: o totem manda as fotos já recortadas no tamanho de impressão — */
  ['POST', /^\/api\/pedidos$/, async (req, res) => {
    exigirLocal(req);
    const p = await criarPedido(await lerJsonCorpo(req));
    json(res, 201, { id: p.id, numero: p.numero, total: p.total });
  }],
  ['PUT', /^\/api\/pedidos\/([\d_-]+)\/itens\/(\d{1,3})$/, async (req, res, [id, n]) => {
    exigirLocal(req);
    const p = await lerPedido(id).catch((e) => {
      req.resume();
      throw e;
    });
    const item = p.itens.find((i) => i.n === Number(n));
    if (!item) {
      req.resume();
      throw erro(404, 'Item não encontrado.');
    }
    const semExt = path.join(dirPedido(id), item.arquivo.replace(/\.jpg$/, ''));
    await receberImagem(req, semExt, MAX_FOTO, ['jpg']);
    // relê: outros itens podem ter sido gravados enquanto este chegava
    const atual = await lerPedido(id);
    atual.itens.find((i) => i.n === item.n).recebido = true;
    await gravarPedido(atual);
    json(res, 200, { ok: true });
  }],
  ['POST', /^\/api\/pedidos\/([\d_-]+)\/concluir$/, async (req, res, [id]) => {
    exigirLocal(req);
    const corpo = await lerJsonCorpo(req);
    const p = await lerPedido(id);
    p.status = corpo.impresso === true ? 'impresso' : 'salvo';
    p.concluido = new Date().toISOString();
    await gravarPedido(p);
    json(res, 200, { ok: true });
  }],

  /* — painel do lojista — */
  ['POST', /^\/api\/admin\/entrar$/, async (req, res) => {
    if (!ADMIN_REMOTO && !ehLocal(req)) throw erro(403, 'O painel só abre no próprio totem.');
    if (Date.now() < bloqueadoAte) throw erro(429, 'Muitas tentativas. Aguarde um minuto.');
    const { pin } = await lerJsonCorpo(req);
    if (!pinConfere(pin)) {
      if (++errosPin >= 5) {
        errosPin = 0;
        bloqueadoAte = Date.now() + 60000;
      }
      throw erro(401, 'PIN incorreto.');
    }
    errosPin = 0;
    const token = novoId(24);
    tokensAdmin.set(token, Date.now() + 30 * 60 * 1000);
    json(res, 200, { token });
  }],
  ['GET', /^\/api\/admin\/config$/, async (req, res) => {
    exigirAdmin(req);
    const { pin, ...resto } = config;
    json(res, 200, { config: resto, pinPadrao: !pin, enderecos: enderecos(), porta: PORTA, portaInternet: PORTA_INTERNET, urlBase: urlBase(), tunel: estadoTunel(), pastaPedidos: DIR_PEDIDOS, plataforma: process.platform });
  }],
  ['PUT', /^\/api\/admin\/config$/, async (req, res) => {
    exigirAdmin(req);
    config = limparConfig(await lerJsonCorpo(req), config);
    await gravarJson(ARQ_CONFIG, config);
    if (config.internet) iniciarTunel();
    else pararTunel();
    const { pin, ...resto } = config;
    json(res, 200, { config: resto, urlBase: urlBase(), tunel: estadoTunel() });
  }],
  ['POST', /^\/api\/admin\/pin$/, async (req, res) => {
    exigirAdmin(req);
    const { novo } = await lerJsonCorpo(req);
    if (typeof novo !== 'string' || !/^\d{4,8}$/.test(novo)) throw erro(400, 'O PIN deve ter de 4 a 8 números.');
    const sal = novoId(8);
    config.pin = { sal, hash: hashPin(novo, sal) };
    await gravarJson(ARQ_CONFIG, config);
    json(res, 200, { ok: true });
  }],
  ['GET', /^\/api\/admin\/pedidos$/, async (req, res) => {
    exigirAdmin(req);
    json(res, 200, { pedidos: await listarPedidos() });
  }],
  ['GET', /^\/api\/admin\/pedidos\/([\d_-]+)\/itens\/(\d{1,3})$/, async (req, res, [id, n]) => {
    exigirAdmin(req);
    const p = await lerPedido(id);
    const item = p.itens.find((i) => i.n === Number(n));
    if (!item) throw erro(404, 'Item não encontrado.');
    await enviarArquivo(req, res, path.join(dirPedido(id), item.arquivo), MIME.jpg, 'no-store');
  }],
  ['DELETE', /^\/api\/admin\/pedidos\/([\d_-]+)$/, async (req, res, [id]) => {
    exigirAdmin(req);
    await fsp.rm(dirPedido(id), { recursive: true, force: true });
    json(res, 200, { ok: true });
  }],
  ['POST', /^\/api\/admin\/pasta$/, async (req, res) => {
    exigirAdmin(req);
    exigirLocal(req);
    const { pedido } = await lerJsonCorpo(req);
    const alvo = pedido ? dirPedido(String(pedido)) : DIR_PEDIDOS;
    await fsp.mkdir(alvo, { recursive: true });
    abrirNoSistema(alvo);
    json(res, 200, { ok: true });
  }],
  ['POST', /^\/api\/admin\/teclado$/, async (req, res) => {
    exigirAdmin(req);
    exigirLocal(req);
    if (process.platform !== 'win32') throw erro(400, 'O teclado na tela só existe no Windows.');
    const p = spawn('cmd', ['/c', 'start', '', 'osk.exe'], { stdio: 'ignore', detached: true });
    p.on('error', () => {});
    p.unref();
    json(res, 200, { ok: true });
  }],
  ['POST', /^\/api\/admin\/encerrar$/, async (req, res) => {
    exigirAdmin(req);
    exigirLocal(req);
    json(res, 200, { ok: true });
    console.log('\nTotem encerrado pelo painel.');
    setTimeout(() => {
      pararTunel();
      fecharNavegador();
      setTimeout(() => process.exit(0), 400);
    }, 200);
  }],
];

async function atender(req, res) {
  const url = new URL(req.url, 'http://totem');
  let caminho;
  try {
    caminho = decodeURIComponent(url.pathname);
  } catch {
    throw erro(400, 'Endereço inválido.');
  }
  const externo = ehExterno(req);
  if (caminho.startsWith('/api/')) {
    for (const [metodo, re, fn, publica] of rotas) {
      if (req.method !== metodo) continue;
      const m = re.exec(caminho);
      if (!m) continue;
      if (externo && !publica) break;
      return fn(req, res, m.slice(1), url);
    }
    throw erro(404, 'Não encontrado.');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') throw erro(405, 'Método não permitido.');
  if (externo && !ESTATICO_EXTERNO.test(caminho)) throw erro(404, 'Não encontrado.');
  return estatico(req, res, caminho);
}

/** O que a página do celular carrega: ela mesma e seus estilos, scripts, fontes e logo. */
const ESTATICO_EXTERNO = /^\/(enviar|(css|js|fonts|img)\/[\w.-]+)$/;

function aoPedir(req, res) {
  atender(req, res).catch((e) => {
    const status = e.status || 500;
    if (status >= 500) console.error(`[erro] ${req.method} ${req.url}: ${e.stack || e.message}`);
    if (res.headersSent) return res.destroy();
    req.resume(); // descarta o que ainda estiver chegando (um envio recusado, por exemplo)
    json(res, status, { erro: status >= 500 ? 'Algo deu errado no totem. Chame um atendente.' : e.message });
  });
}
const servidor = http.createServer(aoPedir); // tela do totem e rede local
const servidorInternet = http.createServer(aoPedir); // só o túnel (127.0.0.1)
servidor.requestTimeout = servidorInternet.requestTimeout = 10 * 60 * 1000; // fotos grandes em conexão lenta

async function iniciar() {
  await fsp.mkdir(DIR_PEDIDOS, { recursive: true });
  // fotos de sessões antigas nunca sobrevivem a uma reinicialização
  await fsp.rm(DIR_SESSOES, { recursive: true, force: true });
  await fsp.mkdir(DIR_SESSOES, { recursive: true });
  const salvo = await lerJson(ARQ_CONFIG, null);
  config = limparConfig(salvo, structuredClone(PADRAO));
  if (salvo && salvo.pin && typeof salvo.pin.sal === 'string' && typeof salvo.pin.hash === 'string') config.pin = { sal: salvo.pin.sal, hash: salvo.pin.hash };
  const est = await lerJson(ARQ_ESTADO, null);
  if (est && Number.isInteger(est.proximoNumero) && est.proximoNumero > 0) estado = { proximoNumero: est.proximoNumero };
  await limpar().catch(() => {});
  setInterval(() => limpar().catch(() => {}), 30 * 60 * 1000).unref();

  const modo = ARGS.has('--totem') ? 'totem' : ARGS.has('--teste') ? 'teste' : null;
  servidor.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.log(`\nA porta ${PORTA} já está em uso — o totem provavelmente já está aberto.`);
      if (modo) abrirNavegador(modo);
      else process.exitCode = 1;
      return;
    }
    console.error(e);
    process.exit(1);
  });
  servidor.listen(PORTA, '0.0.0.0', () => {
    const e = enderecos();
    console.log('\n  Amor por Fotos — Totem de revelação');
    console.log('  ───────────────────────────────────');
    console.log(`  Tela do totem:   http://localhost:${PORTA}/`);
    console.log(`  Painel (PIN):    http://localhost:${PORTA}/admin`);
    if (config.enderecoPublico) console.log(`  QR do celular:   ${config.enderecoPublico}`);
    else if (config.internet) console.log('  QR do celular:   pela internet (4G/5G) — conectando o túnel...');
    else if (e.length) console.log(`  QR do celular:   ${e[0].url}  (${e[0].nome}, mesmo Wi-Fi)`);
    else console.log('  QR do celular:   sem rede — conecte o totem à internet ou ao Wi-Fi');
    console.log(`  Pedidos salvos:  ${DIR_PEDIDOS}`);
    if (!config.pin) console.log('  PIN do painel:   1234 (troque no painel)');
    console.log('\n  Deixe esta janela aberta. Para encerrar: feche-a ou use o painel.\n');
    if (modo) abrirNavegador(modo);
  });
  servidorInternet.on('error', (e) => console.log(`[aviso] porta ${PORTA_INTERNET} (internet) indisponível: ${e.message}`));
  servidorInternet.listen(PORTA_INTERNET, '127.0.0.1', () => {
    if (config.internet) iniciarTunel();
  });
}

function encerrar() {
  pararTunel();
  fecharNavegador();
  process.exit(0);
}
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);

if (require.main === module) iniciar();

module.exports = { limparConfig, PADRAO, tipoImagem, argsNavegador, URL_TUNEL };
