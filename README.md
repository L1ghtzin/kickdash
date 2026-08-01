# KickBacks Dashboard (Servidor Central de Telemetria)

Projeto independente para deploy na plataforma **Render.com** (plano gratuito), responsável por receber e exibir estatísticas em tempo real das instâncias do **KickBacks-Bot** (ex: `Light`, `Marcondes`, `Tilt`, `Vhmit`, etc.).

---

## 🚀 Como fazer Deploy no Render.com (Grátis)

1. Acesse o [render.com](https://render.com) e faça login.
2. Clique em **New +** -> **Web Service**.
3. Escolha o seu repositório do GitHub contendo este projeto `KickBacks-Dashboard`.
4. Preencha as configurações:
   - **Environment:** `Node`
   - **Build Command:** `npm install` (ou deixe em branco)
   - **Start Command:** `npm start`
5. Clique em **Create Web Service**.
6. Copie a URL pública gerada (ex: `https://kickbacks-dashboard.onrender.com`).

---

## 🔗 Configuração nos Bots (`KickBacks-Bot`)

Em cada bot da rede, configure o arquivo `.env` com a URL do seu dashboard no Render:

```env
BOT_NAME=Light
DASHBOARD_URL=https://kickbacks-dashboard.onrender.com
```

Exemplo para outros bots:
- `BOT_NAME=Marcondes`
- `BOT_NAME=Tilt`
- `BOT_NAME=Vhmit`

---

## 📡 Endpoints do Servidor

- `GET /` -> Painel web interativo em tempo real (Dark Mode).
- `GET /ping` -> Endpoint leve de health check.
- `POST /api/telemetry` -> Recebe métricas enviadas pelos bots.
- `GET /api/bots` -> Retorna os dados resumidos e individuais dos bots em JSON.
