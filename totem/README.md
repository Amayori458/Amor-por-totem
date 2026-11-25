# Totem de revelação — Amor por Fotos

Sistema para totem com monitor touch: o cliente envia as fotos do celular (QR Code) ou de um pendrive, escolhe tamanho, cópias e enquadramento, e o totem imprime na hora. **Não tem pagamento**: o totem só revela; se quiser, ele mostra o total para o cliente pagar no balcão.

Roda no Windows, dentro do Chrome ou do Edge em tela cheia. Não precisa de internet depois de instalado nem de `npm install`.

## Instalar no totem

1. Baixe a pasta `totem` para o computador do totem (por exemplo em `C:\Totem`).
2. Dê dois cliques em **`Iniciar-Teste.bat`**.
   - Se o computador não tiver o Node.js, o atalho baixa uma cópia só para o totem (precisa de internet nessa primeira vez).
   - Quando o Windows perguntar sobre o **Firewall**, marque *Redes privadas* e clique em **Permitir** — é isso que deixa o celular do cliente enviar as fotos.
3. O totem abre em uma janela normal. Faça um pedido de teste: o diálogo de impressão aparece para você conferir impressora e papel.
4. Quando estiver tudo certo, use **`Iniciar-Totem.bat`**: abre em tela cheia e imprime direto, sem diálogo.

Para o totem abrir sozinho ao ligar: aperte `Win + R`, digite `shell:startup` e coloque ali um atalho do `Iniciar-Totem.bat`.

## Impressora (Fujifilm ASK-400)

O totem manda cada foto já recortada, em 300 dpi, para a **impressora padrão do Windows**.

1. Instale o driver da ASK-400 e defina-a como **impressora padrão** (*Configurações → Bluetooth e dispositivos → Impressoras*; desligue “Deixar o Windows gerenciar minha impressora padrão”).
2. Em **Preferências de impressão** do driver, escolha o papel que está carregado (por exemplo `4x6` para 10x15) e deixe **sem margem**.
3. No painel do totem, aba **Configurações → Tamanhos de foto**, ative só os tamanhos que o rolo carregado faz:

   | Rolo | Tamanhos | Medida no totem (mm) |
   | --- | --- | --- |
   | 6" (152 mm) | 10x15 · 15x15 · 15x20 | 102×152 · 152×152 · 152×203 |
   | 5" (127 mm) | 9x13 · 13x13 · 13x18 | 89×127 · 127×127 · 127×178 |

4. Na aba **Impressora** do painel, imprima a **página de teste**: a linha vermelha deve ficar rente às quatro bordas. Se cortar ou sobrar margem, ajuste o papel nas preferências do driver.

Se um cliente pedir dois tamanhos no mesmo pedido, o totem manda um trabalho de impressão para cada tamanho. O papel de cada trabalho é o que o driver escolher para aquela medida; se a sua impressora só troca de tamanho trocando o rolo, deixe ativo apenas um tamanho.

Prefere imprimir por outro programa? Desligue *Imprimir automaticamente* no painel: o totem só grava as fotos prontas em `dados\pedidos\<data>_<número>\`, uma por arquivo, com o tamanho e o número de cópias no nome (`001_10x15_2x.jpg`).

## Fotos pelo celular

O QR Code leva o celular para um endereço do próprio totem, então **celular e totem precisam estar no mesmo Wi-Fi**. No painel você pode informar o nome e a senha do Wi-Fi da loja: o totem mostra um segundo QR Code que conecta o cliente à rede.

As fotos do cliente ficam só no totem e são apagadas quando o pedido termina, quando ele toca em *Recomeçar* ou depois de um tempo sem toque. iPhone e Android funcionam pela câmera, sem instalar nada.

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
| O celular lê o QR mas a página não abre | Celular no mesmo Wi-Fi do totem; Firewall do Windows permitindo o Node.js em redes privadas; em *Configurações → Receber fotos* veja se o endereço encontrado é o da rede certa. |
| “O totem está sem rede” | O computador não está conectado a nenhuma rede. Conecte ao Wi-Fi e toque em *Recomeçar*. |
| Não imprime | A ASK-400 é a impressora padrão? Abra pelo `Iniciar-Teste.bat` para ver o diálogo de impressão e a mensagem do driver. |
| Sai com margem ou cortado | Papel e “sem margem” nas preferências do driver; medidas do tamanho no painel. |
| Preciso sair da tela cheia | Painel → *Fechar totem*, ou `Alt + F4` com teclado. |

## Para quem for mexer no código

- `server.js` — servidor HTTP em Node puro (sem dependências): sessões de envio, pedidos, painel.
- `public/` — tela do totem (`index.html`), página do celular (`enviar.html`) e painel (`admin.html`), em JavaScript sem etapa de build. Visual conforme o design system Amor por Fotos (`css/tokens.css`).
- `dados/` — criado ao rodar: `config.json`, `pedidos/` e as fotos temporárias. Não vai para o Git.
- `npm test` roda os testes da API. Variáveis: `TOTEM_PORTA` (padrão 3000), `TOTEM_DADOS`, `TOTEM_NAVEGADOR` (caminho do Chrome/Edge).

Fontes Figtree e Fraunces (licença OFL) e `qrcode-generator` (MIT) estão incluídos na pasta para o totem funcionar offline.
