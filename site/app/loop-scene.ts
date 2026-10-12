export interface Painter {
  fillStyle: unknown;
  clearRect(x: number, y: number, width: number, height: number): void;
  fillRect(x: number, y: number, width: number, height: number): void;
}

export const LOOP_STAGES = 5;
export const LOOP_DWELL_MS = 900;
export const LOOP_TRAVEL_MS = 1300;
export const LOOP_STAGE_MS = LOOP_DWELL_MS + LOOP_TRAVEL_MS;
export const LOOP_CYCLE_MS = LOOP_STAGE_MS * LOOP_STAGES;
export const LOOP_STILL_MS = LOOP_DWELL_MS - 1;
export const LOOP_PITCH = 5;

const TAU = Math.PI * 2;
const STATION_STEP = TAU / LOOP_STAGES;
const START_ANGLE = -Math.PI / 2;
const DISSOLVE_MS = 450;
const WAVE_MS = 1500;
const FIRE_MS = 450;
const CHIP_HALF_WIDTH = 5;
const CHIP_HALF_HEIGHT = 6;
const NUMBER_SUB = 2;
const NUMBER_SHIFT = -5;
const RING_WIDTH = 1.15;
const HALO_WIDTH = 2.8;
const HALO_REACH = 6;

const KIND_BACKGROUND = 0;
const KIND_CHIP_BORDER = 3;
const KIND_CHIP_FILL = 4;
const KIND_CHIP_DIGIT = 5;

type Rgb = readonly [number, number, number];

const GRAY: Rgb = [150, 150, 150];
const LIGHT: Rgb = [205, 205, 205];
const WHITE: Rgb = [237, 237, 237];
const GREEN: Rgb = [124, 240, 176];
const HOT: Rgb = [235, 255, 245];

export interface LoopTiming {
  readonly stage: number;
  readonly since: number;
  readonly travelling: boolean;
  readonly progress: number;
  readonly speed: number;
  readonly angle: number;
}

export interface Station {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

export interface LoopScene {
  readonly size: number;
  readonly pitch: number;
  readonly cells: number;
  readonly offset: number;
  readonly center: number;
  readonly radius: number;
  readonly numberBottom: number;
  readonly kind: Uint8Array;
  readonly chip: Int8Array;
  readonly ring: Float32Array;
  readonly angle: Float32Array;
  readonly distance: Float32Array;
  readonly noise: Float32Array;
  readonly base: Float32Array;
  readonly field: Float32Array;
  readonly panel: Uint8Array;
  readonly numbers: readonly Uint8Array[];
  readonly stations: readonly Station[];
}

export interface LoopSceneOptions {
  readonly size: number;
  readonly digits: readonly (readonly string[])[];
  readonly pitch?: number;
}

function mod(value: number, base: number): number {
  return ((value % base) + base) % base;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function ease(x: number): number {
  return x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2;
}

function easeSpeed(x: number): number {
  return (x < 0.5 ? 12 * x * x : 3 * (-2 * x + 2) ** 2) / 3;
}

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  const t = clamp01(amount);
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
}

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function stationAngle(index: number): number {
  return START_ANGLE + index * STATION_STEP;
}

export function loopTiming(time: number): LoopTiming {
  const local = mod(time, LOOP_CYCLE_MS);
  const stage = Math.floor(local / LOOP_STAGE_MS);
  const since = local - stage * LOOP_STAGE_MS;
  const travelling = since >= LOOP_DWELL_MS;
  const x = travelling ? (since - LOOP_DWELL_MS) / LOOP_TRAVEL_MS : 0;
  const progress = travelling ? ease(x) : 0;
  return {
    stage,
    since,
    travelling,
    progress,
    speed: travelling ? easeSpeed(x) : 0,
    angle: stationAngle(stage + progress),
  };
}

function numberTop(center: number): number {
  return Math.round(center + NUMBER_SHIFT - (7 * NUMBER_SUB - 1) / 2);
}

function numberLeft(center: number): number {
  return Math.round(center - (11 * NUMBER_SUB - 1) / 2);
}

function numberMask(
  cells: number,
  center: number,
  text: string,
  digits: readonly (readonly string[])[],
): Uint8Array {
  const mask = new Uint8Array(cells * cells);
  const left = numberLeft(center);
  const top = numberTop(center);
  [...text].forEach((char, index) => {
    const glyph = digits[Number(char)] ?? [];
    glyph.forEach((row, gy) => {
      for (let gx = 0; gx < row.length; gx += 1) {
        if (row[gx] !== "#") {
          continue;
        }
        for (let sy = 0; sy < NUMBER_SUB; sy += 1) {
          for (let sx = 0; sx < NUMBER_SUB; sx += 1) {
            const x = left + (index * 6 + gx) * NUMBER_SUB + sx;
            const y = top + gy * NUMBER_SUB + sy;
            if (x >= 0 && y >= 0 && x < cells && y < cells) {
              mask[y * cells + x] = 1;
            }
          }
        }
      }
    });
  });
  return mask;
}

function panelMask(cells: number, center: number): Uint8Array {
  const mask = new Uint8Array(cells * cells);
  const left = numberLeft(center);
  const top = numberTop(center);
  for (let y = top; y < top + 7 * NUMBER_SUB; y += 1) {
    for (let x = left; x < left + 11 * NUMBER_SUB; x += 1) {
      if (x >= 0 && y >= 0 && x < cells && y < cells) {
        mask[y * cells + x] = 1;
      }
    }
  }
  return mask;
}

export function buildLoopScene(options: LoopSceneOptions): LoopScene {
  const pitch = options.pitch ?? LOOP_PITCH;
  const cells = Math.max(40, Math.floor(options.size / pitch));
  const offset = (options.size - cells * pitch) / 2;
  const center = (cells - 1) / 2;
  const radius = Math.round(cells * 0.365);
  const total = cells * cells;
  const kind = new Uint8Array(total);
  const chip = new Int8Array(total).fill(-1);
  const ring = new Float32Array(total);
  const angle = new Float32Array(total);
  const distance = new Float32Array(total);
  const noise = new Float32Array(total);
  const base = new Float32Array(total);
  const field = new Float32Array(total);
  const next = random(0xade);
  const stations: Station[] = [];
  for (let index = 0; index < LOOP_STAGES; index += 1) {
    const a = stationAngle(index);
    stations.push({
      x: Math.round(center + radius * Math.cos(a)),
      y: Math.round(center + radius * Math.sin(a)),
      angle: a,
    });
  }
  for (let y = 0; y < cells; y += 1) {
    for (let x = 0; x < cells; x += 1) {
      const i = y * cells + x;
      const dx = x - center;
      const dy = y - center;
      const d = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      angle[i] = a;
      distance[i] = d;
      noise[i] = next();
      base[i] = 0.14 * (1 - smoothstep(0.42, 0.98, d / (cells / 2)));
      field[i] = 1 - smoothstep(0.7, 0.98, d / (cells / 2));
      ring[i] = clamp01(1 - Math.abs(d - radius) / RING_WIDTH);
      stations.forEach((station, index) => {
        const sx = x - station.x;
        const sy = y - station.y;
        const ax = Math.abs(sx);
        const ay = Math.abs(sy);
        if (ax > CHIP_HALF_WIDTH || ay > CHIP_HALF_HEIGHT) {
          return;
        }
        chip[i] = index;
        ring[i] = 0;
        if (ax === CHIP_HALF_WIDTH && ay === CHIP_HALF_HEIGHT) {
          kind[i] = KIND_BACKGROUND;
          chip[i] = -1;
          return;
        }
        if (ax === CHIP_HALF_WIDTH || ay === CHIP_HALF_HEIGHT) {
          kind[i] = KIND_CHIP_BORDER;
          return;
        }
        const glyph = options.digits[index + 1] ?? [];
        kind[i] = glyph[sy + 3]?.[sx + 2] === "#" ? KIND_CHIP_DIGIT : KIND_CHIP_FILL;
      });
    }
  }
  return {
    size: options.size,
    pitch,
    cells,
    offset,
    center,
    radius,
    numberBottom: numberTop(center) + 7 * NUMBER_SUB,
    kind,
    chip,
    ring,
    angle,
    distance,
    noise,
    base,
    field,
    panel: panelMask(cells, center),
    numbers: Array.from({ length: LOOP_STAGES }, (_, index) =>
      numberMask(cells, center, `0${index + 1}`, options.digits),
    ),
    stations,
  };
}

function inArc(value: number, from: number, to: number): boolean {
  const span = mod(to - from, TAU);
  return span > 0 && mod(value - from, TAU) <= span;
}

function rgba(color: Rgb, alpha: number): string {
  return `rgba(${Math.round(color[0])},${Math.round(color[1])},${Math.round(color[2])},${clamp01(alpha).toFixed(3)})`;
}

export function drawLoop(painter: Painter, scene: LoopScene, time: number, still = false): number {
  const timing = loopTiming(time);
  const { cells, pitch, offset, radius, center } = scene;
  painter.clearRect(0, 0, scene.size, scene.size);
  const headX = center + radius * Math.cos(timing.angle);
  const headY = center + radius * Math.sin(timing.angle);
  const since = scene.stations.map((_, index) => mod(time - index * LOOP_STAGE_MS, LOOP_CYCLE_MS));
  const glow = since.map((value, index) =>
    Math.max(Math.exp(-value / FIRE_MS), index === timing.stage ? 0.62 : 0),
  );
  const tail = 0.07 + 0.55 * timing.speed;
  const waveReach = cells * 0.95;
  const arcFrom = stationAngle(timing.travelling ? timing.stage : timing.stage - 1);
  const arcTo = timing.travelling ? timing.angle : stationAngle(timing.stage);
  const arcAlpha = timing.travelling ? 0.5 : 0.5 * (1 - timing.since / LOOP_DWELL_MS);
  const dissolve = clamp01(timing.since / DISSOLVE_MS);
  const current = scene.numbers[timing.stage] ?? new Uint8Array(0);
  const previous = scene.numbers[mod(timing.stage - 1, LOOP_STAGES)] ?? new Uint8Array(0);
  for (let i = 0; i < cells * cells; i += 1) {
    const x = i % cells;
    const y = Math.floor(i / cells);
    const kind = scene.kind[i] ?? KIND_BACKGROUND;
    const station = scene.chip[i] ?? -1;
    const a = scene.angle[i] ?? 0;
    const band = scene.ring[i] ?? 0;
    const offRing = (scene.distance[i] ?? 0) - radius;
    let color: Rgb = GRAY;
    let alpha = scene.base[i] ?? 0;
    let size = 2;
    if (station >= 0) {
      const lit = glow[station] ?? 0;
      if (kind === KIND_CHIP_BORDER) {
        color = mix(LIGHT, GREEN, lit);
        alpha = 0.5 + 0.5 * lit;
      } else if (kind === KIND_CHIP_FILL) {
        color = mix(GRAY, GREEN, lit);
        alpha = 0.1 + 0.34 * lit;
      } else {
        color = mix(LIGHT, WHITE, lit);
        alpha = 0.74 + 0.26 * lit;
        size = lit > 0.5 ? 3 : 2;
      }
    }
    if (band > 0) {
      alpha = Math.max(alpha, 0.1 + 0.36 * band);
      color = LIGHT;
      if (arcAlpha > 0.01 && inArc(a, arcFrom, arcTo)) {
        color = GREEN;
        alpha = Math.max(alpha, arcAlpha * (0.3 + 0.7 * band));
      }
    }
    if (station < 0 && Math.abs(offRing) < HALO_REACH) {
      const behind = mod(timing.angle - a, TAU);
      const heat = behind < tail * 7 ? Math.exp(-behind / tail) : 0;
      if (heat > 0.02) {
        const spread = Math.exp(-((offRing / HALO_WIDTH) ** 2)) * (scene.field[i] ?? 0);
        const lit = heat * Math.max(band, 0.78 * spread);
        if (lit > 0.03 && 0.2 + 0.8 * lit > alpha) {
          color = lit > 0.7 ? mix(GREEN, HOT, (lit - 0.7) / 0.3) : GREEN;
          alpha = 0.2 + 0.8 * lit;
          size = lit > 0.3 ? 3 : 2;
        }
      }
    }
    if (scene.panel[i] === 1) {
      alpha = Math.max(alpha, 0.15);
      const noise = scene.noise[i] ?? 0;
      const on = (current[i] === 1 && noise < dissolve) || (previous[i] === 1 && noise >= dissolve);
      if (on) {
        color = WHITE;
        alpha = 0.95;
        size = 3;
      }
    }
    if (station < 0) {
      const hx = Math.abs(x - headX);
      const hy = Math.abs(y - headY);
      const near = Math.hypot(hx, hy);
      const cross = (hx < 0.6 && hy < 3.1) || (hy < 0.6 && hx < 3.1);
      if (near < 0.9 || cross) {
        color = HOT;
        alpha = near < 0.9 ? 1 : 0.75;
        size = 3;
      }
      scene.stations.forEach((spot, index) => {
        const age = since[index] ?? WAVE_MS;
        if (still || age >= WAVE_MS) {
          return;
        }
        const front = (age / WAVE_MS) * waveReach;
        const gap = Math.abs(Math.hypot(x - spot.x, y - spot.y) - front);
        if (gap >= 1.4) {
          return;
        }
        const strength =
          0.55 * (1 - age / WAVE_MS) ** 1.1 * (1 - gap / 1.4) * (scene.field[i] ?? 0);
        if (strength > alpha) {
          color = GREEN;
          alpha = strength;
        }
      });
    }
    if (alpha < 0.01) {
      continue;
    }
    painter.fillStyle = rgba(color, alpha);
    const inset = (pitch - size) / 2;
    painter.fillRect(offset + x * pitch + inset, offset + y * pitch + inset, size, size);
  }
  return timing.stage;
}
