# Totem de revelação — Amor por Fotos

Sistema para totem com monitor touch: o cliente envia as fotos do celular (QR Code, pelo 4G/5G dele — sem precisar do Wi-Fi da loja) ou de um pendrive, escolhe tamanho, cópias e enquadramento, e o totem imprime na hora. **Não tem pagamento**: o totem só revela; se quiser, ele mostra o total para o cliente pagar no balcão.

Roda no Windows, dentro do Chrome ou do Edge em tela cheia, sem `npm install`. O totem precisa estar ligado à internet (cabo ou Wi-Fi) para receber fotos pelo 4G; sem internet ele continua funcionando pelo Wi-Fi da loja e por pendrive.

## Instalar no totem

1. Baixe a pasta `totem` para o computador do totem (por exemplo em `C:\Totem`).
2. Dê dois cliques em **`Iniciar-Teste.bat`**.
   - Na primeira vez o totem baixa sozinho o que falta (o Node.js, se o computador não tiver, e o programa do túnel da internet). Deixe o computador conectado.
   - Se o Windows perguntar sobre o **Firewall**, marque *Redes privadas* e clique em **Permitir** — isso só é usado quando o envio é pelo Wi-Fi da loja.
3. O totem abre em uma janela normal. Faça um pedido de teste: o diálogo de impressão aparece para você conferir impressora e papel.
4. Quando estiver tudo certo, use **`Iniciar-Totem.bat`**: abre em tela cheia e imprime direto, sem diálogo.

Para o totem abrir sozinho ao ligar: aperte `Win + R`, digite `shell:startup` e coloque ali um atalho do `Iniciar-Totem.bat`.

## Impressora (Fujifilm ASK-400)

O totem manda cada foto já recortada, em 300 dpi, para a **impressora padrão do Windows**.

1. Instale o driver da ASK-400 e defina-a como **impressora padrão** (*Configurações → Bluetooth e dispositivos → Impressoras*; desligue “Deixar o Windows gerenciar minha impressora padrão”).
2. Em **Preferências de impressão** do driver, escolha o papel que está carregado (por exemplo `4x6` para 10x15) e deixe **sem margem**.
3. O totem já vem com **todos os tamanhos da ASK-400 ativos**. Cada rolo só faz os tamanhos da sua largura, então no painel, aba **Configurações → Tamanhos de foto**, desative os que o rolo carregado não faz:

   | Rolo | Tamanhos | Medida no totem (mm) |
   | --- | --- | --- |
   | 6" (152 mm) | 10x15 · 15x15 · 15x20 | 102×152 · 152×152 · 152×203 |
   | 5" (127 mm) | 9x13 · 13x13 · 13x18 | 89×127 · 127×127 · 127×178 |

   Se um tamanho ficar ativo sem o papel certo na impressora, a foto sai cortada ou a impressora acusa erro de papel.

4. Na aba **Impressora** do painel, imprima a **página de teste**: a linha vermelha deve ficar rente às quatro bordas. Se cortar ou sobrar margem, ajuste o papel nas preferências do driver.

Se um cliente pedir dois tamanhos no mesmo pedido, o totem manda um trabalho de impressão para cada tamanho. O papel de cada trabalho é o que o driver escolher para aquela medida; com a ASK-400, deixe ativos apenas os tamanhos do rolo que está carregado.

Prefere imprimir por outro programa? Desligue *Imprimir automaticamente* no painel: o totem só grava as fotos prontas em `dados\pedidos\<data>_<número>\`, uma por arquivo, com o tamanho e o número de cópias no nome (`001_10x15_2x.jpg`).

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
| Não imprime | A ASK-400 é a impressora padrão? Abra pelo `Iniciar-Teste.bat` para ver o diálogo de impressão e a mensagem do driver. |
| Sai com margem ou cortado | Papel e “sem margem” nas preferências do driver; medidas do tamanho no painel. |
| Preciso sair da tela cheia | Painel → *Fechar totem*, ou `Alt + F4` com teclado. |

## Para quem for mexer no código

- `server.js` — servidor HTTP em Node puro (sem dependências): sessões de envio, pedidos, painel.
- `public/` — tela do totem (`index.html`), página do celular (`enviar.html`) e painel (`admin.html`), em JavaScript sem etapa de build. Visual conforme o design system Amor por Fotos (`css/tokens.css`).
- `dados/` — criado ao rodar: `config.json`, `pedidos/` e as fotos temporárias. Não vai para o Git.
- Duas portas: `3000` (tela do totem e rede local) e `3001` (só `127.0.0.1`, usada pelo túnel). Tudo que chega pela 3001 é tratado como “de fora” e só alcança a página de envio.
- `instalar-tunel.ps1` baixa o `cloudflared` oficial para `runtime/` (conferindo a assinatura digital quando presente). Para atualizar, apague `runtime\cloudflared.exe`.
- `npm test` roda os testes da API (o túnel é simulado por `ferramentas/falso-cloudflared.js`). Variáveis: `TOTEM_PORTA` (padrão 3000), `TOTEM_PORTA_INTERNET`, `TOTEM_DADOS`, `TOTEM_NAVEGADOR` (caminho do Chrome/Edge), `TOTEM_CLOUDFLARED` (caminho do cloudflared).

Fontes Figtree e Fraunces (licença OFL) e `qrcode-generator` (MIT) estão incluídos na pasta para o totem funcionar offline.
