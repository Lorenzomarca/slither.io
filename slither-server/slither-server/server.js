/**
 * SLITHER NEON — Servidor Multiplayer Autoritativo
 * Stack: Node.js + ws + express
 * Roda a lógica do jogo server-side e transmite estado para todos os clientes.
 */

const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const path      = require('path');

// ── Configuração ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const CFG = {
  WORLD_W: 4000, WORLD_H: 4000,
  TICK_RATE: 30,                   // atualizações por segundo (ms = 1000/30 ≈ 33ms)
  INITIAL_FOOD: 1400,
  MIN_FOOD: 1200,
  FOOD_R_MIN: 4, FOOD_R_MAX: 9,
  FOOD_MASS: 1,
  SEGMENT_DIST: 9,
  BASE_SPEED: 3.2,
  BOOST_SPEED: 6.0,
  BOT_SPEED: 2.4,
  BOT_BOOST_SPEED: 4.2,
  BOT_COUNT: 15,
  BOOST_DRAIN_MASS: 0.4,
  BOOST_DRAIN_INTERVAL: 3,
  MIN_BOOST_MASS: 12,
  BASE_RADIUS: 7,
  MAX_RADIUS: 28,
  FOOD_PER_SEG_DEATH: 1,
  BROADCAST_INTERVAL: 2,           // broadcasts a cada N ticks
};

const NEON_COLORS = [
  '#00f5ff','#ff0090','#39ff14','#bf00ff',
  '#ffe600','#ff6a00','#00ff88','#ff3d3d',
  '#5af7ff','#ff77e9','#a3ff00','#ff9d00',
];

const BOT_NAMES = [
  'ShadowSlither','NeonViper','CyberSnek','DarkMatter','GhostWorm',
  'VoidCrawler','NullPointer','PhantomByte','QuantumKink','BitSerpent',
  'HexCrawler','NightShade','RogueWorm','DataSnake','MatrixRider',
  'BinaryBeast','CoreCrawler','SyncSlither','DeltaViper','NeonGhost',
];

// ── Utilitários ──────────────────────────────────────────────────────────────
const rand   = (a, b) => Math.random() * (b - a) + a;
const randi  = (a, b) => Math.floor(rand(a, b));
const clamp  = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const dist2  = (ax, ay, bx, by) => (ax-bx)**2 + (ay-by)**2;
const lerpAng = (a, b, t) => {
  let d = b - a;
  while (d >  Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

let _idCounter = 0;
const newId = () => ++_idCounter;

// ── Classe Worm (servidor) ───────────────────────────────────────────────────
class Worm {
  constructor({ id, name, color, isBot }) {
    this.id      = id;
    this.name    = name;
    this.color   = color;
    this.isBot   = isBot;
    this.alive   = true;
    this.mass    = isBot ? randi(8, 25) : 20;
    this.score   = 0;
    this.boosting= false;
    this.boostTimer = 0;
    this.angle   = rand(0, Math.PI * 2);
    this.targetAngle = this.angle;
    this.radius  = CFG.BASE_RADIUS;
    this.computeRadius();

    // Posição inicial longe dos limites
    const x = rand(200, CFG.WORLD_W - 200);
    const y = rand(200, CFG.WORLD_H - 200);
    this.segs = [];
    for (let i = 0; i < 10; i++) {
      this.segs.push({
        x: x - Math.cos(this.angle) * i * CFG.SEGMENT_DIST,
        y: y - Math.sin(this.angle) * i * CFG.SEGMENT_DIST,
      });
    }

    // Bot AI
    if (isBot) {
      this._noiseV  = rand(0, 100);
      this._noiseSpd= rand(0.003, 0.009);
      this._botTick = 0;
    }
  }

  get head() { return this.segs[0]; }

  computeRadius() {
    this.radius = clamp(CFG.BASE_RADIUS + Math.log(this.mass + 1) * 2.5, CFG.BASE_RADIUS, CFG.MAX_RADIUS);
  }

  addMass(m) {
    this.mass  += m;
    this.score += m;
    this.computeRadius();
    const grow = Math.floor(m * 0.6);
    const tail = this.segs[this.segs.length - 1];
    for (let i = 0; i < grow; i++) this.segs.push({ x: tail.x, y: tail.y });
  }

  move(speed) {
    this.angle = lerpAng(this.angle, this.targetAngle, 0.18);
    const head = this.segs[0];
    const nx = clamp(head.x + Math.cos(this.angle) * speed, this.radius, CFG.WORLD_W - this.radius);
    const ny = clamp(head.y + Math.sin(this.angle) * speed, this.radius, CFG.WORLD_H - this.radius);
    this.segs.unshift({ x: nx, y: ny });
    const desired = 10 + Math.floor(this.mass * 0.5);
    while (this.segs.length > desired) this.segs.pop();
  }

  botThink(foods) {
    this._botTick++;
    const h = this.head;
    const margin = 280;

    // Borda
    if      (h.x < margin)                this.targetAngle = 0;
    else if (h.x > CFG.WORLD_W - margin)  this.targetAngle = Math.PI;
    else if (h.y < margin)                this.targetAngle = Math.PI / 2;
    else if (h.y > CFG.WORLD_H - margin)  this.targetAngle = -Math.PI / 2;
    else {
      // Busca comida a cada 15 ticks
      if (this._botTick % 15 === 0) {
        let best = null, bestD = 200 * 200;
        const samples = Math.min(foods.length, 60);
        for (let i = 0; i < samples; i++) {
          const f = foods[randi(0, foods.length)];
          const d = dist2(h.x, h.y, f.x, f.y);
          if (d < bestD) { bestD = d; best = f; }
        }
        if (best) {
          this.targetAngle = Math.atan2(best.y - h.y, best.x - h.x);
          return;
        }
      }
      // Wander
      this._noiseV += this._noiseSpd;
      const n = Math.sin(this._noiseV)*0.5 + Math.sin(this._noiseV*2.1+1.3)*0.35
              + Math.sin(this._noiseV*0.7+2.7)*0.15;
      this.targetAngle += n * 0.06;
    }
  }

  // Serializa apenas os dados necessários para o cliente
  serialize(partial = false) {
    return {
      id:      this.id,
      name:    this.name,
      color:   this.color,
      alive:   this.alive,
      score:   Math.floor(this.score),
      mass:    Math.floor(this.mass),
      radius:  Math.round(this.radius * 10) / 10,
      angle:   Math.round(this.angle * 1000) / 1000,
      boosting:this.boosting,
      isBot:   this.isBot,
      // Segmentos: reduz precisão para economizar largura de banda
      segs: partial
        ? this.segs.filter((_, i) => i % 2 === 0).map(s => [Math.round(s.x), Math.round(s.y)])
        : this.segs.map(s => [Math.round(s.x), Math.round(s.y)]),
    };
  }
}

// ── Estado do Jogo ───────────────────────────────────────────────────────────
class GameState {
  constructor() {
    this.worms   = new Map(); // id → Worm
    this.foods   = [];
    this.tick    = 0;
    this._initFood();
    this._spawnBots();
  }

  _initFood() {
    for (let i = 0; i < CFG.INITIAL_FOOD; i++) this._addFood();
  }

  _addFood(x, y, r, color, mass) {
    this.foods.push({
      id:    newId(),
      x:     x ?? rand(20, CFG.WORLD_W - 20),
      y:     y ?? rand(20, CFG.WORLD_H - 20),
      r:     r ?? rand(CFG.FOOD_R_MIN, CFG.FOOD_R_MAX),
      color: color ?? NEON_COLORS[randi(0, NEON_COLORS.length)],
      mass:  mass ?? CFG.FOOD_MASS,
    });
  }

  _spawnBots() {
    for (let i = 0; i < CFG.BOT_COUNT; i++) {
      const id  = newId();
      const bot = new Worm({
        id,
        name:  BOT_NAMES[i % BOT_NAMES.length],
        color: NEON_COLORS[randi(0, NEON_COLORS.length)],
        isBot: true,
      });
      this.worms.set(id, bot);
    }
  }

  addPlayer(id, name, color) {
    const w = new Worm({ id, name, color, isBot: false });
    this.worms.set(id, w);
    return w;
  }

  removePlayer(id) {
    const w = this.worms.get(id);
    if (w) { w.alive = false; this._killWorm(w); this.worms.delete(id); }
  }

  _killWorm(worm) {
    worm.alive = false;
    // Vira comida
    for (let i = 0; i < worm.segs.length; i += CFG.FOOD_PER_SEG_DEATH) {
      const s = worm.segs[i];
      this._addFood(s.x + rand(-8,8), s.y + rand(-8,8), rand(6,14), worm.color,
                    Math.max(1, worm.mass / worm.segs.length * 2));
    }
    // Respawn bot
    if (worm.isBot) {
      setTimeout(() => {
        if (!this.worms.has(worm.id)) {
          const bot = new Worm({ id: worm.id, name: worm.name, color: worm.color, isBot: true });
          this.worms.set(bot.id, bot);
        }
      }, 3000);
    }
  }

  _checkFoodCollision(worm) {
    const hx = worm.head.x, hy = worm.head.y;
    const eaten = [];
    for (let i = this.foods.length - 1; i >= 0; i--) {
      const f = this.foods[i];
      const thresh = worm.radius + f.r;
      if (dist2(hx, hy, f.x, f.y) < thresh * thresh) {
        worm.addMass(f.mass);
        eaten.push(f.id);
        this.foods.splice(i, 1);
      }
    }
    return eaten;
  }

  _checkWormCollisions() {
    const dead = [];
    const wormArr = [...this.worms.values()].filter(w => w.alive);

    for (const worm of wormArr) {
      const hx = worm.head.x, hy = worm.head.y;
      for (const other of wormArr) {
        if (other === worm || !other.alive) continue;
        const skipSegs = 4;
        for (let si = skipSegs; si < other.segs.length; si++) {
          const s = other.segs[si];
          const thresh = worm.radius + other.radius * 0.75;
          if (dist2(hx, hy, s.x, s.y) < thresh * thresh) {
            dead.push(worm);
            break;
          }
        }
        if (!worm.alive) break;
      }
    }

    const killed = [];
    for (const w of dead) {
      if (w.alive) {
        this._killWorm(w);
        killed.push(w.id);
      }
    }
    return killed;
  }

  _refillFood() {
    while (this.foods.length < CFG.MIN_FOOD) this._addFood();
  }

  update() {
    this.tick++;
    const eatenIds = [];
    const killedIds = [];

    for (const worm of this.worms.values()) {
      if (!worm.alive) continue;

      if (worm.isBot) {
        worm.botThink(this.foods);
        worm.move(worm.boosting ? CFG.BOT_BOOST_SPEED : CFG.BOT_SPEED);
      } else {
        const speed = worm.boosting ? CFG.BOOST_SPEED : CFG.BASE_SPEED;
        worm.move(speed);

        // Boost drain
        if (worm.boosting && worm.mass > CFG.MIN_BOOST_MASS) {
          worm.boostTimer++;
          if (worm.boostTimer % CFG.BOOST_DRAIN_INTERVAL === 0) {
            worm.mass = Math.max(CFG.MIN_BOOST_MASS, worm.mass - CFG.BOOST_DRAIN_MASS);
            worm.computeRadius();
            const tail = worm.segs[worm.segs.length - 1];
            this._addFood(tail.x + rand(-8,8), tail.y + rand(-8,8), rand(5,10), worm.color, 1.5);
          }
        }
      }

      const ate = this._checkFoodCollision(worm);
      eatenIds.push(...ate);
    }

    const killed = this._checkWormCollisions();
    killedIds.push(...killed);

    this._refillFood();

    return { eatenIds, killedIds };
  }

  leaderboard() {
    return [...this.worms.values()]
      .filter(w => w.alive)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(w => ({ id: w.id, name: w.name, color: w.color, score: Math.floor(w.score) }));
  }

  // Estado completo para novos jogadores
  fullSnapshot() {
    return {
      type: 'snapshot',
      worms: [...this.worms.values()].filter(w => w.alive).map(w => w.serialize()),
      foods: this.foods.map(f => [f.id, Math.round(f.x), Math.round(f.y), Math.round(f.r*10)/10, f.color, f.mass]),
      leaderboard: this.leaderboard(),
    };
  }

  // Delta leve para broadcasts regulares
  deltaSnapshot() {
    return {
      type:  'delta',
      tick:  this.tick,
      worms: [...this.worms.values()].filter(w => w.alive).map(w => w.serialize(true)),
      leaderboard: this.leaderboard(),
    };
  }
}

// ── Servidor HTTP + WebSocket ────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

const state   = new GameState();
const clients = new Map(); // ws → { id, name }

function broadcast(data, skip) {
  const msg = JSON.stringify(data);
  for (const [ws] of clients) {
    if (ws === skip) continue;
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

// Loop do jogo
let broadcastCounter = 0;
const addedFoodBuffer = [];

setInterval(() => {
  const { eatenIds, killedIds } = state.update();

  broadcastCounter++;

  // Comidas novas adicionadas nesse tick para avisar clientes
  // (simplificado: enviamos o snapshot de comida completo junto com o delta periódico)

  if (broadcastCounter >= CFG.BROADCAST_INTERVAL) {
    broadcastCounter = 0;

    const delta = state.deltaSnapshot();

    // Adiciona lista de comida removida e nova para sincronização
    delta.foods = state.foods.map(f => [f.id, Math.round(f.x), Math.round(f.y), Math.round(f.r*10)/10, f.color, f.mass]);
    delta.killedIds = killedIds;

    const msg = JSON.stringify(delta);
    for (const [ws, info] of clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      // Marca o worm do jogador para ele saber qual é o dele
      ws.send(msg);
    }

    // Notifica mortes de jogadores individuais
    for (const deadId of killedIds) {
      for (const [ws, info] of clients) {
        if (info.id === deadId) {
          send(ws, { type: 'you_died', score: Math.floor(state.worms.get(deadId)?.score ?? 0) });
        }
      }
    }
  }
}, Math.floor(1000 / CFG.TICK_RATE));

// Conexões WebSocket
wss.on('connection', (ws) => {
  let playerId = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // ── JOIN ──
    if (msg.type === 'join') {
      playerId = newId();
      const name  = (msg.name  || 'Jogador').slice(0, 20);
      const color = NEON_COLORS[randi(0, NEON_COLORS.length)];

      clients.set(ws, { id: playerId, name });
      state.addPlayer(playerId, name, color);

      // Manda snapshot completo para o novo jogador
      const snap = state.fullSnapshot();
      snap.yourId = playerId;
      send(ws, snap);

      console.log(`[+] ${name} (${playerId}) entrou. Total: ${clients.size}`);
      broadcast({ type: 'player_joined', id: playerId, name, color }, ws);
    }

    // ── INPUT ──
    if (msg.type === 'input' && playerId) {
      const worm = state.worms.get(playerId);
      if (worm && worm.alive) {
        if (typeof msg.angle === 'number') worm.targetAngle = msg.angle;
        worm.boosting = !!msg.boost && worm.mass > CFG.MIN_BOOST_MASS;
      }
    }

    // ── RESPAWN ──
    if (msg.type === 'respawn' && playerId) {
      // Remove o worm morto e cria um novo com o mesmo id
      state.worms.delete(playerId);
      const info  = clients.get(ws);
      const color = NEON_COLORS[randi(0, NEON_COLORS.length)];
      state.addPlayer(playerId, info?.name ?? 'Jogador', color);
      const snap = state.fullSnapshot();
      snap.yourId = playerId;
      send(ws, snap);
    }
  });

  ws.on('close', () => {
    if (playerId) {
      const info = clients.get(ws);
      console.log(`[-] ${info?.name} (${playerId}) saiu.`);
      state.removePlayer(playerId);
      clients.delete(ws);
      broadcast({ type: 'player_left', id: playerId });
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n🐍 SLITHER NEON SERVER rodando em http://localhost:${PORT}`);
  console.log(`   Compartilhe com seus amigos após configurar o ngrok ou deploy!\n`);
});
