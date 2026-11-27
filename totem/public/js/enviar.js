/* Página do celular: escolhe as fotos e manda para a sessão aberta no totem. */
import { $, el, api, plural, prepararFoto, enviarFoto } from './comum.js';

const sessao = new URLSearchParams(location.search).get('s') || '';
const lista = $('#lista');
const resumo = $('#resumo');
const entrada = $('#arquivo');
const botao = entrada.closest('label');
let enviadas = 0;
let falhas = 0;
let naFila = 0;

function mostrarErro(texto) {
  $('#tela-envio').hidden = true;
  $('#tela-erro').hidden = false;
  if (texto) $('#erro-texto').textContent = texto;
}

function atualizar(mensagem) {
  botao.setAttribute('aria-disabled', String(naFila > 0));
  $('#rotulo-escolher').textContent = enviadas ? 'Enviar mais fotos' : 'Escolher fotos';
  resumo.classList.toggle('erro', !!mensagem);
  if (mensagem) resumo.textContent = mensagem;
  else if (naFila) resumo.textContent = `Enviando… ${plural(naFila, 'foto restante', 'fotos restantes')}. Mantenha esta página aberta.`;
  else if (enviadas) resumo.textContent = `${plural(enviadas, 'foto enviada', 'fotos enviadas')}${falhas ? ` · ${plural(falhas, 'não foi', 'não foram')}` : ''}. Agora é só continuar no totem.`;
  else resumo.textContent = '';
}

async function enviarUma(arquivo) {
  const veu = el('span', { class: 'veu' }, '…');
  const img = el('img', { alt: '' });
  const item = el('li', { class: 'item' }, img, veu);
  lista.prepend(item);
  try {
    const pronta = await prepararFoto(arquivo);
    img.src = pronta.miniUrl;
    await enviarFoto(sessao, arquivo.name || 'foto', pronta, (p) => (veu.textContent = `${Math.round(p * 100)}%`));
    item.classList.add('ok');
    enviadas++;
    return null;
  } catch (e) {
    item.classList.add('falha');
    veu.textContent = e.status === 409 ? 'Limite atingido' : e.status === 404 ? 'Sessão encerrada' : 'Não enviada';
    falhas++;
    return e;
  } finally {
    naFila--;
    atualizar();
  }
}

entrada.addEventListener('change', async () => {
  const arquivos = [...entrada.files];
  entrada.value = '';
  if (!arquivos.length) return;
  naFila += arquivos.length;
  atualizar();
  let parar = null;
  // duas por vez: rápido sem derrubar o Wi-Fi
  const fila = [...arquivos];
  const trabalhador = async () => {
    while (fila.length) {
      const arq = fila.shift();
      if (parar) {
        naFila--;
        continue;
      }
      const e = await enviarUma(arq);
      if (e && (e.status === 409 || e.status === 404)) parar = e;
    }
  };
  await Promise.all([trabalhador(), trabalhador()]);
  if (parar?.status === 404) mostrarErro();
  else atualizar(parar ? parar.message : '');
});

if (!/^[a-f0-9]{24}$/.test(sessao)) mostrarErro('Leia o QR Code na tela do totem para enviar suas fotos.');
else {
  api(`/api/sessoes/${sessao}/info`)
    .then((info) => {
      document.title = `Enviar fotos — ${info.loja}`;
      $('#logo').alt = info.loja;
    })
    .catch((e) => mostrarErro(e.status === 404 ? '' : 'Não consegui falar com o totem. Confira se o celular está no Wi-Fi da loja.'));
}
