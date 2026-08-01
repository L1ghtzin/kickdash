import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const OFFLINE_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutos sem sinal = offline

const STORE_FILE = path.join(__dirname, "bots-store.json");
const botsStore = new Map();
const pendingCommands = new Map();

function loadBotsStoreFromDisk() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const content = fs.readFileSync(STORE_FILE, "utf8");
      const list = JSON.parse(content);
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item && item.botName) {
            botsStore.set(item.botName, item);
          }
        }
      }
    }
  } catch (err) {
    console.error("[SERVER] Erro ao carregar bots-store.json:", err);
  }
}

function saveBotsStoreToDisk() {
  try {
    const list = Array.from(botsStore.values());
    fs.writeFileSync(STORE_FILE, JSON.stringify(list, null, 2), "utf8");
  } catch (err) {
    console.error("[SERVER] Erro ao salvar bots-store.json:", err);
  }
}

loadBotsStoreFromDisk();

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-cache, no-store, must-revalidate"
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

process.on("uncaughtException", (err) => {
  console.error("[SERVER] uncaughtException:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[SERVER] unhandledRejection:", reason);
});

const server = http.createServer(async (req, res) => {
  try {
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

    const cleanPath = pathname.toLowerCase().replace(/\/+$/, "") || "/";

    // Tratamento de Favicon
    if (cleanPath === "/favicon.ico") {
      res.writeHead(204, {
        "Content-Type": "image/x-icon",
        "Cache-Control": "public, max-age=86400"
      });
      return res.end();
    }

    // Rota 1: GET /ping
    if (method === "GET" && cleanPath === "/ping") {
      return sendJson(res, 200, {
        status: "ok",
        service: "kickbacks-dashboard",
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
      });
    }

    // Rota: POST /api/admin/command (Solicita ações como update ou login)
    if (method === "POST" && cleanPath === "/api/admin/command") {
      try {
        const data = await parseJsonBody(req);
        const action = data.action; // "update" | "login"
        const targetBot = data.targetBot; // "all" ou botName
        if (!action) return sendJson(res, 400, { error: "Ação é obrigatória." });

        const cmdObj = { id: String(Date.now()), action };

        if (!targetBot || targetBot === "all") {
          pendingCommands.set("ALL", cmdObj);
          for (const [bName, record] of botsStore.entries()) {
            pendingCommands.set(bName, cmdObj);
            record.commandStatus = `Solicitado: ${action}`;
            record.commandMessage = `Aguardando conexão do bot para executar '${action}'...`;
          }
        } else {
          pendingCommands.set(targetBot, cmdObj);
          if (botsStore.has(targetBot)) {
            const record = botsStore.get(targetBot);
            record.commandStatus = `Solicitado: ${action}`;
            record.commandMessage = `Aguardando conexão do bot para executar '${action}'...`;
          }
        }

        return sendJson(res, 200, { status: "success", action, targetBot: targetBot || "all" });
      } catch {
        return sendJson(res, 400, { error: "Erro ao emitir comando admin." });
      }
    }

    // Rota: POST /api/telemetry/command-result (Recebe resultado do comando executado pelo bot)
    if (method === "POST" && cleanPath === "/api/telemetry/command-result") {
      try {
        const data = await parseJsonBody(req);
        const { botName, loginUrl, status, message } = data;
        if (botName && botsStore.has(botName)) {
          const record = botsStore.get(botName);
          if (loginUrl !== undefined) record.activeLoginUrl = loginUrl || null;
          if (status !== undefined) record.commandStatus = status || null;
          if (message !== undefined) record.commandMessage = message || null;
          saveBotsStoreToDisk();
        }
        return sendJson(res, 200, { status: "success" });
      } catch {
        return sendJson(res, 400, { error: "Erro ao processar resultado do comando." });
      }
    }

    // Rota 2: POST /api/telemetry (Recebe dados dos bots)
    if (method === "POST" && cleanPath === "/api/telemetry") {
      try {
        const data = await parseJsonBody(req);
        if (!data || typeof data.botName !== "string" || !data.botName.trim()) {
          return sendJson(res, 400, { error: "Campo 'botName' é obrigatório." });
        }

        const botName = data.botName.trim();
        const now = Date.now();
        const existing = botsStore.get(botName) || {};

        const botRecord = {
          botName,
          todayUsd: parseFloat(data.todayUsd) || 0,
          lifetimeUsd: parseFloat(data.lifetimeUsd) || 0,
          hourlyUsd: parseFloat(data.hourlyUsd) || 0,
          isDemo: Boolean(data.isDemo),
          pendingUsd: String(data.pendingUsd || "0.00"),
          persona: data.persona || "desconhecido",
          isNight: Boolean(data.isNight),
          phase: data.phase || "active",
          extVersion: data.extVersion || "2.3.1",
          ccVersion: data.ccVersion || "2.1.220",
          sessionId: data.sessionId || "",
          activeLoginUrl: existing.activeLoginUrl || null,
          commandStatus: existing.commandStatus || null,
          commandMessage: existing.commandMessage || null,
          lastSeenMs: now,
          updatedAt: new Date(now).toISOString()
        };

        botsStore.set(botName, botRecord);
        saveBotsStoreToDisk();

        // Verificar se há comando pendente para este bot
        let pendingCommand = pendingCommands.get(botName);
        if (!pendingCommand && pendingCommands.has("ALL")) {
          pendingCommand = pendingCommands.get("ALL");
        }
        if (pendingCommand) {
          pendingCommands.delete(botName);
        }

        return sendJson(res, 200, {
          status: "success",
          botName,
          timestamp: botRecord.updatedAt,
          pendingCommand: pendingCommand || null
        });
      } catch {
        return sendJson(res, 400, { error: "JSON inválido no corpo da requisição." });
      }
    }

    // Rota 3: GET /api/bots (Retorna a lista agregada de todos os bots)
    if (method === "GET" && cleanPath === "/api/bots") {
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

      const targetBots = Math.max(4, list.length);
      const totalGoalUsd = Math.round(targetBots * 1.00 * 100) / 100;

      return sendJson(res, 200, {
        summary: {
          totalBots: list.length,
          targetBots,
          onlineBots: list.filter(b => b.isOnline).length,
          totalTodayUsd: Math.round(totalToday * 100) / 100,
          totalLifetimeUsd: Math.round(totalLifetime * 100) / 100,
          totalGoalUsd
        },
        bots: list
      });
    }

    // Rota 4: Servir arquivos estáticos do Dashboard (com fallback para index.html)
    let filePath = path.join(__dirname, "public", cleanPath === "/" ? "index.html" : cleanPath);

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      filePath = path.join(__dirname, "public", "index.html");
    }

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

    const contentType = contentTypes[ext] || "text/html; charset=utf-8";
    const content = fs.readFileSync(filePath);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-cache, no-store, must-revalidate"
    });
    return res.end(content);
  } catch (err) {
    console.error("[SERVER ERROR]:", err);
    sendJson(res, 500, { error: "Erro interno no servidor." });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[Dashboard Kickbacks] Servidor HTTP nativo rodando na porta ${PORT}`);
});
