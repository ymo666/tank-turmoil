"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Brick,
  Bullet,
  Direction,
  GameState,
  GameStatus,
  HEIGHT,
  POWERUP_INFO,
  PowerUpType,
  TILE,
  Tank,
  WIDTH,
  canMoveTo,
  createGame,
  dirVector,
  rectsOverlap,
  respawnPlayer,
  spawnEnemy,
  spawnExplosion,
  spawnRandomPowerUp,
} from "@/game/engine";

const ENEMY_TOTAL = 8;
const MAX_ENEMIES_ONSCREEN = 4;
const LASER_DURATION = 60 * 8; // 8 秒
const SHIELD_DURATION = 60 * 6; // 6 秒
const RAPID_DURATION = 60 * 8; // 8 秒
const SPEED_DURATION = 60 * 8; // 8 秒
const BASE_SPEED = 2.5;
const POWERUP_DROP_INTERVAL = 60 * 7; // 每约 7 秒尝试掉落一个
const MAX_POWERUPS = 3;

export default function TankGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<GameState>(createGame(1));
  const keysRef = useRef<Set<string>>(new Set());
  const rafRef = useRef<number | null>(null);
  const spawnCounterRef = useRef(0);
  const spawnIndexRef = useRef(0);
  const killsRef = useRef(0);
  const powerUpTimerRef = useRef(0);
  const speedBuffRef = useRef(0);

  const [status, setStatus] = useState<GameStatus>("ready");
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [level, setLevel] = useState(1);
  const [buffs, setBuffs] = useState<{
    laser: number;
    shield: number;
    rapid: number;
    speed: number;
  }>({ laser: 0, shield: 0, rapid: 0, speed: 0 });

  const syncHud = useCallback(() => {
    const s = stateRef.current;
    setScore(s.score);
    setLives(s.lives);
    setLevel(s.level);
    setStatus(s.status);
    // 仅当秒数变化时更新，避免每帧重渲染
    const sec = (f: number) => Math.max(0, Math.ceil(f / 60));
    const next = {
      laser: sec(s.buffs.laser),
      shield: sec(s.buffs.shield),
      rapid: sec(s.buffs.rapid),
      speed: sec(speedBuffRef.current),
    };
    setBuffs((prev) =>
      prev.laser === next.laser &&
      prev.shield === next.shield &&
      prev.rapid === next.rapid &&
      prev.speed === next.speed
        ? prev
        : next
    );
  }, []);

  const startGame = useCallback(
    (lvl = 1) => {
      const g = createGame(lvl);
      g.status = "playing";
      stateRef.current = g;
      spawnCounterRef.current = 0;
      spawnIndexRef.current = 0;
      killsRef.current = 0;
      powerUpTimerRef.current = POWERUP_DROP_INTERVAL;
      speedBuffRef.current = 0;
      syncHud();
    },
    [syncHud]
  );

  const togglePause = useCallback(() => {
    const s = stateRef.current;
    if (s.status === "playing") s.status = "paused";
    else if (s.status === "paused") s.status = "playing";
    syncHud();
  }, [syncHud]);

  // Keyboard input
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (
        [
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          " ",
          "Enter",
        ].includes(e.key)
      ) {
        e.preventDefault();
      }
      if (e.key === "Enter") {
        const s = stateRef.current;
        if (s.status === "ready" || s.status === "won" || s.status === "lost") {
          startGame(s.status === "won" ? s.level + 1 : 1);
          return;
        }
      }
      if (e.key === "p" || e.key === "P") {
        togglePause();
        return;
      }
      keysRef.current.add(e.key);
    };
    const up = (e: KeyboardEvent) => keysRef.current.delete(e.key);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [startGame, togglePause]);

  // Main loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let last = performance.now();

    // 判断一条从 (ox,oy) 沿方向 v 的射线是否穿过矩形
    const beamHitsRect = (
      ox: number,
      oy: number,
      v: { x: number; y: number },
      rx: number,
      ry: number,
      rw: number,
      rh: number
    ): boolean => {
      const steps = 400;
      for (let i = 0; i <= steps; i++) {
        const px = ox + v.x * i * 4;
        const py = oy + v.y * i * 4;
        if (px < 0 || py < 0 || px > WIDTH || py > HEIGHT) return false;
        if (px >= rx && px <= rx + rw && py >= ry && py <= ry + rh) return true;
      }
      return false;
    };

    // 发射激光：从坦克向朝向发射一条贯穿光束，消灭路径上的敌人并打穿砖块
    const fireLaser = (tank: Tank) => {
      const s = stateRef.current;
      const v = dirVector(tank.dir);
      const cx = tank.x + tank.size / 2;
      const cy = tank.y + tank.size / 2;
      const len = 1200;
      const x2 = cx + v.x * len;
      const y2 = cy + v.y * len;
      s.laserBeams.push({ x1: cx, y1: cy, x2, y2, life: 10 });

      // 遍历敌人，判断是否在光束路径上
      const hitEnemies = s.enemies.filter((e) =>
        beamHitsRect(cx, cy, v, e.x, e.y, e.size, e.size)
      );
      for (const e of hitEnemies) {
        spawnExplosion(
          s.particles,
          e.x + e.size / 2,
          e.y + e.size / 2,
          "#ff6b6b",
          16,
          4
        );
        s.enemies = s.enemies.filter((x) => x !== e);
        killsRef.current += 1;
        s.score += 150;
      }

      // 打穿路径上的砖块
      for (const brick of s.bricks) {
        if (brick.destroyed) continue;
        if (beamHitsRect(cx, cy, v, brick.x, brick.y, TILE, TILE)) {
          brick.hp -= 2;
          if (brick.hp <= 0) brick.destroyed = true;
        }
      }
      tank.cooldown = 30;
    };

    const fire = (tank: Tank, owner: "player" | "enemy") => {
      if (tank.cooldown > 0) return;
      const s = stateRef.current;
      const isRapid = owner === "player" && s.buffs.rapid > 0;
      const v = dirVector(tank.dir);
      const cx = tank.x + tank.size / 2 - 3;
      const cy = tank.y + tank.size / 2 - 3;
      s.bullets.push({
        x: cx + v.x * (tank.size / 2),
        y: cy + v.y * (tank.size / 2),
        dir: tank.dir,
        speed: owner === "player" ? 7 : 5,
        owner,
        size: 6,
      });
      tank.cooldown = owner === "player" ? (isRapid ? 6 : 18) : 55;
    };

    const tryMove = (
      tank: Tank,
      dir: Direction,
      distance: number,
      bricks: Brick[],
      others: Tank[]
    ) => {
      tank.dir = dir;
      const v = dirVector(dir);
      const nx = tank.x + v.x * distance;
      const ny = tank.y + v.y * distance;
      // boundary + bricks
      if (!canMoveTo(nx, ny, tank.size, bricks)) return false;
      // avoid overlapping other tanks
      for (const o of others) {
        if (o === tank) continue;
        if (rectsOverlap(nx, ny, tank.size, tank.size, o.x, o.y, o.size, o.size))
          return false;
      }
      tank.x = nx;
      tank.y = ny;
      return true;
    };

    const destroyBrickAt = (bx: number, by: number, size: number) => {
      for (const b of stateRef.current.bricks) {
        if (b.destroyed) continue;
        if (rectsOverlap(bx, by, size, size, b.x, b.y, TILE, TILE)) {
          b.hp -= 1;
          if (b.hp <= 0) b.destroyed = true;
          return true;
        }
      }
      return false;
    };

    // 玩家受伤：有护盾时免伤，否则扣命并重生
    const damagePlayer = () => {
      const s = stateRef.current;
      if (s.buffs.shield > 0) {
        spawnExplosion(
          s.particles,
          s.player.x + s.player.size / 2,
          s.player.y + s.player.size / 2,
          "#4cc9f0",
          10,
          2
        );
        return;
      }
      spawnExplosion(
        s.particles,
        s.player.x + s.player.size / 2,
        s.player.y + s.player.size / 2,
        "#3ba55d",
        18,
        4
      );
      s.lives -= 1;
      s.buffs = { laser: 0, shield: 0, rapid: 0 };
      speedBuffRef.current = 0;
      if (s.lives <= 0) {
        s.status = "lost";
      } else {
        s.player = respawnPlayer(s.player);
      }
    };

    // 应用道具效果
    const applyPowerUp = (type: PowerUpType) => {
      const s = stateRef.current;
      s.score += 50;
      switch (type) {
        case "laser":
          s.buffs.laser = LASER_DURATION;
          break;
        case "shield":
          s.buffs.shield = SHIELD_DURATION;
          break;
        case "rapid":
          s.buffs.rapid = RAPID_DURATION;
          break;
        case "speed":
          speedBuffRef.current = SPEED_DURATION;
          break;
        case "life":
          s.lives += 1;
          break;
        case "mine": {
          // 在玩家身后/当前位置布设地雷
          const v = dirVector(s.player.dir);
          const mx = s.player.x + v.x * -TILE;
          const my = s.player.y + v.y * -TILE;
          s.mines.push({
            x: Math.max(0, Math.min(WIDTH - TILE, mx)),
            y: Math.max(0, Math.min(HEIGHT - TILE, my)),
            size: TILE - 8,
            armTimer: 30,
            owner: "player",
          });
          break;
        }
      }
    };

    // 地雷爆炸：对范围内敌人造成伤害，并破坏周围砖块
    const mineExplode = (cx: number, cy: number) => {
      const s = stateRef.current;
      const radius = TILE * 1.6;
      spawnExplosion(s.particles, cx, cy, "#f4a261", 26, 5);
      spawnExplosion(s.particles, cx, cy, "#ffd166", 16, 3);
      for (const e of s.enemies) {
        const ex = e.x + e.size / 2;
        const ey = e.y + e.size / 2;
        if (Math.hypot(ex - cx, ey - cy) <= radius) {
          e.hp -= 2;
          if (e.hp <= 0) {
            killsRef.current += 1;
            s.score += 120;
          }
        }
      }
      s.enemies = s.enemies.filter((e) => e.hp > 0);
      for (const brick of s.bricks) {
        if (brick.destroyed) continue;
        const bx = brick.x + TILE / 2;
        const by = brick.y + TILE / 2;
        if (Math.hypot(bx - cx, by - cy) <= radius) {
          brick.hp -= 2;
          if (brick.hp <= 0) brick.destroyed = true;
        }
      }
    };

    const update = (dt: number) => {
      const s = stateRef.current;
      if (s.status !== "playing") return;

      const frame = dt / 16.6667;

      // Player input
      const keys = keysRef.current;
      let pdir: Direction | null = null;
      if (keys.has("ArrowUp") || keys.has("w") || keys.has("W")) pdir = "up";
      else if (keys.has("ArrowDown") || keys.has("s") || keys.has("S")) pdir = "down";
      else if (keys.has("ArrowLeft") || keys.has("a") || keys.has("A")) pdir = "left";
      else if (keys.has("ArrowRight") || keys.has("d") || keys.has("D")) pdir = "right";

      const allTanks = [s.player, ...s.enemies];
      if (pdir) {
        s.player.dir = pdir;
        const moveSpeed =
          BASE_SPEED * (speedBuffRef.current > 0 ? 1.6 : 1);
        s.player.speed = moveSpeed;
        tryMove(s.player, pdir, moveSpeed * frame, s.bricks, allTanks);
      }

      // 道具 buff 计时器衰减
      const b = s.buffs;
      if (b.laser > 0) b.laser -= frame;
      if (b.shield > 0) b.shield -= frame;
      if (b.rapid > 0) b.rapid -= frame;
      if (speedBuffRef.current > 0) speedBuffRef.current -= frame;

      // 开火：有激光炮时优先发射激光，否则发射普通子弹（速射时更快）
      const fireKey = keys.has(" ") || keys.has("j") || keys.has("J");
      if (fireKey) {
        if (b.laser > 0) fireLaser(s.player);
        else fire(s.player, "player");
      }

      // Enemy spawn
      const aliveEnemies = s.enemies.length + killsRef.current;
      if (
        s.enemies.length < MAX_ENEMIES_ONSCREEN &&
        aliveEnemies < ENEMY_TOTAL
      ) {
        spawnCounterRef.current -= 1;
        if (spawnCounterRef.current <= 0) {
          s.enemies.push(
            spawnEnemy(s.level, spawnIndexRef.current++, s.enemies)
          );
          spawnCounterRef.current = 90;
        }
      }

      // Enemy AI
      for (const e of s.enemies) {
        e.aiTimer = (e.aiTimer ?? 0) - frame;
        if (e.aiTimer <= 0) {
          const dirs: Direction[] = ["up", "down", "left", "right"];
          // bias toward player
          const dx = s.player.x - e.x;
          const dy = s.player.y - e.y;
          const chase: Direction[] =
            Math.abs(dx) > Math.abs(dy)
              ? dx > 0
                ? ["right", "down", "up", "left"]
                : ["left", "down", "up", "right"]
              : dy > 0
              ? ["down", "right", "left", "up"]
              : ["up", "right", "left", "down"];
          const order = Math.random() < 0.6 ? chase : dirs;
          e.dir = order[Math.floor(Math.random() * order.length)];
          e.aiTimer = 30 + Math.random() * 60;
        }
        const ok = tryMove(e, e.dir, e.speed * frame, s.bricks, allTanks);
        if (!ok) e.aiTimer = 0;
        if (Math.random() < 0.02) fire(e, "enemy");
        if (e.cooldown > 0) e.cooldown -= frame;
      }

      if (s.player.cooldown > 0) s.player.cooldown -= frame;

      // Bullets
      for (const b of s.bullets) {
        const v = dirVector(b.dir);
        b.x += v.x * b.speed * frame;
        b.y += v.y * b.speed * frame;
      }

      // Bullet collisions
      const survivingBullets: Bullet[] = [];
      for (const b of s.bullets) {
        let alive = true;

        if (b.x < 0 || b.y < 0 || b.x > WIDTH || b.y > HEIGHT) {
          alive = false;
        }

        if (alive) {
          for (const brick of s.bricks) {
            if (brick.destroyed) continue;
            if (rectsOverlap(b.x, b.y, b.size, b.size, brick.x, brick.y, TILE, TILE)) {
              brick.hp -= 1;
              if (brick.hp <= 0) brick.destroyed = true;
              alive = false;
              break;
            }
          }
        }

        if (alive && b.owner === "player") {
          for (const e of s.enemies) {
            if (rectsOverlap(b.x, b.y, b.size, b.size, e.x, e.y, e.size, e.size)) {
              e.hp -= 1;
              alive = false;
              if (e.hp <= 0) {
                spawnExplosion(
                  s.particles,
                  e.x + e.size / 2,
                  e.y + e.size / 2,
                  "#ff6b6b",
                  16,
                  4
                );
                s.enemies = s.enemies.filter((x) => x !== e);
                killsRef.current += 1;
                s.score += 100;
                // 击杀后有概率掉落道具
                if (
                  s.powerUps.length < MAX_POWERUPS &&
                  Math.random() < 0.35
                ) {
                  const pu = spawnRandomPowerUp(s.bricks, [
                    s.player,
                    ...s.enemies,
                  ]);
                  if (pu) s.powerUps.push(pu);
                }
              }
              break;
            }
          }
        }

        if (alive && b.owner === "enemy") {
          if (
            rectsOverlap(
              b.x,
              b.y,
              b.size,
              b.size,
              s.player.x,
              s.player.y,
              s.player.size,
              s.player.size
            )
          ) {
            alive = false;
            damagePlayer();
          }
        }

        if (alive) survivingBullets.push(b);
      }
      s.bullets = survivingBullets;

      // Enemy reached player collision
      for (const e of s.enemies) {
        if (
          rectsOverlap(
            e.x,
            e.y,
            e.size,
            e.size,
            s.player.x,
            s.player.y,
            s.player.size,
            s.player.size
          )
        ) {
          spawnExplosion(
            s.particles,
            e.x + e.size / 2,
            e.y + e.size / 2,
            "#ff6b6b",
            14,
            3
          );
          damagePlayer();
          e.hp = 0;
          s.enemies = s.enemies.filter((x) => x !== e);
          break;
        }
      }

      // 玩家与道具碰撞（拾取）
      const remainingPowerUps = [];
      for (const pu of s.powerUps) {
        pu.ttl -= frame;
        pu.bob += 0.08 * frame;
        if (pu.ttl <= 0) continue;
        if (
          rectsOverlap(
            s.player.x,
            s.player.y,
            s.player.size,
            s.player.size,
            pu.x,
            pu.y,
            pu.size,
            pu.size
          )
        ) {
          applyPowerUp(pu.type);
          spawnExplosion(
            s.particles,
            pu.x + pu.size / 2,
            pu.y + pu.size / 2,
            POWERUP_INFO[pu.type].color,
            10,
            2
          );
          continue;
        }
        remainingPowerUps.push(pu);
      }
      s.powerUps = remainingPowerUps;

      // 定期随机掉落道具
      powerUpTimerRef.current -= frame;
      if (powerUpTimerRef.current <= 0) {
        powerUpTimerRef.current =
          POWERUP_DROP_INTERVAL + Math.random() * 120;
        if (s.powerUps.length < MAX_POWERUPS) {
          const pu = spawnRandomPowerUp(s.bricks, [
            s.player,
            ...s.enemies,
          ]);
          if (pu) s.powerUps.push(pu);
        }
      }

      // 地雷引信计时与引爆
      const remainingMines = [];
      for (const m of s.mines) {
        m.armTimer -= frame;
        let exploded = false;
        // 敌方坦克触发地雷
        for (const e of s.enemies) {
          if (
            rectsOverlap(
              e.x,
              e.y,
              e.size,
              e.size,
              m.x,
              m.y,
              m.size,
              m.size
            )
          ) {
            exploded = true;
            break;
          }
        }
        // 敌人子弹也会触发
        if (!exploded) {
          for (const b of s.bullets) {
            if (
              rectsOverlap(b.x, b.y, b.size, b.size, m.x, m.y, m.size, m.size)
            ) {
              exploded = true;
              b.x = -999;
              break;
            }
          }
        }
        if (exploded) {
          mineExplode(m.x + m.size / 2, m.y + m.size / 2);
          continue;
        }
        remainingMines.push(m);
      }
      s.mines = remainingMines;

      // 激光束寿命与粒子更新
      s.laserBeams = s.laserBeams.filter((lb) => {
        lb.life -= frame;
        return lb.life > 0;
      });
      const aliveParticles = [];
      for (const p of s.particles) {
        p.x += p.vx * frame;
        p.y += p.vy * frame;
        p.vy += 0.05 * frame;
        p.vx *= 0.96;
        p.life -= frame;
        if (p.life > 0) aliveParticles.push(p);
      }
      s.particles = aliveParticles;

      // Win condition
      if (killsRef.current >= ENEMY_TOTAL && s.enemies.length === 0) {
        s.status = "won";
      }

      syncHud();
    };

    const drawTank = (t: Tank) => {
      const cx = t.x + t.size / 2;
      const cy = t.y + t.size / 2;
      ctx.save();
      ctx.translate(cx, cy);
      const rot =
        t.dir === "up" ? 0 : t.dir === "right" ? Math.PI / 2 : t.dir === "down" ? Math.PI : -Math.PI / 2;
      ctx.rotate(rot);

      const body = t.isPlayer ? "#3ba55d" : "#c0392b";
      const dark = t.isPlayer ? "#246b3c" : "#7f2218";

      // treads
      ctx.fillStyle = "#222";
      ctx.fillRect(-t.size / 2, -t.size / 2, t.size * 0.25, t.size);
      ctx.fillRect(t.size / 2 - t.size * 0.25, -t.size / 2, t.size * 0.25, t.size);

      // body
      ctx.fillStyle = body;
      ctx.fillRect(-t.size * 0.3, -t.size * 0.4, t.size * 0.6, t.size * 0.8);

      // turret
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.arc(0, 0, t.size * 0.2, 0, Math.PI * 2);
      ctx.fill();

      // barrel
      ctx.fillStyle = "#111";
      ctx.fillRect(-t.size * 0.07, -t.size * 0.6, t.size * 0.14, t.size * 0.5);

      // 激光炮升级时炮管发光
      if (t.isPlayer && stateRef.current.buffs.laser > 0) {
        ctx.fillStyle = "#ff3d81";
        ctx.fillRect(-t.size * 0.09, -t.size * 0.66, t.size * 0.18, t.size * 0.18);
      }

      ctx.restore();

      // 护盾光环
      if (t.isPlayer && stateRef.current.buffs.shield > 0) {
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 150);
        ctx.save();
        ctx.strokeStyle = `rgba(76,201,240,${0.5 + pulse * 0.5})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, t.size * 0.75 + pulse * 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    };

    const render = () => {
      const s = stateRef.current;
      // background
      ctx.fillStyle = "#0b0f14";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      // grid
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 20; i++) {
        ctx.beginPath();
        ctx.moveTo(i * TILE, 0);
        ctx.lineTo(i * TILE, HEIGHT);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i * TILE);
        ctx.lineTo(WIDTH, i * TILE);
        ctx.stroke();
      }

      // bricks
      for (const b of s.bricks) {
        if (b.destroyed) continue;
        ctx.fillStyle = b.hp > 1 ? "#8b5a2b" : "#b3703c";
        ctx.fillRect(b.x + 1, b.y + 1, TILE - 2, TILE - 2);
        ctx.strokeStyle = "rgba(0,0,0,0.4)";
        ctx.strokeRect(b.x + 1, b.y + 1, TILE - 2, TILE - 2);
        // brick pattern
        ctx.strokeStyle = "rgba(0,0,0,0.25)";
        ctx.beginPath();
        ctx.moveTo(b.x + 1, b.y + TILE / 2);
        ctx.lineTo(b.x + TILE - 1, b.y + TILE / 2);
        ctx.stroke();
      }

      // 地雷
      for (const m of s.mines) {
        const cx = m.x + m.size / 2;
        const cy = m.y + m.size / 2;
        const armed = m.armTimer <= 0;
        ctx.save();
        ctx.fillStyle = "#3a2a1a";
        ctx.beginPath();
        ctx.arc(cx, cy, m.size / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = armed ? "#f4a261" : "#7a6a5a";
        ctx.lineWidth = 2;
        ctx.stroke();
        // 引信指示灯闪烁
        if (armed) {
          const blink = Math.sin(performance.now() / 120) > 0;
          ctx.fillStyle = blink ? "#ff3d3d" : "#552222";
          ctx.beginPath();
          ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // 道具
      for (const pu of s.powerUps) {
        const info = POWERUP_INFO[pu.type];
        const bobY = Math.sin(pu.bob) * 2;
        const cx = pu.x + pu.size / 2;
        const cy = pu.y + pu.size / 2 + bobY;
        const blink = pu.ttl < 120 && Math.floor(pu.ttl / 10) % 2 === 0;
        if (blink) continue;
        ctx.save();
        // 发光底
        ctx.shadowColor = info.color;
        ctx.shadowBlur = 12;
        ctx.fillStyle = "rgba(15,20,28,0.9)";
        ctx.strokeStyle = info.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, pu.size / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
        // 图标
        ctx.fillStyle = info.color;
        ctx.font = `bold ${pu.size * 0.7}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(info.icon, cx, cy + 1);
        ctx.restore();
      }

      // 子弹
      for (const b of s.bullets) {
        ctx.fillStyle = b.owner === "player" ? "#ffd166" : "#ff6b6b";
        ctx.beginPath();
        ctx.arc(b.x + b.size / 2, b.y + b.size / 2, b.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // tanks
      for (const e of s.enemies) drawTank(e);
      drawTank(s.player);

      // 粒子
      for (const p of s.particles) {
        const alpha = Math.max(0, p.life / p.maxLife);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // 激光束（绘制在最上层，带辉光）
      for (const lb of s.laserBeams) {
        const alpha = Math.max(0, lb.life / 10);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.shadowColor = "#ff3d81";
        ctx.shadowBlur = 18;
        ctx.strokeStyle = "#ff3d81";
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(lb.x1, lb.y1);
        ctx.lineTo(lb.x2, lb.y2);
        ctx.stroke();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(lb.x1, lb.y1);
        ctx.lineTo(lb.x2, lb.y2);
        ctx.stroke();
        ctx.restore();
      }

      // overlay
      if (s.status !== "playing") {
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.font = "bold 36px sans-serif";
        const title =
          s.status === "ready"
            ? "坦克动荡"
            : s.status === "paused"
            ? "已暂停"
            : s.status === "won"
            ? "胜利!"
            : "游戏结束";
        ctx.fillText(title, WIDTH / 2, HEIGHT / 2 - 20);
        ctx.font = "16px sans-serif";
        const hint =
          s.status === "ready"
            ? "按 Enter 开始"
            : s.status === "paused"
            ? "按 P 继续"
            : "按 Enter 重新开始";
        ctx.fillText(hint, WIDTH / 2, HEIGHT / 2 + 24);
      }
    };

    const loop = (t: number) => {
      const dt = Math.min(t - last, 50);
      last = t;
      update(dt);
      render();
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [syncHud]);

  return (
    <div className="game-wrap">
      <div className="hud">
        <div className="hud-item">
          <span className="label">得分</span>
          <span className="value">{score}</span>
        </div>
        <div className="hud-item">
          <span className="label">生命</span>
          <span className="value">{"❤".repeat(Math.max(lives, 0))}</span>
        </div>
        <div className="hud-item">
          <span className="label">关卡</span>
          <span className="value">{level}</span>
        </div>
        <div className="hud-item">
          <span className="label">状态</span>
          <span className="value">
            {status === "playing"
              ? "进行中"
              : status === "paused"
              ? "暂停"
              : status === "won"
              ? "胜利"
              : status === "lost"
              ? "失败"
              : "准备"}
          </span>
        </div>
      </div>

      <div className="buffbar">
        {buffs.laser > 0 && (
          <span className="buff" style={{ color: POWERUP_INFO.laser.color, borderColor: POWERUP_INFO.laser.color }}>
            {POWERUP_INFO.laser.icon} 激光炮 {buffs.laser}s
          </span>
        )}
        {buffs.shield > 0 && (
          <span className="buff" style={{ color: POWERUP_INFO.shield.color, borderColor: POWERUP_INFO.shield.color }}>
            {POWERUP_INFO.shield.icon} 护盾 {buffs.shield}s
          </span>
        )}
        {buffs.rapid > 0 && (
          <span className="buff" style={{ color: POWERUP_INFO.rapid.color, borderColor: POWERUP_INFO.rapid.color }}>
            {POWERUP_INFO.rapid.icon} 速射 {buffs.rapid}s
          </span>
        )}
        {buffs.speed > 0 && (
          <span className="buff" style={{ color: POWERUP_INFO.speed.color, borderColor: POWERUP_INFO.speed.color }}>
            {POWERUP_INFO.speed.icon} 加速 {buffs.speed}s
          </span>
        )}
      </div>

      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        className="canvas"
      />

      <div className="controls">
        <button
          className="btn primary"
          onClick={() => startGame(1)}
        >
          重新开始
        </button>
        <button className="btn" onClick={togglePause}>
          {status === "paused" ? "继续" : "暂停"}
        </button>
        <div className="tips">
          移动：<b>WASD / 方向键</b> · 开火：<b>空格 / J</b> · 暂停：<b>P</b> · 开始/重开：<b>Enter</b>
        </div>
      </div>

      <div className="legend">
        <span className="legend-title">道具图例</span>
        {(Object.keys(POWERUP_INFO) as PowerUpType[]).map((k) => (
          <span key={k} className="legend-item">
            <i style={{ color: POWERUP_INFO[k].color }}>
              {POWERUP_INFO[k].icon}
            </i>
            <b>{POWERUP_INFO[k].label}</b>
            <em>{POWERUP_INFO[k].desc}</em>
          </span>
        ))}
      </div>
    </div>
  );
}
