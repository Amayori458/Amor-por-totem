/* Tela do totem: início → enviar fotos → montar pedido → revelar → pronto. */
import {
  $, $$, el, api, brl, plural, carregarImagem, prepararFoto, enviarFoto, novoAjuste, dimsGiradas, ehPaisagem,
  moldura, limitarAjuste, dpiEfetivo, pintarPrevia, renderizarImpressao, qrSvg, textoWifi,
  formatoDoModelo, dividirEmFolhas, renderizarFolha,
} from './comum.js';
import { icone, aplicarIcones } from './icones.js';
import { imprimirPedido } from './imprimir.js';

const DPI_MINIMO = 110; // abaixo disso a foto sai visivelmente sem nitidez
const app = $('#app');
const modais = $('#modais');

const E = {
  cfg: null,
  tela: 'inicio',
  sessao: null, // { id, urlEnvio }
  fotos: [], // { id, nome, w, h, mini, formato, copias, ...ajuste }
  borda: false,
  formato: null, // tamanho aplicado às fotos novas
  lendoLocal: null, // { feitas, total } enquanto lê o pendrive
  ocupado: false,
  ultimoToque: Date.now(),
};

/* ───────────── utilidades ───────────── */

const formatoDe = (foto) => E.cfg.formatos.find((f) => f.id === foto.formato) || E.cfg.formatos[0];
// borda branca só existe em foto comum; nos produtos com gabarito quem manda é a janela
const bordaDe = (foto) => (E.borda && E.cfg.permitirBorda && !formatoDe(foto).modelo ? E.cfg.bordaMm : 0);
const urlOriginal = (foto) => `/api/sessoes/${E.sessao.id}/fotos/${foto.id}`;
const urlMini = (foto) => `${urlOriginal(foto)}/mini`;
const tocou = () => (E.ultimoToque = Date.now());

function ajustarLimites(foto) {
  const m = moldura(formatoDe(foto), foto, bordaDe(foto));
  limitarAjuste(foto, m.util[0], m.util[1]);
  return m;
}

function irPara(tela) {
  E.tela = tela;
  app.dataset.tela = tela;
  for (const s of $$('.tela', app)) s.classList.toggle('ativa', s.dataset.tela === tela);
  const ordem = ['fotos', 'pedido', 'imprimindo'];
  for (const li of $$('.etapas li')) {
    const i = ordem.indexOf(li.dataset.etapa);
    const atual = ordem.indexOf(tela);
    li.classList.toggle('atual', i === atual);
    li.classList.toggle('feita', atual > i);
  }
  tocou();
}

function abrirModal(conteudo, { classe = '', fecharFora = false, aoFechar } = {}) {
  const caixa = el('div', { class: `modal-caixa ${classe}`, role: 'dialog', 'aria-modal': 'true' }, conteudo);
  const fundo = el('div', { class: 'modal' }, caixa);
  let aberto = true;
  const fechar = () => {
    if (!aberto) return;
    aberto = false;
    fundo.remove();
    if (aoFechar) aoFechar();
  };
  if (fecharFora) fundo.addEventListener('pointerdown', (e) => e.target === fundo && fechar());
  modais.append(fundo);
  return { fechar, caixa };
}

function fecharModais() {
  modais.replaceChildren();
}

function botao(rotulo, { variante = '', iconeNome, iconeFim, classe = '', onclick, ...resto } = {}) {
  return el(
    'button',
    { type: 'button', class: `af-btn ${variante ? `af-btn-${variante}` : ''} ${classe}`, onclick, ...resto },
    iconeNome && icone(iconeNome),
    rotulo && el('span', {}, rotulo),
    iconeFim && icone(iconeFim),
  );
}

function aviso(titulo, texto, acoes = [['Entendi', null]]) {
  const m = abrirModal(
    el(
      'div',
      { class: 'aviso' },
      el('h2', { class: 't-title' }, titulo),
      el('p', { class: 't-lead' }, texto),
      el(
        'div',
        { class: 'modal-acoes' },
        acoes.map(([rotulo, fn], i) =>
          botao(rotulo, {
            variante: i === acoes.length - 1 ? 'primary' : '',
            classe: 'btn-lg',
            onclick: () => {
              m.fechar();
              if (fn) fn();
            },
          }),
        ),
      ),
    ),
  );
  return m;
}

/** Seletor de quantidade: − n + */
function passo(valor, min, max, aoMudar) {
  const num = el('output', { class: 'passo-valor' }, String(valor));
  const menos = botao('', { iconeNome: 'menos', classe: 'passo-btn', 'aria-label': 'Menos uma cópia' });
  const mais = botao('', { iconeNome: 'mais', classe: 'passo-btn', 'aria-label': 'Mais uma cópia' });
  const definir = (v, avisar = true) => {
    valor = Math.min(max, Math.max(min, v));
    num.textContent = String(valor);
    menos.disabled = valor <= min;
    mais.disabled = valor >= max;
    if (avisar) aoMudar(valor);
  };
  menos.addEventListener('click', () => definir(valor - 1));
  mais.addEventListener('click', () => definir(valor + 1));
  definir(valor, false);
  const raiz = el('div', { class: 'passo' }, menos, num, mais);
  raiz.definir = (v) => definir(v, false);
  return raiz;
}

/* ───────────── configuração e início ───────────── */

async function carregarConfig() {
  E.cfg = await api('/api/config');
  document.title = `${E.cfg.loja} — Totem`;
  $('#chamada').textContent = E.cfg.chamada;
  for (const img of $$('.inicio-logo, .topo-logo')) img.alt = E.cfg.loja;
  // ímã, bolinha de Natal…: cada modelo vira um "tamanho" cuja moldura é uma janela do gabarito
  const modelos = (E.cfg.modelos || []).map(formatoDoModelo);
  E.cfg.formatos = [...E.cfg.formatos, ...modelos];
  E.formato = E.cfg.formatos[0].id;
  $('#rotulo-tamanhos').textContent = modelos.length ? 'Tamanho ou produto de todas' : 'Tamanho de todas';
  $('#bloco-pendrive').hidden = !E.cfg.pendrive;
  $('#bloco-borda').hidden = !E.cfg.permitirBorda || !(E.cfg.bordaMm > 0);
  $('#bloco-tamanhos').hidden = E.cfg.formatos.length < 2;
}

async function comecar() {
  if (E.sessao || E.ocupado) return;
  E.ocupado = true;
  try {
    await carregarConfig();
    E.sessao = await api('/api/sessoes', { metodo: 'POST' });
    E.fotos = [];
    E.borda = false;
    $('#borda').checked = false;
    $('#grade-minis').replaceChildren();
    montarEnvio();
    atualizarGaleria();
    irPara('fotos');
    sondar();
  } catch (e) {
    aviso('O totem não respondeu', `${e.message} Chame um atendente.`);
  } finally {
    E.ocupado = false;
  }
}

/** Desenha o QR Code de envio. É refeito sozinho se o endereço mudar (túnel conectou ou caiu). */
function montarEnvio() {
  const temRede = !!E.sessao.urlEnvio;
  const internet = temRede && E.sessao.viaInternet;
  $('.envio-qr').hidden = !temRede;
  $('#sem-rede').hidden = temRede;
  if (temRede) $('#qr-envio').innerHTML = qrSvg(E.sessao.urlEnvio);
  const w = E.cfg.wifi;
  // pela internet o cliente usa o próprio 4G/5G; o Wi-Fi da loja só entra quando o QR é da rede local
  const temWifi = temRede && !internet && !!w.ssid;
  $('#envio-rede').textContent = !temRede ? '' : internet ? 'Funciona com a internet do seu celular (4G, 5G ou Wi-Fi).' : temWifi ? '' : 'Seu celular precisa estar no Wi-Fi da loja.';
  $('#bloco-wifi').hidden = !temWifi;
  if (temWifi) {
    $('#qr-wifi').innerHTML = qrSvg(textoWifi(w));
    $('#wifi-nome').textContent = w.ssid;
  }
}

async function reiniciar() {
  const antiga = E.sessao;
  E.sessao = null;
  E.fotos = [];
  E.lendoLocal = null;
  E.ocupado = false;
  clearTimeout(reiniciar.volta);
  fecharModais();
  $('#grade-minis').replaceChildren();
  $('#grade-cartoes').replaceChildren();
  irPara('inicio');
  if (antiga) api(`/api/sessoes/${antiga.id}`, { metodo: 'DELETE' }).catch(() => {});
  carregarConfig().catch(() => {});
}

/* ───────────── etapa 1: receber fotos ───────────── */

async function sondar() {
  const minha = E.sessao;
  while (E.sessao === minha && minha) {
    try {
      const s = await api(`/api/sessoes/${minha.id}`);
      if (E.sessao !== minha) return;
      if (s.urlEnvio !== minha.urlEnvio || s.viaInternet !== minha.viaInternet) {
        minha.urlEnvio = s.urlEnvio;
        minha.viaInternet = s.viaInternet;
        montarEnvio();
      }
      const conhecidas = new Set(E.fotos.map((f) => f.id));
      const novas = s.fotos.filter((f) => !conhecidas.has(f.id));
      for (const n of novas) {
        const mini = await carregarImagem(`/api/sessoes/${minha.id}/fotos/${n.id}/mini`).catch(() => null);
        if (!mini || E.sessao !== minha) continue;
        const foto = { ...n, mini, w: n.w || mini.naturalWidth, h: n.h || mini.naturalHeight, formato: E.formato, copias: 1, ...novoAjuste() };
        ajustarLimites(foto);
        E.fotos.push(foto);
        adicionarMini(foto);
        if (E.tela === 'pedido') $('#grade-cartoes').append(cartao(foto));
      }
      if (novas.length || s.pendentes) tocou();
      atualizarGaleria(s);
      if (novas.length && E.tela === 'pedido') atualizarResumo();
    } catch (e) {
      if (e.status === 404 && E.sessao === minha) {
        reiniciar();
        return;
      }
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
}

function adicionarMini(foto) {
  const tile = el(
    'div',
    { class: 'mini', 'data-id': foto.id },
    el('img', { src: urlMini(foto), alt: foto.nome, draggable: 'false' }),
    botao('', { iconeNome: 'fechar', classe: 'mini-x', 'aria-label': `Remover ${foto.nome}`, onclick: () => removerFoto(foto) }),
  );
  $('#grade-minis').append(tile);
}

async function removerFoto(foto) {
  E.fotos = E.fotos.filter((f) => f !== foto);
  $(`.mini[data-id="${foto.id}"]`)?.remove();
  foto.cartao?.remove();
  atualizarGaleria();
  atualizarResumo();
  if (E.sessao) api(`${urlOriginal(foto)}`, { metodo: 'DELETE' }).catch(() => {});
  if (!E.fotos.length && E.tela === 'pedido') irPara('fotos');
}

let ultimaSessao = { conectado: false, pendentes: 0 };
function atualizarGaleria(s) {
  if (s) ultimaSessao = s;
  const n = E.fotos.length;
  $('#conta-fotos').textContent = n ? String(n) : '';
  $('#galeria-vazia').hidden = n > 0;
  $('#continuar').disabled = n === 0;
  const cheio = n >= E.cfg.maxFotos;
  $('#info-fotos').textContent = cheio
    ? `Você chegou ao limite de ${E.cfg.maxFotos} fotos por pedido.`
    : n
      ? `${plural(n, 'foto pronta', 'fotos prontas')}. Envie mais ou continue.`
      : 'Envie ao menos uma foto para continuar.';
  const st = $('#status-envio');
  let texto = '';
  let vivo = false;
  if (E.lendoLocal) {
    texto = `Lendo fotos do pendrive… ${E.lendoLocal.feitas} de ${E.lendoLocal.total}`;
    vivo = true;
  } else if (ultimaSessao.pendentes) {
    texto = `Recebendo ${plural(ultimaSessao.pendentes, 'foto', 'fotos')}…`;
    vivo = true;
  } else if (ultimaSessao.conectado) texto = 'Celular conectado';
  else if (E.sessao?.urlEnvio) texto = 'Aguardando seu celular';
  st.textContent = texto;
  st.classList.toggle('vivo', vivo);
  st.classList.toggle('ok', !vivo && ultimaSessao.conectado);
}

async function lerPendrive(arquivos) {
  if (!arquivos.length || !E.sessao) return;
  const minha = E.sessao;
  E.lendoLocal = { feitas: 0, total: arquivos.length };
  let falhas = 0;
  let limite = null;
  atualizarGaleria();
  for (const arq of arquivos) {
    if (E.sessao !== minha) return;
    tocou();
    try {
      const pronta = await prepararFoto(arq);
      URL.revokeObjectURL(pronta.miniUrl);
      await enviarFoto(minha.id, arq.name, pronta);
    } catch (e) {
      if (e.status === 409) {
        limite = e.message;
        break;
      }
      falhas++;
    }
    E.lendoLocal.feitas++;
    atualizarGaleria();
  }
  if (E.sessao !== minha) return;
  E.lendoLocal = null;
  atualizarGaleria();
  if (limite) aviso('Limite de fotos', limite);
  else if (falhas) aviso('Algumas fotos ficaram de fora', `${plural(falhas, 'arquivo não pôde ser aberto', 'arquivos não puderam ser abertos')}. Só aceitamos fotos JPG, PNG ou WebP.`);
}

/* ───────────── etapa 2: montar o pedido ───────────── */

function precoTexto(f) {
  return E.cfg.mostrarPrecos && f.preco > 0 ? brl(f.preco) : '';
}

function chipsTamanho(alvo, atualId, aoEscolher) {
  alvo.replaceChildren(
    ...E.cfg.formatos.map((f) =>
      el(
        'button',
        { type: 'button', class: 'af-chip', 'aria-pressed': String(f.id === atualId), onclick: () => aoEscolher(f) },
        el('span', {}, f.nome),
        precoTexto(f) && el('span', { class: 'af-chip-count' }, precoTexto(f)),
      ),
    ),
  );
}

function montarPedido() {
  const ids = new Set(E.fotos.map((f) => f.formato));
  chipsTamanho($('#chips-tamanho'), ids.size === 1 ? [...ids][0] : null, (f) => {
    E.formato = f.id;
    for (const foto of E.fotos) {
      foto.formato = f.id;
      ajustarLimites(foto);
    }
    montarPedido();
  });
  $('#grade-cartoes').replaceChildren(...E.fotos.map(cartao));
  atualizarResumo();
}

function cartao(foto) {
  const canvas = el('canvas', { class: 'cartao-canvas' });
  const selo = el('span', { class: 'af-badge cartao-tamanho' });
  const alerta = el('span', { class: 'cartao-alerta', title: 'Baixa resolução' }, icone('alerta'));
  const foto_ = el('button', { type: 'button', class: 'cartao-foto', 'aria-label': `Ajustar ${foto.nome}`, onclick: () => abrirEditor(foto) }, canvas, selo, alerta);
  const qtd = passo(foto.copias, 1, E.cfg.maxCopias, (v) => {
    foto.copias = v;
    atualizarResumo();
  });
  const raiz = el(
    'article',
    { class: 'cartao' },
    foto_,
    el('div', { class: 'cartao-acoes' }, qtd, botao('', { iconeNome: 'lixo', classe: 'cartao-lixo', 'aria-label': `Remover ${foto.nome}`, onclick: () => removerFoto(foto) })),
  );
  foto.cartao = raiz;
  foto.pintarCartao = () => {
    const f = formatoDe(foto);
    pintarPrevia(canvas, foto.mini, foto, f, bordaDe(foto), 420);
    selo.textContent = f.nome;
    selo.hidden = E.cfg.formatos.length < 2;
    alerta.hidden = dpiEfetivo(foto, f, bordaDe(foto)) >= DPI_MINIMO;
    qtd.definir(foto.copias);
  };
  foto.pintarCartao();
  return raiz;
}

function atualizarResumo() {
  const copias = E.fotos.reduce((s, f) => s + f.copias, 0);
  $('#resumo-linha').textContent = `${plural(E.fotos.length, 'foto', 'fotos')} · ${plural(copias, 'cópia', 'cópias')}`;
  const total = E.fotos.reduce((s, f) => s + f.copias * formatoDe(f).preco, 0);
  const comPreco = E.cfg.mostrarPrecos && total > 0;
  $('#resumo-total').textContent = comPreco ? brl(total) : '';
  $('#resumo-total').hidden = !comPreco;
  $('#revelar').disabled = !E.fotos.length;
}

/* — editor de enquadramento — */

function abrirEditor(foto) {
  let img = foto.mini;
  let aberto = true;
  const canvas = el('canvas', { class: 'editor-canvas' });
  const palco = el('div', { class: 'editor-palco' }, canvas);
  const alerta = el('p', { class: 'editor-alerta' }, icone('alerta'), el('span', {}, 'Esta foto tem poucos pixels para este tamanho e pode sair sem nitidez.'));
  const chips = el('div', { class: 'chips' });
  const modoPreencher = el('button', { type: 'button', class: 'af-chip' }, 'Preencher o papel');
  const modoInteira = el('button', { type: 'button', class: 'af-chip' }, 'Foto inteira');
  const zoom = el('input', { type: 'range', min: '1', max: '3', step: '0.01', class: 'zoom', 'aria-label': 'Zoom' });
  const qtd = passo(foto.copias, 1, E.cfg.maxCopias, (v) => (foto.copias = v));

  function pintar() {
    if (!aberto) return;
    const f = formatoDe(foto);
    const m = ajustarLimites(foto);
    const cs = getComputedStyle(palco);
    const livreW = palco.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const livreH = palco.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (livreW <= 0 || livreH <= 0) return;
    const escala = Math.min(livreW / m.largura, livreH / m.altura);
    const cssW = Math.floor(m.largura * escala);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${Math.floor(m.altura * escala)}px`;
    pintarPrevia(canvas, img, foto, f, bordaDe(foto), Math.min(1800, cssW * (window.devicePixelRatio || 1)));
    canvas.classList.toggle('arrastavel', foto.modo === 'preencher');
    alerta.hidden = dpiEfetivo(foto, f, bordaDe(foto)) >= DPI_MINIMO;
    modoPreencher.setAttribute('aria-pressed', String(foto.modo === 'preencher'));
    modoInteira.setAttribute('aria-pressed', String(foto.modo === 'inteira'));
    zoom.value = String(foto.zoom);
    zoom.disabled = foto.modo === 'inteira';
    botaoPapel.hidden = f.deitadaFixa != null; // a janela do gabarito tem orientação fixa
    modoPreencher.textContent = f.modelo ? 'Preencher a janela' : 'Preencher o papel';
    chipsTamanho(chips, foto.formato, (novo) => {
      foto.formato = novo.id;
      pintar();
    });
  }

  // arrastar com um dedo, pinça com dois
  const dedos = new Map();
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });
  canvas.addEventListener('pointermove', (e) => {
    const antes = dedos.get(e.pointerId);
    if (!antes || foto.modo !== 'preencher') return;
    const agora = { x: e.clientX, y: e.clientY };
    if (dedos.size === 1) {
      const m = moldura(formatoDe(foto), foto, bordaDe(foto));
      const pxMm = canvas.clientWidth / m.largura;
      const [ew, eh] = dimsGiradas(foto.w, foto.h, foto.giro);
      const s = Math.max((m.util[0] * pxMm) / ew, (m.util[1] * pxMm) / eh) * foto.zoom;
      foto.cx -= (agora.x - antes.x) / (s * ew);
      foto.cy -= (agora.y - antes.y) / (s * eh);
    } else if (dedos.size === 2) {
      const outro = [...dedos.entries()].find(([id]) => id !== e.pointerId)[1];
      const d0 = Math.hypot(antes.x - outro.x, antes.y - outro.y);
      const d1 = Math.hypot(agora.x - outro.x, agora.y - outro.y);
      if (d0 > 0) foto.zoom *= d1 / d0;
    }
    dedos.set(e.pointerId, agora);
    pintar();
  });
  for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, (e) => dedos.delete(e.pointerId));

  zoom.addEventListener('input', () => {
    foto.zoom = Number(zoom.value);
    pintar();
  });
  modoPreencher.addEventListener('click', () => {
    foto.modo = 'preencher';
    pintar();
  });
  modoInteira.addEventListener('click', () => {
    foto.modo = 'inteira';
    pintar();
  });

  const botaoPapel = botao('Papel em pé ou deitado', {
    iconeNome: 'trocar',
    onclick: () => {
      foto.paisagem = !ehPaisagem(foto);
      pintar();
    },
  });
  const grupo = (rotulo, ...filhos) => el('div', { class: 'editor-grupo' }, el('span', { class: 'rotulo' }, rotulo), ...filhos);
  const painel = el(
    'div',
    { class: 'editor-painel' },
    el('h2', { class: 't-heading' }, 'Ajustar foto'),
    E.cfg.formatos.length > 1 && grupo(E.cfg.formatos.some((f) => f.modelo) ? 'Tamanho ou produto' : 'Tamanho', chips),
    grupo('Enquadramento', el('div', { class: 'chips' }, modoPreencher, modoInteira)),
    grupo('Zoom', zoom),
    grupo(
      'Posição',
      el(
        'div',
        { class: 'chips' },
        botao('Girar foto', {
          iconeNome: 'girar',
          onclick: () => {
            foto.giro = (foto.giro + 90) % 360;
            foto.paisagem = null;
            foto.cx = foto.cy = 0.5;
            pintar();
          },
        }),
        botaoPapel,
      ),
    ),
    grupo('Cópias', qtd),
    alerta,
    el(
      'div',
      { class: 'modal-acoes' },
      botao('Remover', {
        iconeNome: 'lixo',
        classe: 'btn-lg',
        onclick: () => {
          m.fechar();
          removerFoto(foto);
        },
      }),
      botao('Pronto', { variante: 'primary', iconeNome: 'certo', classe: 'btn-lg', onclick: () => m.fechar() }),
    ),
  );

  const observador = new ResizeObserver(pintar);
  const m = abrirModal(el('div', { class: 'editor' }, palco, painel), {
    classe: 'modal-editor',
    aoFechar: () => {
      aberto = false;
      observador.disconnect();
      img = null;
      if (E.fotos.includes(foto)) {
        ajustarLimites(foto);
        foto.pintarCartao?.();
        montarChipsGerais();
        atualizarResumo();
      }
    },
  });
  observador.observe(palco);
  pintar();
  // troca a miniatura pelo original assim que carregar, para a prévia ficar nítida no zoom
  carregarImagem(urlOriginal(foto))
    .then((original) => {
      if (!aberto) return;
      img = original;
      pintar();
    })
    .catch(() => {});
}

function montarChipsGerais() {
  const ids = new Set(E.fotos.map((f) => f.formato));
  for (const chip of $$('#chips-tamanho .af-chip')) chip.setAttribute('aria-pressed', 'false');
  if (ids.size === 1) {
    const i = E.cfg.formatos.findIndex((f) => f.id === [...ids][0]);
    $$('#chips-tamanho .af-chip')[i]?.setAttribute('aria-pressed', 'true');
  }
}

/* ───────────── etapa 3: revelar ───────────── */

function confirmarPedido() {
  if (!E.fotos.length) return;
  const porFormato = new Map();
  for (const f of E.fotos) {
    const fmt = formatoDe(f);
    const g = porFormato.get(fmt.id) || { fmt, fotos: 0, copias: 0 };
    g.fotos++;
    g.copias += f.copias;
    porFormato.set(fmt.id, g);
  }
  const total = [...porFormato.values()].reduce((s, g) => s + g.copias * g.fmt.preco, 0);
  const comPreco = E.cfg.mostrarPrecos && total > 0;
  const sobras = [];
  const linhas = [...porFormato.values()].map((g) => {
    let quanto = plural(g.copias, 'cópia', 'cópias');
    if (g.fmt.modelo) {
      const porFolha = g.fmt.modelo.janelas.length;
      const folhas = Math.ceil(g.copias / porFolha);
      quanto = `${plural(g.copias, 'unidade', 'unidades')} · ${plural(folhas, 'folha', 'folhas')}`;
      const vazios = folhas * porFolha - g.copias;
      if (vazios) sobras.push(`${g.fmt.nome}: ${plural(vazios, 'espaço fica', 'espaços ficam')} em branco na última folha (cabem ${porFolha} por folha).`);
    }
    return el('tr', {}, el('th', { scope: 'row' }, g.fmt.nome), el('td', {}, quanto), comPreco && el('td', { class: 'num' }, brl(g.copias * g.fmt.preco)));
  });
  const baixas = E.fotos.filter((f) => dpiEfetivo(f, formatoDe(f), bordaDe(f)) < DPI_MINIMO).length;
  const m = abrirModal(
    el(
      'div',
      { class: 'aviso' },
      el('h2', { class: 't-title' }, 'Tudo certo para revelar?'),
      el('table', { class: 'resumo' }, el('tbody', {}, linhas), comPreco && el('tfoot', {}, el('tr', {}, el('th', { scope: 'row' }, 'Total'), el('td', {}), el('td', { class: 'num' }, brl(total))))),
      comPreco && el('p', { class: 'pequeno' }, 'O pagamento é feito no balcão, na retirada.'),
      E.fotos.some((f) => bordaDe(f) > 0) && el('p', { class: 'pequeno' }, 'Fotos com borda branca.'),
      sobras.map((t) => el('p', { class: 'pequeno' }, t)),
      baixas > 0 && el('p', { class: 'editor-alerta' }, icone('alerta'), el('span', {}, `${plural(baixas, 'foto tem', 'fotos têm')} baixa resolução e ${baixas === 1 ? 'pode' : 'podem'} sair sem nitidez.`)),
      el(
        'div',
        { class: 'modal-acoes' },
        botao('Voltar', { classe: 'btn-lg', onclick: () => m.fechar() }),
        botao('Revelar agora', {
          variante: 'primary',
          classe: 'btn-lg',
          iconeNome: 'impressora',
          onclick: () => {
            m.fechar();
            revelar();
          },
        }),
      ),
    ),
    { fecharFora: true },
  );
}

function progresso(fracao, titulo, texto) {
  const pct = Math.round(Math.min(1, Math.max(0, fracao)) * 100);
  $('#imp-barra').setAttribute('aria-valuenow', String(pct));
  $('#imp-barra i').style.width = `${pct}%`;
  if (titulo) $('#imp-titulo').textContent = titulo;
  if (texto != null) $('#imp-texto').textContent = texto;
}

async function revelar() {
  if (E.ocupado || !E.fotos.length) return;
  E.ocupado = true;
  // plano de impressão: cada foto comum é um arquivo; as unidades de cada produto (uma por
  // janela, repetidas conforme as cópias) são agrupadas em folhas do gabarito
  const plano = [];
  const porModelo = new Map();
  for (const f of E.fotos) {
    const fmt = formatoDe(f);
    if (!fmt.modelo) {
      plano.push({ fmt, foto: f });
      continue;
    }
    const lista = porModelo.get(fmt.id) || { fmt, unidades: [] };
    for (let c = 0; c < f.copias; c++) lista.unidades.push(f);
    porModelo.set(fmt.id, lista);
  }
  for (const { fmt, unidades } of porModelo.values()) {
    for (const folha of dividirEmFolhas(unidades, fmt.modelo.janelas.length)) plano.push({ fmt, folha });
  }
  const n = plano.length;
  const pesoPreparo = E.cfg.imprimir ? 0.7 : 1;
  const urls = [];
  irPara('imprimindo');
  progresso(0, 'Preparando suas fotos', 'Só um instante.');
  try {
    const pedido = await api('/api/pedidos', {
      metodo: 'POST',
      corpo: {
        borda: E.borda,
        itens: plano.map((p) => (p.folha ? { modelo: p.fmt.id, unidades: p.folha.length } : { formato: p.fmt.id, copias: p.foto.copias, nome: p.foto.nome })),
      },
    });
    const grupos = new Map();
    const mascaras = new Map();
    for (const [i, p] of plano.entries()) {
      progresso((i / n) * pesoPreparo, null, `${p.folha ? 'Folha' : 'Foto'} ${i + 1} de ${n}`);
      let blob;
      let papel = p.fmt;
      let vezes = 1;
      if (p.folha) {
        const modelo = p.fmt.modelo;
        if (!mascaras.has(modelo.id)) mascaras.set(modelo.id, await carregarImagem(`/modelos/${modelo.arquivo}`));
        const originais = new Map(); // a mesma foto pode ocupar as duas janelas
        const unidades = [];
        for (const f of p.folha) {
          if (!originais.has(f.id)) originais.set(f.id, await carregarImagem(urlOriginal(f)));
          unidades.push({ img: originais.get(f.id), foto: f });
        }
        blob = await renderizarFolha(modelo, mascaras.get(modelo.id), unidades, E.cfg.dpi);
        for (const img of originais.values()) img.src = '';
        papel = { id: modelo.id, largura: modelo.papel.largura, altura: modelo.papel.altura };
      } else {
        let original = await carregarImagem(urlOriginal(p.foto));
        blob = await renderizarImpressao(original, p.foto, p.fmt, bordaDe(p.foto), E.cfg.dpi);
        original.src = '';
        original = null;
        vezes = p.foto.copias;
      }
      await api(`/api/pedidos/${pedido.id}/itens/${i + 1}`, { metodo: 'PUT', bruto: blob });
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const g = grupos.get(papel.id) || { formato: papel, folhas: [] };
      for (let c = 0; c < vezes; c++) g.folhas.push(url);
      grupos.set(papel.id, g);
      tocou();
    }
    let via = '';
    if (E.cfg.imprimir) {
      progresso(pesoPreparo, 'Revelando suas fotos', 'Enviando para a impressora.');
      const r = await imprimirPedido({
        pedidoId: pedido.id,
        grupos: [...grupos.values()],
        modo: E.cfg.modoImpressao,
        progresso: (feitas, total) => {
          progresso(pesoPreparo + (feitas / total) * (1 - pesoPreparo), null, `${feitas} de ${plural(total, 'cópia', 'cópias')}`);
          tocou();
        },
      });
      via = r.via;
    }
    await api(`/api/pedidos/${pedido.id}/concluir`, { metodo: 'POST', corpo: { impresso: E.cfg.imprimir, via } }).catch(() => {});
    progresso(1);
    mostrarPronto(pedido);
  } catch (e) {
    E.ocupado = false;
    irPara('pedido');
    aviso('Não consegui revelar', `${e.message} Suas fotos continuam aqui.`, [
      ['Voltar', null],
      ['Tentar de novo', revelar],
    ]);
  } finally {
    for (const u of urls) URL.revokeObjectURL(u);
  }
}

function mostrarPronto(pedido) {
  const antiga = E.sessao;
  E.sessao = null; // encerra a sondagem; as fotos do cliente são apagadas agora
  E.fotos = [];
  E.ocupado = false;
  if (antiga) api(`/api/sessoes/${antiga.id}`, { metodo: 'DELETE' }).catch(() => {});
  $('#pronto-numero').textContent = String(pedido.numero).padStart(4, '0');
  $('#pronto-texto').textContent = E.cfg.mensagemFinal;
  const balcao = $('#pronto-balcao');
  balcao.hidden = !(E.cfg.mostrarPrecos && pedido.total > 0);
  balcao.textContent = balcao.hidden ? '' : `Total ${brl(pedido.total)} — pague no balcão.`;
  irPara('pronto');
  let resta = 30;
  const tique = () => {
    if (E.tela !== 'pronto') return;
    $('#pronto-volta').textContent = `Esta tela volta ao início em ${resta} s.`;
    if (resta-- <= 0) return reiniciar();
    reiniciar.volta = setTimeout(tique, 1000);
  };
  tique();
}

/* ───────────── ociosidade ───────────── */

let perguntaAberta = null;
setInterval(() => {
  if (!E.cfg || perguntaAberta || E.ocupado) return;
  if (E.tela !== 'fotos' && E.tela !== 'pedido') return;
  if (Date.now() - E.ultimoToque < E.cfg.ociosoSeg * 1000) return;
  let resta = 20;
  const conta = el('strong', {}, String(resta));
  const fim = () => {
    clearInterval(relogio);
    perguntaAberta = null;
  };
  const m = abrirModal(
    el(
      'div',
      { class: 'aviso' },
      el('h2', { class: 't-title' }, 'Você ainda está aí?'),
      el('p', { class: 't-lead' }, 'Por segurança, suas fotos serão apagadas em ', conta, ' segundos.'),
      el(
        'div',
        { class: 'modal-acoes' },
        botao('Encerrar', {
          classe: 'btn-lg',
          onclick: () => {
            fim();
            reiniciar();
          },
        }),
        botao('Continuar aqui', {
          variante: 'primary',
          classe: 'btn-lg',
          onclick: () => {
            fim();
            m.fechar();
            tocou();
          },
        }),
      ),
    ),
  );
  perguntaAberta = m;
  const relogio = setInterval(() => {
    conta.textContent = String(--resta);
    if (resta <= 0) {
      fim();
      reiniciar();
    }
  }, 1000);
}, 1000);

/* ───────────── eventos ───────────── */

aplicarIcones();
$('.tela.inicio').addEventListener('click', comecar);
$('#cancelar').addEventListener('click', () => {
  if (!E.fotos.length) return reiniciar();
  aviso('Recomeçar do zero?', 'As fotos enviadas serão apagadas do totem.', [
    ['Continuar aqui', null],
    ['Recomeçar', reiniciar],
  ]);
});
$('#continuar').addEventListener('click', () => {
  montarPedido();
  irPara('pedido');
});
$('#mais-fotos').addEventListener('click', () => irPara('fotos'));
$('#revelar').addEventListener('click', confirmarPedido);
$('#novo').addEventListener('click', reiniciar);
$('#borda').addEventListener('change', (e) => {
  E.borda = e.target.checked;
  for (const f of E.fotos) {
    ajustarLimites(f);
    f.pintarCartao?.();
  }
});
$('#arquivo').addEventListener('change', (e) => {
  const arquivos = [...e.target.files];
  e.target.value = '';
  lerPendrive(arquivos);
});

// cinco toques seguidos no logo abrem o painel do lojista
let toquesLogo = [];
for (const logo of $$('.topo-logo, .inicio-logo')) {
  logo.addEventListener('click', (e) => {
    e.stopPropagation();
    const agora = Date.now();
    toquesLogo = [...toquesLogo.filter((t) => agora - t < 3000), agora];
    if (toquesLogo.length >= 5) location.href = '/admin';
  });
}

for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, tocou, { passive: true });
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('dragstart', (e) => e.preventDefault());

carregarConfig()
  .then(() => irPara('inicio'))
  .catch(() => aviso('O totem não respondeu', 'Confira se o servidor está aberto e toque para tentar de novo.', [['Tentar de novo', () => location.reload()]]));
