/* Impressão pelo navegador. Com o Chrome/Edge aberto pelo "Iniciar-Totem.bat"
   (--kiosk-printing), window.print() manda direto para a impressora padrão do Windows. */

const LOTE = 25; // folhas por trabalho de impressão

function raiz() {
  let r = document.getElementById('impressao');
  if (!r) {
    r = document.createElement('div');
    r.id = 'impressao';
    document.body.append(r);
  }
  return r;
}

function estiloPagina() {
  let s = document.getElementById('impressao-pagina');
  if (!s) {
    s = document.createElement('style');
    s.id = 'impressao-pagina';
    document.head.append(s);
  }
  return s;
}

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

function mandarImprimir() {
  return new Promise((resolve) => {
    let feito = false;
    const fim = () => {
      if (feito) return;
      feito = true;
      window.removeEventListener('afterprint', fim);
      resolve();
    };
    window.addEventListener('afterprint', fim);
    window.print(); // com diálogo, só retorna quando ele fecha
    setTimeout(fim, 1500);
  });
}

/**
 * @param {Array<{formato:{largura:number, altura:number}, folhas:string[]}>} grupos
 *        Um grupo por tamanho de papel; `folhas` são URLs de imagens já no tamanho final
 *        (repita a URL para imprimir mais de uma cópia).
 * @param {(feitas:number, total:number)=>void} [progresso]
 */
export async function imprimirGrupos(grupos, progresso) {
  const total = grupos.reduce((s, g) => s + g.folhas.length, 0);
  let feitas = 0;
  const r = raiz();
  const estilo = estiloPagina();
  try {
    for (const g of grupos) {
      const { largura, altura } = g.formato;
      estilo.textContent = `@page { size: ${largura}mm ${altura}mm; margin: 0; } @media print { #impressao .folha { width: ${largura}mm; height: ${altura}mm; } }`;
      for (let i = 0; i < g.folhas.length; i += LOTE) {
        const lote = g.folhas.slice(i, i + LOTE);
        const imagens = lote.map((url) => {
          const img = new Image();
          img.src = url;
          const folha = document.createElement('div');
          folha.className = 'folha';
          folha.append(img);
          return { folha, img };
        });
        r.replaceChildren(...imagens.map((x) => x.folha));
        await Promise.all(imagens.map((x) => x.img.decode().catch(() => {})));
        await pausa(60);
        await mandarImprimir();
        feitas += lote.length;
        if (progresso) progresso(feitas, total);
        await pausa(400);
      }
    }
  } finally {
    r.replaceChildren();
  }
}
