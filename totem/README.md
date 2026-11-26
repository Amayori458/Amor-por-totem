# Totem de revelação — Amor por Fotos

Sistema para totem com monitor touch: o cliente envia as fotos do celular (QR Code, pelo 4G/5G dele — sem precisar do Wi-Fi da loja) ou de um pendrive, escolhe tamanho, cópias e enquadramento, e o totem imprime na hora. **Não tem pagamento**: o totem só revela; se quiser, ele mostra o total para o cliente pagar no balcão.

Roda no Windows, dentro do Chrome ou do Edge em tela cheia, sem `npm install`. O totem precisa estar ligado à internet (cabo ou Wi-Fi) para receber fotos pelo 4G; sem internet ele continua funcionando pelo Wi-Fi da loja e por pendrive.

## Instalar no totem

1. Baixe a pasta `totem` para o computador do totem (por exemplo em `C:\Totem`).
2. Dê dois cliques em **`Iniciar-Teste.bat`**.
   - Na primeira vez o totem baixa sozinho o que falta (o Node.js, se o computador não tiver, e o programa do túnel da internet). Deixe o computador conectado.
   - Se o Windows perguntar sobre o **Firewall**, marque *Redes privadas* e clique em **Permitir** — isso só é usado quando o envio é pelo Wi-Fi da loja.
3. O totem abre em uma janela normal. Toque **5 vezes no logo**, digite o PIN `1234` e abra a aba **Verificação**: ela confere o programa, o navegador, a impressora, o papel de cada tamanho e o envio pelo 4G, e diz em uma frase o que fazer com o que não estiver certo.
4. Com a verificação sem itens em vermelho, imprima a **página de teste** (aba Impressora) e faça **um pedido de teste pelo celular no 4G**. Esses dois testes são a prova de que está tudo funcionando neste computador.
5. Quando estiver tudo certo, use **`Iniciar-Totem.bat`**: abre em tela cheia e imprime direto, sem diálogo.

Para o totem abrir sozinho ao ligar: aperte `Win + R`, digite `shell:startup` e coloque ali um atalho do `Iniciar-Totem.bat`.

## Impressora (Fujifilm ASK-400)

O totem gera cada foto já recortada, em 300 dpi, e tem **dois caminhos de impressão**:

- **Direto pelo Windows** (principal): manda as fotos para a impressora escolhida no painel, usando o papel do driver que tem a medida do tamanho pedido. Se a impressora acusar erro, a tela avisa o cliente.
- **Pelo navegador** (reserva): se o caminho direto não estiver disponível, o navegador imprime na impressora padrão do Windows, no papel definido nas preferências do driver.

Em *Configurações → Impressão → Como imprimir* dá para fixar um dos dois, se no seu teste um sair melhor que o outro.

1. Ligue a ASK-400 pelo cabo USB e instale o driver dela (uma vez só).
2. Abra o totem. **Ele procura a ASK-400 e a define como impressora padrão do Windows sozinho** — na janela preta aparece `[impressora] … definida como padrão do Windows`. Para conferir ou trocar, abra o painel → aba **Impressora**: as impressoras instaladas aparecem em uma lista e basta tocar em **Usar esta**. Na mesma aba, **Papel e margens** abre as preferências do driver: escolha o papel que está carregado (por exemplo `4x6` para 10x15) e deixe **sem margem**.
3. O totem já vem com **todos os tamanhos da ASK-400 ativos**. Cada rolo só faz os tamanhos da sua largura, então no painel, aba **Configurações → Tamanhos de foto**, desative os que o rolo carregado não faz:

   | Rolo | Tamanhos | Medida no totem (mm) |
   | --- | --- | --- |
   | 6" (152 mm) | 10x15 · 15x15 · 15x20 | 102×152 · 152×152 · 152×203 |
   | 5" (127 mm) | 9x13 · 13x13 · 13x18 | 89×127 · 127×127 · 127×178 |

   Se um tamanho ficar ativo sem o papel certo na impressora, a foto sai cortada ou a impressora acusa erro de papel.

4. Na aba **Impressora** do painel, imprima a **página de teste**: a linha vermelha deve ficar rente às quatro bordas. Se cortar ou sobrar margem, ajuste o papel nas preferências do driver.

Se um cliente pedir dois tamanhos no mesmo pedido, o totem manda um trabalho de impressão para cada tamanho. O papel de cada trabalho é o que o driver escolher para aquela medida; com a ASK-400, deixe ativos apenas os tamanhos do rolo que está carregado.

Prefere imprimir por outro programa? Desligue *Imprimir automaticamente* no painel: o totem só grava as fotos prontas em `dados\pedidos\<data>_<número>\`, uma por arquivo, com o tamanho e o número de cópias no nome (`001_10x15_2x.jpg`).

## Produtos com foto: ímã e bolinha de Natal

Além das fotos comuns, o cliente pode escolher dois produtos na mesma lista dos tamanhos:

| Produto | Janela da foto | Por folha 10x15 |
| --- | --- | --- |
| Ímã 6,5x9 | retangular, 65 × 90 mm | 2 |
| Bolinha de Natal | redonda, cerca de 68 mm | 2 |

- **Cada foto ocupa uma janela.** O cliente toca na foto e ajusta a posição (arrastando) e o tamanho (zoom) já no formato da janela — retangular ou redonda.
- **Cópias = unidades.** Para a mesma foto nos dois lados de uma bolinha, basta pedir 2 cópias.
- O totem junta as unidades de 2 em 2 e monta a folha com o gabarito por cima, em tamanho real. Se o número for ímpar, uma janela da última folha sai em branco (a tela avisa antes de revelar).
- Os produtos usam papel 10x15 (rolo de 6"). Nome, preço por unidade e ligar/desligar ficam no painel, em *Configurações → Produtos com foto*.

Os gabaritos vieram dos arquivos do Photoshop (`ima.psd` e `bolinhas_de_natal.psd`) e estão em `public/modelos/` como PNG; as posições das janelas ficam em `server.js` (`PADRAO.modelos`), em pixels da máscara.

## Fotos pelo celular (4G/5G, sem Wi-Fi da loja)

O cliente aponta a câmera para o QR Code e envia as fotos usando a internet do próprio celular. Funciona em iPhone e Android, sem instalar nada.

Como isso funciona: ao abrir, o totem cria um **túnel seguro da Cloudflare** (gratuito, sem cadastro) — um endereço `https://….trycloudflare.com` que leva direto até este computador. O QR Code aponta para esse endereço. Na janela preta do totem aparece `[internet] pronto: https://…` quando está no ar (leva alguns segundos), e o painel mostra o estado em *Configurações → Receber fotos*.

- **Só a página de envio fica na internet.** Painel, pedidos e configurações não respondem por esse endereço — só na tela do próprio totem.
- **As fotos não ficam guardadas na internet**: passam criptografadas pelo túnel e vão direto para o totem, onde são apagadas quando o pedido termina, quando o cliente toca em *Recomeçar* ou depois de um tempo sem toque.
- **Fotos grandes são reduzidas no celular** antes do envio (lado maior de até 3600 px, mais do que o maior papel precisa), para gastar menos dados e chegar mais rápido.
- **Plano B automático**: se o totem ficar sem internet, o QR Code volta a usar a rede local — aí o celular precisa estar no Wi-Fi da loja. Cadastre o Wi-Fi no painel e o totem mostra um segundo QR Code que conecta o cliente à rede. Assim que a internet volta, o QR muda de novo sozinho.
- O endereço do túnel muda cada vez que o totem é aberto; isso não importa, porque o QR Code é gerado na hora.

Esse túnel gratuito é oferecido pela Cloudflare sem garantia de disponibilidade. Se um dia você quiser um endereço fixo e seu (por exemplo `fotos.sualoja.com.br`), crie um túnel com conta na Cloudflare apontando para `http://localhost:3001` e informe o endereço em *Configurações → Endereço fixo do QR Code*.

Para desligar o envio pela internet e usar só o Wi-Fi da loja: painel → *Configurações → Receber fotos*.

## Painel do lojista

Toque **5 vezes seguidas no logo** (ou abra `http://localhost:3000/admin`). O PIN inicial é **1234** — troque em *Configurações → Segurança*.

- **Pedidos**: número, tamanhos, cópias e total de cada pedido; reimprimir; abrir a pasta; apagar.
- **Configurações**: tamanhos e preços, limite de fotos e cópias, borda branca, Wi-Fi, pendrive, textos da tela, PIN.
- **Impressora**: página de teste.
- **Fechar totem**: encerra o navegador e o servidor (sem precisar de teclado).

O painel só abre na tela do próprio totem, nunca pelo celular de um cliente. Para digitar textos sem teclado físico, use o botão **Teclado**.

## Se algo não funcionar

| Sintoma | O que conferir |
| --- | --- |
| O celular lê o QR mas a página não abre | Veja no painel (*Configurações → Receber fotos*) se o envio pela internet está “Funcionando”. Se estiver “Sem conexão”, o totem está sem internet: o QR usa o Wi-Fi da loja e o celular precisa estar nele (e o Firewall do Windows precisa permitir o Node.js em redes privadas). |
| O túnel nunca fica “Funcionando” | Internet do totem; antivírus ou firewall da rede bloqueando o `cloudflared`; apague `runtime\cloudflared.exe` e abra o totem de novo para baixar outra vez. |
| “O totem está sem rede” | O computador não está conectado a nenhuma rede. Conecte à internet e toque em *Recomeçar*. |
| Não imprime | Painel → **Verificação** mostra se a impressora está instalada, ligada e com papel para cada tamanho. Se a página de teste não sair por um caminho, troque em *Configurações → Impressão → Como imprimir* e teste de novo. |
| Sai com margem ou cortado | Papel e “sem margem” nas preferências do driver; medidas do tamanho no painel. |
| Preciso sair da tela cheia | Painel → *Fechar totem*, ou `Alt + F4` com teclado. |

## Para quem for mexer no código

- `server.js` — servidor HTTP em Node puro (sem dependências): sessões de envio, pedidos, painel.
- `public/` — tela do totem (`index.html`), página do celular (`enviar.html`) e painel (`admin.html`), em JavaScript sem etapa de build. Visual conforme o design system Amor por Fotos (`css/tokens.css`).
- `dados/` — criado ao rodar: `config.json`, `pedidos/` e as fotos temporárias. Não vai para o Git.
- Duas portas: `3000` (tela do totem e rede local) e `3001` (só `127.0.0.1`, usada pelo túnel). Tudo que chega pela 3001 é tratado como “de fora” e só alcança a página de envio.
- `imprimir.ps1` faz a impressão direta (System.Drawing.Printing): recebe impressora, medida e lista de arquivos por variáveis de ambiente e responde uma linha JSON; o servidor só cai para o navegador quando a falha é anterior ao envio para a impressora.
- `instalar-tunel.ps1` baixa o `cloudflared` oficial para `runtime/` (conferindo a assinatura digital quando presente). Para atualizar, apague `runtime\cloudflared.exe`.
- `npm test` roda os testes da API (o túnel é simulado por `ferramentas/falso-cloudflared.js`). Variáveis: `TOTEM_PORTA` (padrão 3000), `TOTEM_PORTA_INTERNET`, `TOTEM_DADOS`, `TOTEM_NAVEGADOR` (caminho do Chrome/Edge), `TOTEM_CLOUDFLARED` (caminho do cloudflared).

Fontes Figtree e Fraunces (licença OFL) e `qrcode-generator` (MIT) estão incluídos na pasta para o totem funcionar offline.
