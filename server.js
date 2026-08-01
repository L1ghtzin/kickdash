import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const OFFLINE_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutos sem sinal = offline

const botsStore = new Map();

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => { body += chunk.toString(); });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const method = req.method.toUpperCase();

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    return res.end();
  }

  // Rota 1: GET /ping (Health check para Render e Uptime Monitors)
  if (method === "GET" && pathname === "/ping") {
    return sendJson(res, 200, {
      status: "ok",
      service: "kickbacks-dashboard",
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    });
  }

  // Rota 2: POST /api/telemetry (Recebe dados dos bots)
  if (method === "POST" && pathname === "/api/telemetry") {
    try {
      const data = await parseJsonBody(req);
      if (!data || typeof data.botName !== "string" || !data.botName.trim()) {
        return sendJson(res, 400, { error: "Campo 'botName' é obrigatório." });
      }

      const botName = data.botName.trim();
      const now = Date.now();

      const botRecord = {
        botName,
        todayUsd: parseFloat(data.todayUsd) || 0,
        lifetimeUsd: parseFloat(data.lifetimeUsd) || 0,
        pendingUsd: String(data.pendingUsd || "0.00"),
        persona: data.persona || "desconhecido",
        isNight: Boolean(data.isNight),
        phase: data.phase || "active",
        extVersion: data.extVersion || "2.3.1",
        ccVersion: data.ccVersion || "2.1.220",
        sessionId: data.sessionId || "",
        lastSeenMs: now,
        updatedAt: new Date(now).toISOString()
      };

      botsStore.set(botName, botRecord);
      return sendJson(res, 200, { status: "success", botName, timestamp: botRecord.updatedAt });
    } catch {
      return sendJson(res, 400, { error: "JSON inválido no corpo da requisição." });
    }
  }

  // Rota 3: GET /api/bots (Retorna a lista agregada de todos os bots)
  if (method === "GET" && pathname === "/api/bots") {
    const now = Date.now();
    const list = [];
    let totalToday = 0;
    let totalLifetime = 0;

    for (const bot of botsStore.values()) {
      const isOnline = (now - bot.lastSeenMs) < OFFLINE_THRESHOLD_MS;
      const botStatus = !isOnline ? "offline" : (bot.isNight ? "night_standby" : "active");
      
      totalToday += bot.todayUsd;
      totalLifetime += bot.lifetimeUsd;

      list.push({
        ...bot,
        isOnline,
        statusLabel: botStatus,
        lastSeenSecondsAgo: Math.floor((now - bot.lastSeenMs) / 1000)
      });
    }

    list.sort((a, b) => a.botName.localeCompare(b.botName));

    return sendJson(res, 200, {
      summary: {
        totalBots: list.length,
        onlineBots: list.filter(b => b.isOnline).length,
        totalTodayUsd: Math.round(totalToday * 100) / 100,
        totalLifetimeUsd: Math.round(totalLifetime * 100) / 100
      },
      bots: list
    });
  }

  // Rota 4: Servir arquivos estáticos do Dashboard (public/index.html)
  let filePath = path.join(__dirname, "public", pathname === "/" ? "index.html" : pathname);
  
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentTypes = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".svg": "image/svg+xml"
    };

    const contentType = contentTypes[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    return fs.createReadStream(filePath).pipe(res);
  }

  sendJson(res, 404, { error: "Rota não encontrada." });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[Dashboard Kickbacks] Servidor HTTP nativo rodando na porta ${PORT}`);
});
