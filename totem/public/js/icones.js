/* Ícones no mesmo traço do design system (24x24, linha 1.8, pontas redondas). */
const T = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
const ICONES = {
  mais: `<path d="M12 5v14M5 12h14" ${T} stroke-width="2"/>`,
  menos: `<path d="M5 12h14" ${T} stroke-width="2"/>`,
  fechar: `<path d="M6 6l12 12M18 6L6 18" ${T} stroke-width="2"/>`,
  seta: `<path d="M5 12h14M13 6l6 6-6 6" ${T} stroke-width="2"/>`,
  voltar: `<path d="M19 12H5M11 6l-6 6 6 6" ${T} stroke-width="2"/>`,
  certo: `<path d="M5 12.5l4.5 4.5L19 7.5" ${T} stroke-width="2.2"/>`,
  lixo: `<path d="M4 7h16M9 7V4.5h6V7M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12M10 11v5.5M14 11v5.5" ${T}/>`,
  girar: `<path d="M19.5 12a7.5 7.5 0 1 1-2.6-5.7M19.5 4v4.5H15" ${T}/>`,
  trocar: `<rect x="3.5" y="9" width="11" height="7.5" rx="1.5" ${T}/><rect x="13" y="5" width="7.5" height="14" rx="1.5" ${T} stroke-dasharray="2.4 2.4"/>`,
  usb: `<path d="M12 3v13M12 3l-2.5 2.8M12 3l2.5 2.8M7 9.5v2.3a2 2 0 0 0 2 2h3M17 8v3a2 2 0 0 1-2 2h-3" ${T}/><rect x="15.6" y="5.5" width="2.8" height="2.8" ${T}/><circle cx="7" cy="8.3" r="1.3" ${T}/><circle cx="12" cy="18.5" r="2.4" ${T}/>`,
  celular: `<rect x="7" y="3" width="10" height="18" rx="2.2" ${T}/><path d="M10.5 17.8h3" ${T}/>`,
  impressora: `<path d="M7 8V3.5h10V8M7 17H5a1.5 1.5 0 0 1-1.5-1.5v-6A1.5 1.5 0 0 1 5 8h14a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 19 17h-2M7 13.5h10v7H7z" ${T}/>`,
  alerta: `<path d="M12 4l9 15.5H3zM12 10v4.5M12 17.3v.2" ${T}/>`,
  pasta: `<path d="M3.5 7A1.5 1.5 0 0 1 5 5.5h4.2l2 2.2H19A1.5 1.5 0 0 1 20.5 9.2V17a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17z" ${T}/>`,
  teclado: `<rect x="2.5" y="6" width="19" height="12" rx="2" ${T}/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7.5 14h9" ${T} stroke-width="2"/>`,
  apagar: `<path d="M9 5.5h10A1.5 1.5 0 0 1 20.5 7v10a1.5 1.5 0 0 1-1.5 1.5H9L3.5 12zM11.5 9.5l5 5M16.5 9.5l-5 5" ${T}/>`,
  moldura: `<rect x="3" y="2" width="18" height="20" rx="1.8" ${T} stroke-width="1.3"/><rect x="5.6" y="4.6" width="12.8" height="12" rx=".8" ${T} stroke-width="1.1"/><path d="M6.6 15.2l3.5-4 2.5 2.5 1.5-1.5 3.4 3" ${T} stroke-width="1.1"/><circle cx="15" cy="7.6" r="1.2" fill="currentColor"/>`,
};

export function icone(nome) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', 'icone');
  s.innerHTML = ICONES[nome] || '';
  return s;
}

/** Troca cada <span data-icone="nome"></span> do HTML pelo SVG correspondente. */
export function aplicarIcones(raiz = document) {
  for (const alvo of raiz.querySelectorAll('[data-icone]')) alvo.replaceWith(icone(alvo.dataset.icone));
}
