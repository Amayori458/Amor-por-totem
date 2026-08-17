# Amor por Fotos — Totem

MVP local para um totem de revelação fotográfica: cria sessão, exibe QR Code, recebe imagens pelo celular, permite selecionar formato, cria o pedido, abre o diálogo de impressão e inclui um painel administrativo.

## Executar em desenvolvimento

```powershell
npm install --ignore-scripts
npm run dev
```

Abra `http://localhost:3000`. Para um celular acessar o QR Code, totem e celular precisam estar na mesma rede; permita as portas 3000 e 3001 no Firewall do Windows quando solicitado.

## Administração

Abra `/#/admin`. O PIN inicial é `1234`; defina a variável de ambiente `ADMIN_PIN` antes de iniciar o servidor para alterá-lo.

## Publicar para QR Code global

O arquivo `render.yaml` configura um Web Service público no Render, incluindo disco persistente para as imagens e pedidos deste MVP. Publique o projeto em um repositório Git, conecte-o ao Render e informe as variáveis secretas `PUBLIC_APP_URL` (o domínio HTTPS final) e `ADMIN_PIN`. Depois de o domínio estar ativo, configure `PUBLIC_APP_URL=https://seu-dominio.com` e reinicie o serviço: os novos QR Codes passarão a abrir em qualquer celular com internet.

O arquivo `.env.example` e `database/schema.sql` já deixam preparado o próximo passo de migração para PostgreSQL e Cloudflare R2/S3. Eles não devem receber credenciais no Git.

## Armazenamento deste MVP

Fotos são guardadas em `uploads/` e sessões, pedidos e configurações em `data/store.json`. Isso elimina a dependência de MySQL e S3 durante a demonstração. Para produção, substitua esse adaptador local por banco e bucket S3, use HTTPS e configure uma estratégia de impressão apropriada à impressora instalada.

## Validação

`node_modules/.bin/tsc.cmd --noEmit` concluiu sem erros neste ambiente. A execução do Vite/esbuild foi bloqueada pelo sandbox do ambiente (`spawn EPERM`), não por um erro de código.
