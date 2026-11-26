/* Painel do lojista: pedidos, configurações e teste de impressão. */
import { $, $$, el, api, brl, plural } from './comum.js';
import { icone, aplicarIcones } from './icones.js';
import { imprimirGrupos, imprimirPedido } from './imprimir.js';

const CHAVE = 'totem-admin';
let token = sessionStorage.getItem(CHAVE) || '';
let dados = null; // resposta de /api/admin/config
let formatoTeste = null;

const adm = (caminho, opts = {}) => api(caminho, { ...opts, cabecalhos: { 'X-Admin': token } });

function botao(rotulo, { variante = '', iconeNome, onclick, ...resto } = {}) {
  return el('button', { type: 'button', class: `af-btn ${variante ? `af-btn-${variante}` : ''}`, onclick, ...resto }, iconeNome && icone(iconeNome), rotulo && el('span', {}, rotulo));
}

function modal(titulo, texto, acoes) {
  const fundo = el('div', { class: 'modal' });
  const fechar = () => fundo.remove();
  fundo.append(
    el(
      'div',
      { class: 'modal-caixa' },
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
              onclick: () => {
                fechar();
                if (fn) fn();
              },
            }),
          ),
        ),
      ),
    ),
  );
  $('#modais').append(fundo);
}

const falhou = (e) => {
  if (e.status === 401) return sair();
  modal('Não deu certo', e.message, [['Entendi', null]]);
};

/* ───────────── PIN ───────────── */

let pin = '';
function desenharPin() {
  $('#pin-pontos').replaceChildren(...[...pin].map(() => el('i')));
}

async function entrar() {
  if (pin.length < 4) return;
  const tentativa = pin;
  pin = '';
  desenharPin();
  try {
    token = (await api('/api/admin/entrar', { metodo: 'POST', corpo: { pin: tentativa } })).token;
    sessionStorage.setItem(CHAVE, token);
    await abrirPainel();
  } catch (e) {
    $('#pin-texto').textContent = e.message;
    $('#pin-texto').classList.add('erro');
  }
}

function montarPin() {
  const tecla = (rotulo, fn, extra = {}) => el('button', { type: 'button', class: 'af-btn', onclick: fn, ...extra }, rotulo);
  const digito = (d) =>
    tecla(String(d), () => {
      if (pin.length < 8) pin += d;
      desenharPin();
    });
  $('#pin-teclas').replaceChildren(
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(digito),
    tecla(icone('apagar'), () => {
      pin = pin.slice(0, -1);
      desenharPin();
    }, { 'aria-label': 'Apagar' }),
    digito(0),
    tecla(icone('certo'), entrar, { class: 'af-btn af-btn-primary', 'aria-label': 'Entrar' }),
  );
  window.addEventListener('keydown', (e) => {
    if (!$('#tela-pin').classList.contains('ativa')) return;
    if (/^\d$/.test(e.key) && pin.length < 8) pin += e.key;
    else if (e.key === 'Backspace') pin = pin.slice(0, -1);
    else if (e.key === 'Enter') return entrar();
    desenharPin();
  });
}

function sair() {
  token = '';
  sessionStorage.removeItem(CHAVE);
  $('#tela-painel').classList.remove('ativa');
  $('#tela-pin').classList.add('ativa');
  $('#pin-texto').textContent = 'Digite o PIN.';
  $('#pin-texto').classList.remove('erro');
}

/* ───────────── painel ───────────── */

async function abrirPainel() {
  dados = await adm('/api/admin/config');
  $('#tela-pin').classList.remove('ativa');
  $('#tela-painel').classList.add('ativa');
  $('#faixa-pin').hidden = !dados.pinPadrao;
  $('#teclado').hidden = dados.plataforma !== 'win32';
  montarForm();
  acompanharTunel();
  montarTeste();
  await carregarPedidos();
  verificar().catch(() => {}); // já deixa a aba Verificação marcada se algo precisar de atenção
}

function trocarAba(nome) {
  for (const b of $$('#abas .af-chip')) b.setAttribute('aria-pressed', String(b.dataset.aba === nome));
  for (const a of $$('.aba')) a.hidden = a.dataset.aba !== nome;
  if (nome === 'pedidos') carregarPedidos().catch(falhou);
  if (nome === 'impressora') carregarImpressoras().catch(falhou);
  if (nome === 'verificacao') verificar().catch(falhou);
}

/* — pedidos — */

const ESTADOS = { impresso: 'Impresso', salvo: 'Salvo na pasta', recebendo: 'Incompleto' };
const dataHora = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

async function carregarPedidos() {
  const { pedidos } = await adm('/api/admin/pedidos');
  const hoje = new Date().toDateString();
  const deHoje = pedidos.filter((p) => new Date(p.criado).toDateString() === hoje && p.status !== 'recebendo');
  const soma = (lista, campo) => lista.reduce((s, p) => s + p[campo], 0);
  const indicador = (rotulo, valor) => el('div', { class: 'indicador' }, el('span', { class: 'rotulo' }, rotulo), el('strong', {}, valor));
  $('#indicadores').replaceChildren(
    ...[
      indicador('Pedidos hoje', String(deHoje.length)),
      indicador('Cópias hoje', String(soma(deHoje, 'totalCopias'))),
      dados.config.mostrarPrecos && indicador('Total hoje', brl(soma(deHoje, 'total'))),
    ].filter(Boolean),
  );
  const tabela = $('#tabela-pedidos');
  if (!pedidos.length) {
    tabela.replaceChildren(el('tbody', {}, el('tr', {}, el('td', { class: 'vazio' }, 'Nenhum pedido ainda. Eles aparecem aqui assim que um cliente revelar.'))));
    return;
  }
  const porTamanho = (p) => {
    const m = new Map();
    for (const i of p.itens) m.set(i.formatoNome, (m.get(i.formatoNome) || 0) + (i.unidades || i.copias));
    return [...m].map(([nome, n]) => `${n}× ${nome}`).join(' · ');
  };
  tabela.replaceChildren(
    el('thead', {}, el('tr', {}, ...['Nº', 'Quando', 'Cópias', 'Total', 'Situação', ''].map((t, i) => el('th', { class: i === 3 ? 'num' : '' }, t)))),
    el(
      'tbody',
      {},
      pedidos.map((p) =>
        el(
          'tr',
          {},
          el('td', {}, el('strong', {}, String(p.numero).padStart(4, '0'))),
          el('td', {}, dataHora(p.criado)),
          el('td', {}, `${porTamanho(p)}${p.borda ? ' · com borda' : ''}`),
          el('td', { class: 'num' }, p.total > 0 ? brl(p.total) : '—'),
          el('td', { class: `estado ${p.status === 'recebendo' ? 'incompleto' : ''}` }, ESTADOS[p.status] || p.status),
          el(
            'td',
            {},
            el(
              'div',
              { class: 'acoes' },
              botao('Reimprimir', { iconeNome: 'impressora', onclick: () => reimprimir(p).catch(falhou) }),
              botao('', { iconeNome: 'pasta', 'aria-label': 'Abrir pasta do pedido', onclick: () => adm('/api/admin/pasta', { metodo: 'POST', corpo: { pedido: p.id } }).catch(falhou) }),
              botao('', {
                iconeNome: 'lixo',
                'aria-label': 'Apagar pedido',
                onclick: () =>
                  modal(`Apagar o pedido ${String(p.numero).padStart(4, '0')}?`, 'Os arquivos das fotos deste pedido serão apagados do totem.', [
                    ['Cancelar', null],
                    ['Apagar', () => adm(`/api/admin/pedidos/${p.id}`, { metodo: 'DELETE' }).then(carregarPedidos).catch(falhou)],
                  ]),
              }),
            ),
          ),
        ),
      ),
    ),
  );
}

async function reimprimir(p) {
  const urls = [];
  if (!p.itens.some((i) => i.recebido)) throw new Error('Este pedido não tem fotos gravadas.');
  // só baixa as fotos para o navegador se a impressão direta pelo Windows não resolver
  const montar = async () => {
    const grupos = new Map();
    for (const item of p.itens.filter((i) => i.recebido)) {
      const resp = await fetch(`/api/admin/pedidos/${p.id}/itens/${item.n}`, { headers: { 'X-Admin': token } });
      if (!resp.ok) throw Object.assign(new Error('Não encontrei os arquivos deste pedido.'), { status: resp.status });
      const url = URL.createObjectURL(await resp.blob());
      urls.push(url);
      const g = grupos.get(item.formato) || { formato: { id: item.formato, largura: item.largura, altura: item.altura }, folhas: [] };
      for (let c = 0; c < item.copias; c++) g.folhas.push(url);
      grupos.set(item.formato, g);
    }
    return [...grupos.values()];
  };
  try {
    await imprimirPedido({ pedidoId: p.id, grupos: montar, modo: dados.config.modoImpressao });
  } finally {
    for (const u of urls) URL.revokeObjectURL(u);
  }
}

/* — configurações — */

function campo(rotulo, entrada, dica) {
  return el('label', { class: 'campo' }, el('span', {}, rotulo), entrada, dica && el('small', {}, dica));
}
const texto = (nome, valor, extra = {}) => el('input', { type: 'text', name: nome, value: valor ?? '', ...extra });
const numero = (nome, valor, extra = {}) => el('input', { type: 'number', name: nome, value: String(valor), inputmode: 'decimal', ...extra });
function chave(nome, rotulo, ligado) {
  return el('label', { class: 'chave' }, el('input', { type: 'checkbox', name: nome, checked: ligado }), el('span', { class: 'chave-trilho', 'aria-hidden': 'true' }), el('span', {}, rotulo));
}

function linhaFormato(f) {
  const tr = el(
    'tr',
    {},
    el('td', {}, el('input', { type: 'checkbox', 'data-f': 'ativo', checked: f.ativo, 'aria-label': 'Ativo' })),
    el('td', {}, el('input', { type: 'text', 'data-f': 'nome', value: f.nome, maxlength: '20', 'aria-label': 'Nome' })),
    el('td', {}, el('input', { type: 'number', 'data-f': 'largura', value: String(f.largura), min: '20', max: '620', step: '0.1', 'aria-label': 'Largura em mm' })),
    el('td', {}, el('input', { type: 'number', 'data-f': 'altura', value: String(f.altura), min: '20', max: '620', step: '0.1', 'aria-label': 'Altura em mm' })),
    el('td', {}, el('input', { type: 'number', 'data-f': 'preco', value: String(f.preco), min: '0', step: '0.01', 'aria-label': 'Preço por cópia' })),
    el('td', {}, botao('', { iconeNome: 'lixo', 'aria-label': 'Remover tamanho', onclick: () => tr.remove() })),
  );
  tr.dataset.id = f.id || '';
  return tr;
}

function montarForm() {
  const c = dados.config;
  const corpo = el('tbody', {}, c.formatos.map(linhaFormato));
  const rede = dados.enderecos.length ? dados.enderecos.map((e) => `${e.url} (${e.nome})`).join(' · ') : 'nenhuma rede encontrada';
  const bloco = (titulo, classe, ...filhos) => el('fieldset', { class: `bloco ${classe}` }, el('legend', {}, titulo), ...filhos);
  $('#form').replaceChildren(
    bloco(
      'Tamanhos de foto',
      'largo',
      el('small', {}, 'Todos os tamanhos vêm ativos. Desative os que o papel carregado na impressora não consegue fazer. O primeiro da lista é o tamanho inicial das fotos. Medidas do papel em milímetros (lado menor primeiro).'),
      el('table', { class: 'formatos', id: 'tabela-formatos' }, el('thead', {}, el('tr', {}, ...['Ativo', 'Nome', 'Largura (mm)', 'Altura (mm)', 'Preço (R$)', ''].map((t) => el('th', {}, t)))), corpo),
      el('div', {}, botao('Adicionar tamanho', { iconeNome: 'mais', onclick: () => corpo.append(linhaFormato({ nome: '', largura: 102, altura: 152, preco: 0, ativo: true })) })),
    ),
    bloco(
      'Produtos com foto',
      'largo',
      el('small', {}, 'Cada foto ocupa uma janela do gabarito e o cliente ajusta a posição e o zoom. Saem 2 por folha de papel 10x15 (rolo de 6"); o preço é por unidade.'),
      el(
        'table',
        { class: 'formatos', id: 'tabela-modelos' },
        el('thead', {}, el('tr', {}, ...['Ativo', 'Nome', 'Janela', 'Preço por unidade (R$)'].map((t) => el('th', {}, t)))),
        el(
          'tbody',
          {},
          (c.modelos || []).map((m) => {
            const mm = m.folha.largura / m.mascara.largura;
            const j = m.janelas[0];
            const cm = (v) => ((v * mm) / 10).toFixed(1).replace('.', ',');
            const medida = `${cm(j.l)} × ${cm(j.a)} cm${j.forma === 'elipse' ? ' (redonda)' : ''}`;
            const tr = el(
              'tr',
              {},
              el('td', {}, el('input', { type: 'checkbox', 'data-m': 'ativo', checked: m.ativo, 'aria-label': 'Ativo' })),
              el('td', {}, el('input', { type: 'text', 'data-m': 'nome', value: m.nome, maxlength: '30', 'aria-label': 'Nome' })),
              el('td', {}, `${m.janelas.length} de ${medida}`),
              el('td', {}, el('input', { type: 'number', 'data-m': 'preco', value: String(m.preco), min: '0', step: '0.01', 'aria-label': 'Preço por unidade' })),
            );
            tr.dataset.id = m.id;
            return tr;
          }),
        ),
      ),
    ),
    bloco(
      'Loja',
      '',
      campo('Nome da loja', texto('loja', c.loja, { maxlength: '60' })),
      campo('Frase da tela inicial', texto('chamada', c.chamada, { maxlength: '80' })),
      campo('Mensagem ao terminar', texto('mensagemFinal', c.mensagemFinal, { maxlength: '160' })),
    ),
    bloco(
      'Pedido',
      '',
      chave('mostrarPrecos', 'Mostrar preços e total (pagamento no balcão)', c.mostrarPrecos),
      el('small', {}, 'O totem nunca cobra. Com esta opção ligada, ele só mostra o total para o cliente pagar no balcão.'),
      el('div', { class: 'dupla' }, campo('Máximo de fotos por pedido', numero('maxFotos', c.maxFotos, { min: '1', max: '500' })), campo('Máximo de cópias por foto', numero('maxCopias', c.maxCopias, { min: '1', max: '99' }))),
      chave('permitirBorda', 'Oferecer borda branca', c.permitirBorda),
      el('div', { class: 'dupla' }, campo('Largura da borda (mm)', numero('bordaMm', c.bordaMm, { min: '0', max: '20', step: '0.5' })), campo('Voltar ao início sem toque (s)', numero('ociosoSeg', c.ociosoSeg, { min: '30', max: '900' }))),
    ),
    bloco(
      'Receber fotos',
      '',
      chave('internet', 'Receber pelo 4G/5G do cliente (sem Wi-Fi da loja)', c.internet),
      el('small', { id: 'estado-tunel' }, textoTunel()),
      campo('Endereço fixo do QR Code (opcional)', texto('enderecoPublico', c.enderecoPublico, { placeholder: 'automático' }), `Só preencha se você tiver um domínio próprio apontando para a porta ${dados.portaInternet} deste computador. Vazio, o totem escolhe sozinho. Rede local encontrada: ${rede}.`),
      el('div', { class: 'dupla' }, campo('Wi-Fi da loja (nome)', texto('wifi.ssid', c.wifi.ssid, { maxlength: '32' })), campo('Senha do Wi-Fi', texto('wifi.senha', c.wifi.senha, { maxlength: '63' }))),
      el('small', {}, 'O Wi-Fi é o plano B: se o totem ficar sem internet, o QR Code passa a usar a rede da loja e um segundo código conecta o celular do cliente a ela.'),
      chave('pendrive', 'Aceitar pendrive ou cartão', c.pendrive),
    ),
    bloco(
      'Impressão',
      '',
      chave('imprimir', 'Imprimir automaticamente ao confirmar', c.imprimir),
      campo(
        'Como imprimir',
        el(
          'select',
          { name: 'modoImpressao' },
          ...[
            ['auto', 'Automático (recomendado)'],
            ['windows', 'Só direto pelo Windows'],
            ['navegador', 'Só pelo navegador'],
          ].map(([valor, rotulo]) => el('option', { value: valor, selected: c.modoImpressao === valor }, rotulo)),
        ),
        'Automático: o totem manda direto para a impressora escolhendo o papel pelo driver; se isso não estiver disponível, imprime pelo navegador na impressora padrão. Troque aqui se um dos dois caminhos não sair bem no teste.',
      ),
      el('small', {}, `Desligado, o totem só grava as fotos prontas na pasta de pedidos (${dados.pastaPedidos}) para você imprimir por outro programa.`),
      el('div', { class: 'dupla' }, campo('Resolução (dpi)', numero('dpi', c.dpi, { min: '150', max: '600' })), campo('Guardar pedidos por (dias)', numero('diasGuardar', c.diasGuardar, { min: '0', max: '365' }), '0 = nunca apagar')),
    ),
    bloco('Segurança', '', campo('Novo PIN do painel', texto('novoPin', '', { inputmode: 'numeric', maxlength: '8', placeholder: 'deixe vazio para manter' }), 'De 4 a 8 números.')),
  );
}

async function salvar() {
  const f = $('#form');
  const v = (nome) => f.elements[nome];
  const novo = {
    loja: v('loja').value,
    chamada: v('chamada').value,
    mensagemFinal: v('mensagemFinal').value,
    mostrarPrecos: v('mostrarPrecos').checked,
    maxFotos: Number(v('maxFotos').value),
    maxCopias: Number(v('maxCopias').value),
    permitirBorda: v('permitirBorda').checked,
    bordaMm: Number(v('bordaMm').value),
    ociosoSeg: Number(v('ociosoSeg').value),
    internet: v('internet').checked,
    enderecoPublico: v('enderecoPublico').value,
    wifi: { ssid: v('wifi.ssid').value, senha: v('wifi.senha').value, tipo: v('wifi.senha').value ? 'WPA' : 'nopass' },
    pendrive: v('pendrive').checked,
    imprimir: v('imprimir').checked,
    modoImpressao: v('modoImpressao').value,
    dpi: Number(v('dpi').value),
    diasGuardar: Number(v('diasGuardar').value),
    modelos: $$('#tabela-modelos tbody tr', f).map((tr) => {
      const c = (n) => $(`[data-m="${n}"]`, tr);
      return { id: tr.dataset.id, nome: c('nome').value, preco: Number(c('preco').value), ativo: c('ativo').checked };
    }),
    formatos: $$('#tabela-formatos tbody tr', f).map((tr) => {
      const c = (n) => $(`[data-f="${n}"]`, tr);
      return { id: tr.dataset.id, nome: c('nome').value, largura: Number(c('largura').value), altura: Number(c('altura').value), preco: Number(c('preco').value), ativo: c('ativo').checked };
    }),
  };
  const novoPin = v('novoPin').value.trim();
  if (novoPin && !/^\d{4,8}$/.test(novoPin)) return modal('PIN inválido', 'O PIN deve ter de 4 a 8 números.', [['Entendi', null]]);
  const resp = await adm('/api/admin/config', { metodo: 'PUT', corpo: novo });
  if (novoPin) {
    await adm('/api/admin/pin', { metodo: 'POST', corpo: { novo: novoPin } });
    dados.pinPadrao = false;
    $('#faixa-pin').hidden = true;
  }
  dados.config = resp.config;
  dados.tunel = resp.tunel;
  montarForm();
  acompanharTunel();
  montarTeste();
  $('#salvo').textContent = `Salvo às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}. Vale a partir do próximo cliente.`;
}

/* — túnel da internet — */

function textoTunel() {
  const t = dados.tunel || { estado: 'desligado' };
  if (dados.config.enderecoPublico) return 'O QR Code usa o endereço fixo informado abaixo.';
  if (!dados.config.internet) return 'Desligado: o celular do cliente precisa estar no Wi-Fi da loja.';
  return {
    ativo: `Funcionando: o QR Code leva para ${t.url}`,
    conectando: 'Conectando à internet… o QR Code usa o Wi-Fi da loja enquanto isso.',
    baixando: 'Baixando o programa do túnel (só na primeira vez)…',
    erro: `Sem conexão no momento (${t.erro}). O totem tenta de novo sozinho e usa o Wi-Fi da loja enquanto isso.`,
    desligado: 'Ligando…',
  }[t.estado];
}

/** Enquanto o túnel está subindo, consulta o estado de novo para atualizar o texto. */
let relogioTunel = null;
function acompanharTunel() {
  clearTimeout(relogioTunel);
  const alvo = $('#estado-tunel');
  if (alvo) alvo.textContent = textoTunel();
  if (!dados.config.internet || dados.tunel?.estado === 'ativo') return;
  relogioTunel = setTimeout(async () => {
    try {
      dados.tunel = (await adm('/api/admin/config')).tunel;
    } catch {
      return;
    }
    acompanharTunel();
  }, 3000);
}

/* — verificação — */

const ROTULO_ESTADO = { ok: 'Certo', aviso: 'Atenção', erro: 'Resolver' };

async function verificar() {
  const alvo = $('#ver-lista');
  $('#ver-resumo').textContent = 'Verificando…';
  $('#ver-resumo').className = 'ver-resumo';
  const r = await adm('/api/admin/diagnostico');
  const erros = r.itens.filter((i) => i.estado === 'erro').length;
  const avisos = r.itens.filter((i) => i.estado === 'aviso').length;
  $('#ver-resumo').textContent = erros
    ? `${plural(erros, 'item precisa', 'itens precisam')} ser resolvido${erros === 1 ? '' : 's'} antes de abrir para os clientes.`
    : avisos
      ? `Pode funcionar, mas ${plural(avisos, 'item merece', 'itens merecem')} sua atenção. Depois, imprima a página de teste e faça um pedido de teste pelo celular.`
      : 'Tudo certo por aqui. Para fechar, imprima a página de teste e faça um pedido de teste pelo celular.';
  $('#ver-resumo').classList.add(erros ? 'erro' : avisos ? 'aviso' : 'ok');
  $('#abas [data-aba="verificacao"]').classList.toggle('pendente', erros > 0);
  alvo.replaceChildren(
    ...r.itens.map((i) =>
      el(
        'li',
        { class: `ver-item ${i.estado}` },
        el('span', { class: 'ver-estado' }, ROTULO_ESTADO[i.estado]),
        el('div', {}, el('strong', {}, i.titulo), el('p', {}, i.texto), i.acao && el('p', { class: 'ver-acao' }, i.acao)),
      ),
    ),
  );
}

/* — impressora — */

function desenharImpressoras(r) {
  const resumo = $('#imp-resumo');
  const lista = $('#imp-lista');
  $('#imp-preferencias').hidden = !r.windows;
  if (!r.windows) {
    resumo.textContent = 'Este computador não é Windows: o totem imprime na impressora padrão do sistema.';
    lista.replaceChildren();
    return;
  }
  if (!r.impressoras.length) {
    resumo.textContent = 'Nenhuma impressora instalada no Windows. Ligue a impressora pelo cabo USB, instale o driver e toque em “Atualizar lista”.';
    lista.replaceChildren();
    return;
  }
  const emUso = r.impressoras.find((i) => i.padrao);
  resumo.textContent = emUso ? `O totem imprime em: ${emUso.nome}.` : 'Nenhuma impressora está como padrão. Toque em “Usar esta” na impressora de fotos.';
  lista.replaceChildren(
    ...r.impressoras.map((i) =>
      el(
        'li',
        { class: i.padrao ? 'em-uso' : '' },
        el(
          'span',
          { class: 'imp-nome' },
          el('strong', {}, i.nome),
          i.desligada ? el('small', { class: 'alerta' }, 'Desligada ou sem cabo') : el('small', {}, i.virtual ? 'Não imprime em papel' : i.driver || 'Pronta'),
        ),
        i.padrao
          ? el('span', { class: 'af-badge af-badge-novo' }, 'Em uso')
          : botao('Usar esta', { variante: i.virtual ? '' : 'primary', onclick: () => adm('/api/admin/impressora', { metodo: 'POST', corpo: { nome: i.nome } }).then(desenharImpressoras).catch(falhou) }),
      ),
    ),
  );
}

const carregarImpressoras = () => adm('/api/admin/impressoras').then(desenharImpressoras);

/* — página de teste — */

function montarTeste() {
  const ativos = dados.config.formatos.filter((f) => f.ativo);
  if (!ativos.some((f) => f.id === formatoTeste)) formatoTeste = ativos[0].id;
  $('#teste-tamanhos').replaceChildren(
    ...ativos.map((f) =>
      el('button', { type: 'button', class: 'af-chip', 'aria-pressed': String(f.id === formatoTeste), onclick: () => { formatoTeste = f.id; montarTeste(); } }, f.nome),
    ),
  );
}

function paginaTeste(f, dpi) {
  const mm = dpi / 25.4;
  const W = Math.round(f.largura * mm);
  const H = Math.round(f.altura * mm);
  const c = el('canvas', { width: String(W), height: String(H) });
  const x = c.getContext('2d');
  x.fillStyle = '#fff';
  x.fillRect(0, 0, W, H);
  // moldura externa rente à borda do papel e moldura de segurança a 5 mm
  x.strokeStyle = '#be202f';
  x.lineWidth = Math.max(2, mm * 0.5);
  x.strokeRect(x.lineWidth / 2, x.lineWidth / 2, W - x.lineWidth, H - x.lineWidth);
  x.strokeStyle = '#16706e';
  x.setLineDash([mm * 2, mm * 2]);
  x.strokeRect(5 * mm, 5 * mm, W - 10 * mm, H - 10 * mm);
  x.setLineDash([]);
  // régua de 10 em 10 mm nas quatro bordas
  x.fillStyle = '#1d2b2a';
  for (let d = 10; d < f.largura; d += 10) { x.fillRect(d * mm, 0, 2, 3 * mm); x.fillRect(d * mm, H - 3 * mm, 2, 3 * mm); }
  for (let d = 10; d < f.altura; d += 10) { x.fillRect(0, d * mm, 3 * mm, 2); x.fillRect(W - 3 * mm, d * mm, 3 * mm, 2); }
  // faixas de cor e degradê
  const cores = ['#43bbb9', '#16706e', '#be202f', '#f2c14e', '#1d2b2a', '#888888', '#ffffff'];
  const fx = 12 * mm, fw = W - 24 * mm, fy = H * 0.56, fh = 14 * mm;
  cores.forEach((cor, i) => { x.fillStyle = cor; x.fillRect(fx + (fw / cores.length) * i, fy, fw / cores.length + 1, fh); });
  const g = x.createLinearGradient(fx, 0, fx + fw, 0);
  g.addColorStop(0, '#000'); g.addColorStop(1, '#fff');
  x.fillStyle = g;
  x.fillRect(fx, fy + fh + 3 * mm, fw, 8 * mm);
  x.strokeStyle = '#1d2b2a'; x.lineWidth = 2;
  x.strokeRect(fx, fy, fw, fh); x.strokeRect(fx, fy + fh + 3 * mm, fw, 8 * mm);
  x.fillStyle = '#1d2b2a';
  x.textAlign = 'center';
  x.font = `600 ${9 * mm}px Fraunces, Georgia, serif`;
  x.fillText(dados.config.loja, W / 2, H * 0.24, W - 24 * mm);
  x.font = `700 ${6.5 * mm}px Figtree, sans-serif`;
  x.fillText(`Teste ${f.nome}`, W / 2, H * 0.34);
  x.font = `400 ${3.6 * mm}px Figtree, sans-serif`;
  x.fillText(`Papel ${f.largura} × ${f.altura} mm · ${dpi} dpi`, W / 2, H * 0.40);
  x.fillText('A linha vermelha deve ficar rente às quatro bordas.', W / 2, H * 0.46, W - 16 * mm);
  x.fillText('A linha tracejada fica a 5 mm da borda.', W / 2, H * 0.50, W - 16 * mm);
  return new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.95));
}

async function imprimirTeste() {
  const f = dados.config.formatos.find((x) => x.id === formatoTeste);
  await document.fonts.ready;
  const folha = await paginaTeste(f, dados.config.dpi);
  const modo = dados.config.modoImpressao;
  let motivo = '';
  if (modo !== 'navegador') {
    const r = await adm(`/api/admin/teste-impressao?formato=${encodeURIComponent(f.id)}`, { metodo: 'POST', bruto: folha });
    if (r.ok) return modal('Teste enviado', `Foi para a impressora ${r.impressora}, no papel “${r.papel}” do driver. Confira se a linha vermelha ficou rente às quatro bordas.`, [['Entendi', null]]);
    if (modo === 'windows' || r.fase === 'impressao') return modal('O teste não saiu', `${r.erro} Veja a aba Verificação.`, [['Entendi', null]]);
    motivo = r.erro;
  }
  const url = URL.createObjectURL(folha);
  try {
    await imprimirGrupos([{ formato: f, folhas: [url] }]);
  } finally {
    URL.revokeObjectURL(url);
  }
  modal('Teste enviado pelo navegador', `${motivo ? `A impressão direta não estava disponível (${motivo}) — ` : ''}o teste foi para a impressora padrão do Windows, no papel definido nas preferências do driver.`, [['Entendi', null]]);
}

/* ───────────── eventos ───────────── */

aplicarIcones();
montarPin();
for (const b of $$('#abas .af-chip')) b.addEventListener('click', () => trocarAba(b.dataset.aba));
$('#atualizar').addEventListener('click', () => carregarPedidos().catch(falhou));
$('#pasta').addEventListener('click', () => adm('/api/admin/pasta', { metodo: 'POST', corpo: {} }).catch(falhou));
$('#salvar').addEventListener('click', () => salvar().catch(falhou));
$('#teste').addEventListener('click', () => imprimirTeste().catch(falhou));
$('#ver-de-novo').addEventListener('click', () => verificar().catch(falhou));
$('#imp-atualizar').addEventListener('click', () => carregarImpressoras().catch(falhou));
$('#imp-preferencias').addEventListener('click', () => adm('/api/admin/impressora/preferencias', { metodo: 'POST' }).catch(falhou));
$('#teclado').addEventListener('click', () => adm('/api/admin/teclado', { metodo: 'POST' }).catch(falhou));
$('#encerrar').addEventListener('click', () =>
  modal('Fechar o totem?', 'O navegador e o servidor serão encerrados. Para abrir de novo, use o atalho “Iniciar-Totem”.', [
    ['Cancelar', null],
    ['Fechar totem', () => adm('/api/admin/encerrar', { metodo: 'POST' }).then(() => document.body.replaceChildren(el('p', { class: 'vazio t-lead' }, 'Totem encerrado. Você já pode fechar esta janela.'))).catch(falhou)],
  ]),
);

if (token) abrirPainel().catch(sair);
