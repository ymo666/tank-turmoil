export const TILE = 32;
export const COLS = 20;
export const ROWS = 20;
export const WIDTH = COLS * TILE;
export const HEIGHT = ROWS * TILE;

export type Direction = "up" | "down" | "left" | "right";

export interface Vec {
  x: number;
  y: number;
}

export interface Bullet {
  x: number;
  y: number;
  dir: Direction;
  speed: number;
  owner: "player" | "enemy";
  size: number;
}

export interface Tank {
  x: number;
  y: number;
  dir: Direction;
  speed: number;
  size: number;
  cooldown: number;
  hp: number;
  isPlayer: boolean;
  aiTimer?: number;
}

export interface Brick {
  x: number;
  y: number;
  hp: number;
  destroyed: boolean;
}

export type PowerUpType =
  | "laser"
  | "mine"
  | "speed"
  | "shield"
  | "rapid"
  | "life";

export interface PowerUp {
  x: number;
  y: number;
  type: PowerUpType;
  size: number;
  ttl: number; // 剩余存在帧数
  bob: number; // 浮动动画相位
}

export interface Mine {
  x: number;
  y: number;
  size: number;
  armTimer: number; // 布设后短暂延迟才引爆，避免炸自己
  owner: "player" | "enemy";
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export interface PlayerBuffs {
  laser: number; // 激光炮剩余帧数
  shield: number; // 护盾剩余帧数
  rapid: number; // 速射剩余帧数
}

/** 激光束（瞬时，绘制一帧后消失） */
export interface LaserBeam {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  life: number;
}

export type GameStatus = "ready" | "playing" | "paused" | "won" | "lost";

export interface GameState {
  player: Tank;
  enemies: Tank[];
  bullets: Bullet[];
  bricks: Brick[];
  powerUps: PowerUp[];
  mines: Mine[];
  particles: Particle[];
  laserBeams: LaserBeam[];
  buffs: PlayerBuffs;
  status: GameStatus;
  score: number;
  lives: number;
  level: number;
}

export const POWERUP_INFO: Record<
  PowerUpType,
  { label: string; color: string; icon: string; desc: string }
> = {
  laser: { label: "激光炮", color: "#ff3d81", icon: "⚡", desc: "发射贯穿激光" },
  mine: { label: "地雷", color: "#f4a261", icon: "💣", desc: "布设爆炸地雷" },
  speed: { label: "加速", color: "#06d6a0", icon: "⟫", desc: "移动速度提升" },
  shield: { label: "护盾", color: "#4cc9f0", icon: "◈", desc: "免疫伤害" },
  rapid: { label: "速射", color: "#ffd166", icon: "≡", desc: "射速大幅提升" },
  life: { label: "增命", color: "#ef476f", icon: "❤", desc: "生命 +1" },
};

const DIR_VEC: Record<Direction, Vec> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export function dirVector(dir: Direction): Vec {
  return DIR_VEC[dir];
}

export function createBricks(level: number): Brick[] {
  const bricks: Brick[] = [];
  // Border walls made of bricks
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const isBorder = c === 0 || r === 0 || c === COLS - 1 || r === ROWS - 1;
      const isInnerBlock =
        (c % 3 === 0 && r % 3 === 0 && c > 1 && r > 1 && c < COLS - 2 && r < ROWS - 2);
      if (isBorder || isInnerBlock) {
        bricks.push({
          x: c * TILE,
          y: r * TILE,
          hp: isBorder ? 2 : 1,
          destroyed: false,
        });
      }
    }
  }
  return bricks;
}

export function createPlayer(): Tank {
  return {
    x: (COLS / 2 - 1) * TILE,
    y: (ROWS - 3) * TILE,
    dir: "up",
    speed: 2.5,
    size: TILE - 4,
    cooldown: 0,
    hp: 1,
    isPlayer: true,
  };
}

export function respawnPlayer(old: Tank): Tank {
  const p = createPlayer();
  p.x = old.x;
  p.y = old.y;
  return p;
}

export function spawnEnemy(level: number, index: number, existing: Tank[]): Tank {
  const spawnPoints: Vec[] = [
    { x: TILE, y: TILE },
    { x: (COLS / 2 - 1) * TILE, y: TILE },
    { x: (COLS - 2) * TILE, y: TILE },
  ];
  const size = TILE - 4;
  const idx =
    ((Math.trunc(index) % spawnPoints.length) + spawnPoints.length) %
    spawnPoints.length;

  // 选择一个未被其他坦克占用的出生点
  const occupied = (p: Vec) =>
    existing.some(
      (t) =>
        rectsOverlap(p.x, p.y, size, size, t.x, t.y, t.size, t.size)
    );

  let p = spawnPoints[idx];
  if (occupied(p)) {
    const free = spawnPoints.find((sp) => !occupied(sp));
    if (free) p = free;
  }

  return {
    x: p.x,
    y: p.y,
    dir: "down",
    speed: 1.2 + level * 0.15,
    size,
    cooldown: Math.random() * 60,
    hp: 1,
    isPlayer: false,
    aiTimer: 0,
  };
}

export function createGame(level: number = 1): GameState {
  return {
    player: createPlayer(),
    enemies: [],
    bullets: [],
    bricks: createBricks(level),
    powerUps: [],
    mines: [],
    particles: [],
    laserBeams: [],
    buffs: { laser: 0, shield: 0, rapid: 0 },
    status: "ready",
    score: 0,
    lives: 3,
    level,
  };
}

const POWERUP_TYPES: PowerUpType[] = [
  "laser",
  "mine",
  "speed",
  "shield",
  "rapid",
  "life",
];

/** 在随机空闲位置生成一个随机道具 */
export function spawnRandomPowerUp(
  bricks: Brick[],
  tanks: Tank[]
): PowerUp | null {
  const size = TILE - 6;
  for (let attempt = 0; attempt < 40; attempt++) {
    const x = TILE + Math.floor(Math.random() * (COLS - 3)) * TILE;
    const y = TILE + Math.floor(Math.random() * (ROWS - 4)) * TILE;
    // 不能落在砖块上
    let blocked = false;
    for (const b of bricks) {
      if (b.destroyed) continue;
      if (rectsOverlap(x, y, size, size, b.x, b.y, TILE, TILE)) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;
    // 不能与坦克重叠
    for (const t of tanks) {
      if (rectsOverlap(x, y, size, size, t.x, t.y, t.size, t.size)) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;

    const type =
      POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
    return {
      x,
      y,
      type,
      size,
      ttl: 60 * 12, // 约 12 秒
      bob: Math.random() * Math.PI * 2,
    };
  }
  return null;
}

/** 生成爆炸粒子 */
export function spawnExplosion(
  particles: Particle[],
  cx: number,
  cy: number,
  color: string,
  count: number = 14,
  power: number = 3
): void {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = Math.random() * power + 0.5;
    const life = 20 + Math.random() * 20;
    particles.push({
      x: cx,
      y: cy,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life,
      maxLife: life,
      color,
      size: 1.5 + Math.random() * 2.5,
    });
  }
}

export function rectsOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

export function canMoveTo(
  x: number,
  y: number,
  size: number,
  bricks: Brick[],
  ignore?: Tank
): boolean {
  if (x < 0 || y < 0 || x + size > WIDTH || y + size > HEIGHT) return false;
  for (const b of bricks) {
    if (b.destroyed) continue;
    if (rectsOverlap(x, y, size, size, b.x, b.y, TILE, TILE)) return false;
  }
  return true;
}
