// Servidor local / hospedagem tradicional (Render etc.): API + arquivos do app.
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app as api } from "./app.js";

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const server = express();
server.use(api);
server.use(express.static(dist));
server.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));

const port = Number(process.env.PORT ?? 3002);
server.listen(port, () => console.log(`Finanças em http://localhost:${port}`));
