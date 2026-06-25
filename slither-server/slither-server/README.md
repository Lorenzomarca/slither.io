# 🐍 SLITHER NEON — Multiplayer

Clone do Slither.io com servidor Node.js + WebSockets.

---

## Estrutura de arquivos

```
slither-server/
  server.js        ← servidor (roda no seu PC)
  package.json     ← dependências
  public/
    index.html     ← cliente (o jogo que os amigos abrem no browser)
```

---

## Passo a passo para jogar com amigos

### 1. Instalar Node.js
Baixe em https://nodejs.org — versão LTS.

### 2. Instalar dependências
Abra o terminal dentro da pasta `slither-server` e rode:
```bash
npm install
```

### 3. Iniciar o servidor
```bash
node server.js
```
Você verá:
```
🐍 SLITHER NEON SERVER rodando em http://localhost:3000
```

### 4. Jogar localmente (só você)
Abra http://localhost:3000 no navegador.

---

## Para jogar com amigos pela internet

### Opção A — ngrok (teste rápido, gratuito)

1. Baixe em https://ngrok.com e crie conta gratuita
2. Instale e autentique:
   ```bash
   ngrok config add-authtoken SEU_TOKEN_AQUI
   ```
3. Com o servidor rodando, em outro terminal:
   ```bash
   ngrok http 3000
   ```
4. O ngrok gera um link tipo `https://abc123.ngrok-free.app`
5. Mande esse link para seus amigos — eles abrem no browser e jogam!

> O link muda cada vez que você reinicia o ngrok (no plano gratuito).

---

### Opção B — Railway (link permanente, gratuito)

1. Crie conta em https://railway.app
2. Instale o CLI:
   ```bash
   npm install -g @railway/cli
   railway login
   ```
3. Dentro da pasta `slither-server`:
   ```bash
   railway init
   railway up
   ```
4. Railway gera um domínio permanente tipo `slither-neon.up.railway.app`
5. Mande para os amigos — funciona 24/7 sem precisar deixar seu PC ligado!

---

## Para reiniciar o servidor com auto-reload (desenvolvimento)
```bash
node --watch server.js
```

---

## Configurações no server.js

Você pode ajustar no objeto `CFG`:
- `BOT_COUNT` — quantidade de bots (padrão: 15)
- `TICK_RATE` — atualizações por segundo (padrão: 30)
- `WORLD_W/H` — tamanho do mundo (padrão: 4000x4000)
- `BASE_SPEED` / `BOOST_SPEED` — velocidade dos jogadores
