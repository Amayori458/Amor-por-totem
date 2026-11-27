#!/usr/bin/env node
// Faz de conta que é o cloudflared: imprime o endereço do túnel como o programa real e fica vivo.
// Usado só nos testes (variável TOTEM_CLOUDFLARED), para não abrir túnel de verdade.
process.stderr.write('2026-01-01T00:00:00Z INF Requesting new quick Tunnel on trycloudflare.com...\n');
setTimeout(() => {
  process.stderr.write('2026-01-01T00:00:01Z INF +--------------------------------------------------------+\n');
  process.stderr.write('2026-01-01T00:00:01Z INF |  https://totem-de-teste.trycloudflare.com               |\n');
  process.stderr.write('2026-01-01T00:00:01Z INF +--------------------------------------------------------+\n');
  process.stderr.write('2026-01-01T00:00:02Z INF Registered tunnel connection connIndex=0\n');
}, 150);
setInterval(() => {}, 1000);
process.on('SIGTERM', () => process.exit(0));
