/* Funções compartilhadas entre a tela do totem, a página do celular e o painel. */

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

/** Cria um elemento: el('button', {class:'x', onclick: fn}, 'texto', outroElemento) */
export function el(tag, attrs = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat()) if (f != null && f !== false) e.append(f);
  return e;
}

export const brl = (v) => 'R$ ' + Number(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
export const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

/** fetch que fala JSON e transforma erro do servidor em Error com a mensagem pronta para o cliente. */
export async function api(caminho, { metodo = 'GET', corpo, bruto, cabecalhos = {} } = {}) {
  const opts = { method: metodo, headers: { ...cabecalhos } };
  if (bruto) opts.body = bruto;
  else if (corpo !== undefined) {
    opts.body = JSON.stringify(corpo);
    opts.headers['Content-Type'] = 'application/json';
  }
  let resp;
  try {
    resp = await fetch(caminho, opts);
  } catch {
    throw Object.assign(new Error('Sem conexão com o totem.'), { status: 0 });
  }
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) throw Object.assign(new Error(dados.erro || 'Algo deu errado.'), { status: resp.status });
  return dados;
}

/* ───────────── Imagens ───────────── */

export function carregarImagem(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não consegui abrir esta foto.'));
    img.src = src;
  });
}

const LADO_MAXIMO = 3600; // px do lado maior de uma foto enviada

const paraBlob = (canvas, tipo = 'image/jpeg', q = 0.9) =>
  new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Não consegui preparar a foto.'))), tipo, q));

/**
 * Prepara um arquivo para envio: confere se o aparelho consegue abrir, gera a miniatura
 * e converte para JPG o que o totem não aceita direto (HEIC, por exemplo).
 */
export async function prepararFoto(arquivo) {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = await carregarImagem(url);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) throw new Error('Não consegui abrir esta foto.');
    const escala = Math.min(1, 720 / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * escala));
    c.height = Math.max(1, Math.round(h * escala));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const mini = await paraBlob(c, 'image/jpeg', 0.82);
    // Vai o arquivo original, a não ser que seja maior do que qualquer impressão precisa
    // (o maior papel, 15x20 em 300 dpi, tem 2400 px) ou esteja num formato que o totem não lê
    // (HEIC, por exemplo). Nesses casos segue um JPG de até LADO_MAXIMO px: bem mais leve no 4G.
    let original = arquivo;
    let envW = w;
    let envH = h;
    const aceito = ['image/jpeg', 'image/png', 'image/webp'].includes(arquivo.type);
    if (!aceito || Math.max(w, h) > LADO_MAXIMO) {
      const reduz = Math.min(1, LADO_MAXIMO / Math.max(w, h));
      const g = document.createElement('canvas');
      g.width = envW = Math.round(w * reduz);
      g.height = envH = Math.round(h * reduz);
      const gx = g.getContext('2d');
      gx.fillStyle = '#fff';
      gx.fillRect(0, 0, g.width, g.height);
      gx.imageSmoothingQuality = 'high';
      gx.drawImage(img, 0, 0, g.width, g.height);
      const reduzida = await paraBlob(g, 'image/jpeg', 0.92);
      if (!aceito || reduzida.size < arquivo.size) original = reduzida;
      else [envW, envH] = [w, h];
    }
    return { original, mini, w: envW, h: envH, miniUrl: URL.createObjectURL(mini) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Envia uma foto preparada para a sessão. `progresso(0..1)` é opcional. */
export function enviarFoto(sessao, nome, preparada, progresso) {
  return new Promise((resolve, reject) => {
    const q = new URLSearchParams({ nome, w: preparada.w, h: preparada.h });
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/sessoes/${sessao}/fotos?${q}`);
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => e.lengthComputable && progresso && progresso(e.loaded / e.total);
    xhr.onerror = () => reject(new Error('A conexão caiu. Tente de novo.'));
    xhr.onload = async () => {
      const dados = xhr.response || {};
      if (xhr.status >= 300) return reject(Object.assign(new Error(dados.erro || 'Não consegui enviar esta foto.'), { status: xhr.status }));
      try {
        await api(`/api/sessoes/${sessao}/fotos/${dados.id}/mini`, { metodo: 'POST', bruto: preparada.mini });
        resolve(dados.id);
      } catch (e) {
        reject(e);
      }
    };
    xhr.send(preparada.original);
  });
}

/* ───────────── Enquadramento ─────────────
 * Uma foto tem: giro (0/90/180/270), modo ('preencher' | 'inteira'), zoom (>= 1),
 * centro (cx, cy em 0..1 da foto já girada) e paisagem (null = automático).
 * Tudo é proporcional, então o mesmo cálculo serve para a miniatura na tela
 * e para o arquivo final em 300 dpi.
 */

export const novoAjuste = () => ({ giro: 0, modo: 'preencher', zoom: 1, cx: 0.5, cy: 0.5, paisagem: null });

/** Largura/altura da foto depois do giro. */
export function dimsGiradas(w, h, giro) {
  return giro % 180 ? [h, w] : [w, h];
}

export function ehPaisagem(foto) {
  if (foto.paisagem != null) return foto.paisagem;
  const [w, h] = dimsGiradas(foto.w, foto.h, foto.giro);
  return w > h;
}

/** Moldura em mm: o papel deitado ou em pé, e a área útil descontando a borda branca. */
export function moldura(formato, foto, bordaMm = 0) {
  // produtos com gabarito (ímã, bolinha) têm janela de orientação fixa; fotos comuns seguem a foto
  const deitada = formato.deitadaFixa ?? ehPaisagem(foto);
  const largura = deitada ? formato.altura : formato.largura;
  const altura = deitada ? formato.largura : formato.altura;
  const b = Math.min(bordaMm, largura / 4);
  return { largura, altura, borda: b, util: [largura - 2 * b, altura - 2 * b], deitada };
}

/** Mantém o centro dentro dos limites para a foto nunca deixar buraco na moldura. */
export function limitarAjuste(foto, utilW, utilH) {
  const [ew, eh] = dimsGiradas(foto.w, foto.h, foto.giro);
  if (foto.modo === 'inteira') {
    foto.zoom = 1;
    foto.cx = 0.5;
    foto.cy = 0.5;
    return foto;
  }
  foto.zoom = Math.min(4, Math.max(1, foto.zoom));
  const s = Math.max(utilW / ew, utilH / eh) * foto.zoom;
  const mx = Math.min(0.5, utilW / s / ew / 2);
  const my = Math.min(0.5, utilH / s / eh / 2);
  foto.cx = Math.min(1 - mx, Math.max(mx, foto.cx));
  foto.cy = Math.min(1 - my, Math.max(my, foto.cy));
  return foto;
}

/** Resolução real que a foto terá no papel (pontos por polegada). */
export function dpiEfetivo(foto, formato, bordaMm = 0) {
  const m = moldura(formato, foto, bordaMm);
  const [ew, eh] = dimsGiradas(foto.w, foto.h, foto.giro);
  const [uw, uh] = m.util;
  const base = foto.modo === 'inteira' ? Math.min(uw / ew, uh / eh) : Math.max(uw / ew, uh / eh);
  // numa folha com janelas de tamanhos diferentes, vale a maior (é onde falta resolução primeiro)
  return 25.4 / (base * (foto.modo === 'inteira' ? 1 : foto.zoom) * (formato.ampliacao || 1));
}

/**
 * Desenha a foto enquadrada numa área de W x H pixels com canto em (x, y).
 * `img` pode ser a miniatura ou o original: só a proporção importa.
 */
export function desenharFoto(ctx, img, foto, x, y, W, H, forma = 'retangulo') {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const [ew, eh] = dimsGiradas(iw, ih, foto.giro);
  const base = foto.modo === 'inteira' ? Math.min(W / ew, H / eh) : Math.max(W / ew, H / eh);
  const s = base * (foto.modo === 'inteira' ? 1 : foto.zoom);
  ctx.save();
  ctx.beginPath();
  if (forma === 'elipse') ctx.ellipse(x + W / 2, y + H / 2, W / 2, H / 2, 0, 0, Math.PI * 2);
  else ctx.rect(x, y, W, H);
  ctx.clip();
  ctx.fillStyle = '#fff';
  ctx.fillRect(x, y, W, H);
  ctx.translate(x + W / 2, y + H / 2);
  ctx.scale(s, s);
  ctx.translate((0.5 - foto.cx) * ew, (0.5 - foto.cy) * eh);
  ctx.rotate((foto.giro * Math.PI) / 180);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
  ctx.restore();
}

/** Pinta a prévia (papel inteiro, com a borda branca se houver) num canvas de `larguraPx`. */
export function pintarPrevia(canvas, img, foto, formato, bordaMm, larguraPx) {
  const m = moldura(formato, foto, bordaMm);
  const px = larguraPx / m.largura;
  canvas.width = Math.round(larguraPx);
  canvas.height = Math.round(m.altura * px);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  desenharFoto(ctx, img, foto, m.borda * px, m.borda * px, canvas.width - 2 * m.borda * px, canvas.height - 2 * m.borda * px, formato.forma);
  if (formato.forma === 'elipse') {
    // contorno fino para a janela redonda aparecer sobre o papel branco
    ctx.strokeStyle = '#6b8f8d';
    ctx.lineWidth = Math.max(1, canvas.width / 300);
    ctx.beginPath();
    ctx.ellipse(canvas.width / 2, canvas.height / 2, canvas.width / 2 - ctx.lineWidth / 2, canvas.height / 2 - ctx.lineWidth / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  return m;
}

/**
 * Gera o arquivo final de impressão: sempre com o papel em pé (largura < altura),
 * que é como os drivers de impressora fotográfica definem o papel. Fotos deitadas
 * são giradas 90° para caber.
 */
export async function renderizarImpressao(img, foto, formato, bordaMm, dpi) {
  const mm = dpi / 25.4;
  const P = { w: Math.round(formato.largura * mm), h: Math.round(formato.altura * mm) };
  const m = moldura(formato, foto, bordaMm);
  const c = document.createElement('canvas');
  c.width = P.w;
  c.height = P.h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, P.w, P.h);
  let W = P.w;
  let H = P.h;
  if (m.deitada) {
    ctx.translate(P.w, 0);
    ctx.rotate(Math.PI / 2);
    W = P.h;
    H = P.w;
  }
  const b = m.borda * mm;
  desenharFoto(ctx, img, foto, b, b, W - 2 * b, H - 2 * b);
  return paraBlob(c, 'image/jpeg', 0.95);
}

/* ───────────── Produtos com gabarito (ímã, bolinha de Natal…) ─────────────
 * Um modelo é uma folha com janelas: { folha:{largura,altura} em mm, mascara:{largura,altura} em px,
 * janelas:[{x,y,l,a,forma}] em px da máscara, papel:{largura,altura} em mm }. A máscara é um PNG
 * branco com as janelas transparentes, exportado do arquivo do Photoshop.
 */

/** Transforma um modelo num "tamanho" que o resto da tela entende: a moldura é uma janela do gabarito. */
export function formatoDoModelo(modelo) {
  const mmPorPx = modelo.folha.largura / modelo.mascara.largura;
  const j = modelo.janelas[0];
  const l = j.l * mmPorPx;
  const a = j.a * mmPorPx;
  return {
    id: modelo.id,
    nome: modelo.nome,
    preco: modelo.preco,
    largura: Math.min(l, a),
    altura: Math.max(l, a),
    deitadaFixa: l > a,
    forma: j.forma,
    // quantas vezes a maior janela é maior que a do ajuste (3x4 + 5x7: a foto grande)
    ampliacao: Math.max(...modelo.janelas.map((x) => x.l / j.l)),
    modelo,
  };
}

/**
 * Desenha a folha de um modelo com o canto em (ox, oy), a `px` pixels por px da máscara:
 * cada foto na posição e no tamanho da sua janela e a máscara do gabarito por cima.
 * `unidades[i]` = { img, foto } da janela i (janela sem foto fica branca).
 */
export function desenharFolha(ctx, modelo, mascara, unidades, px, ox = 0, oy = 0) {
  modelo.janelas.forEach((j, i) => {
    const u = unidades[i];
    if (!u) return;
    // 1 px de sobra de cada lado para a máscara cobrir a emenda; quem dá a forma é a máscara
    const W = (j.l + 2) * px;
    const H = (j.a + 2) * px;
    // o mesmo enquadramento vale para janelas de proporções diferentes: cada uma confere os
    // próprios limites, para a foto nunca deixar buraco
    const ajuste = limitarAjuste({ ...u.foto }, W, H);
    desenharFoto(ctx, u.img, ajuste, ox + (j.x - 1) * px, oy + (j.y - 1) * px, W, H);
  });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (mascara) ctx.drawImage(mascara, ox, oy, modelo.mascara.largura * px, modelo.mascara.altura * px);
}

/** Prévia da folha inteira (deitada, como no gabarito) num canvas de `larguraPx`. */
export function pintarFolha(canvas, modelo, mascara, unidades, larguraPx) {
  const px = larguraPx / modelo.mascara.largura;
  canvas.width = Math.round(larguraPx);
  canvas.height = Math.round(modelo.mascara.altura * px);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  desenharFolha(ctx, modelo, mascara, unidades, px);
}

/** Distribui as unidades (uma foto por janela) em folhas: [[u1,u2],[u3,…]]. */
export function dividirEmFolhas(unidades, porFolha) {
  const folhas = [];
  for (let i = 0; i < unidades.length; i += porFolha) folhas.push(unidades.slice(i, i + porFolha));
  return folhas;
}

/**
 * Gera a folha de impressão de um modelo: cada foto na posição e no tamanho da sua janela,
 * com a máscara do gabarito por cima, em tamanho real (a folha fica centralizada no papel).
 * `unidades` = [{ img, foto }] na ordem das janelas; janela sem foto fica branca.
 */
export async function renderizarFolha(modelo, mascara, unidades, dpi) {
  const mm = dpi / 25.4;
  const P = { w: Math.round(modelo.papel.largura * mm), h: Math.round(modelo.papel.altura * mm) };
  const c = document.createElement('canvas');
  c.width = P.w;
  c.height = P.h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, P.w, P.h);
  let W = P.w;
  let H = P.h;
  if (modelo.folha.largura > modelo.folha.altura) {
    // folha deitada num papel que o driver define em pé
    ctx.translate(P.w, 0);
    ctx.rotate(Math.PI / 2);
    W = P.h;
    H = P.w;
  }
  const px = (modelo.folha.largura * mm) / modelo.mascara.largura; // px do papel por px da máscara
  const ox = (W - modelo.mascara.largura * px) / 2;
  const oy = (H - modelo.mascara.altura * px) / 2;
  desenharFolha(ctx, modelo, mascara, unidades, px, ox, oy);
  return paraBlob(c, 'image/jpeg', 0.95);
}

/* ───────────── QR Code ───────────── */

/** Devolve o SVG de um QR Code (usa vendor/qrcode.js, carregado como script clássico). */
export function qrSvg(textoQr) {
  const qr = window.qrcode(0, 'M');
  qr.addData(textoQr, 'Byte');
  qr.make();
  return qr.createSvgTag({ cellSize: 8, margin: 0, scalable: true });
}

export function textoWifi({ ssid, senha, tipo }) {
  const esc = (s) => String(s).replace(/([\\;,:"])/g, '\\$1');
  return `WIFI:T:${tipo === 'nopass' ? 'nopass' : tipo};S:${esc(ssid)};${tipo === 'nopass' ? '' : `P:${esc(senha)};`};`;
}
