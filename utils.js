// =====================
// wplace Utility Module
// =====================

// ===== 定数 =====
const MOD_CHUNK = 4000;   // チャンク（mod4000）
const MOD_TILE  = 1000;   // タイル（mod1000）
const ZOOM_BASE = 9;      // 内部座標系固定ズーム（wplace仕様）
const SCALE     = MOD_CHUNK * Math.pow(2, ZOOM_BASE); // = 4000 * 2^9 = 2048000

// ===== URL → lat/lng 抽出 =====
function parseWplaceURL(urlStr) {
  let url;
  try {
    url = new URL(urlStr);
  } catch {
    throw new Error('URL形式が不正です');
  }
  const lat = parseFloat(url.searchParams.get('lat'));
  const lng = parseFloat(url.searchParams.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('URLに lat / lng が見つかりません');
  }
  return { lat, lng };
}

// ===== world(px) → 緯度経度 =====
function worldToLatLng(worldX, worldY) {
  const lng = (worldX / SCALE) * 360 - 180;
  const n = Math.PI - 2 * Math.PI * (worldY / SCALE);
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
}

// ===== 緯度経度 → world(px) + チャンク/タイル座標 =====
function llzToWorldPixel(lat, lng) {
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const worldX = ((lng + 180) / 360) * SCALE;
  const worldY =
    (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * SCALE;

  const chunk = toLocal(worldX, worldY, MOD_CHUNK);
  const tile  = toLocal(worldX, worldY, MOD_TILE);

  return {
    // チャンク (mod4000)
    chunkX: chunk.chunkX,
    chunkY: chunk.chunkY,
    cLocalX: chunk.x,
    cLocalY: chunk.y,

    // タイル (mod1000)
    tileX: tile.chunkX,
    tileY: tile.chunkY,
    tLocalX: tile.x,
    tLocalY: tile.y,

    // ワールド座標
    worldX,
    worldY,
  };
}

// ===== world(px) → mod座標（チャンクやタイル） =====
function toLocal(px, py, modSize) {
  const chunkX = Math.floor(px / modSize);
  const chunkY = Math.floor(py / modSize);
  const localX = ((px % modSize) + modSize) % modSize;
  const localY = ((py % modSize) + modSize) % modSize;
  return { chunkX, chunkY, x: Math.floor(localX), y: Math.floor(localY) };
}

// ===== wplace URL 生成 =====
function toWplaceURL(worldX, worldY, zoom = 18) {
  const { lat, lng } = worldToLatLng(worldX, worldY);
  return `https://wplace.live/?lat=${lat}&lng=${lng}&zoom=${zoom}`;
}

// ===== 傾きセット =====
const SLOPE_SET = [
  1/10, 1/9, 1/8, 1/7, 1/6, 1/5, 1/4, 1/3, 1/2,
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10
];

// ===== 2点間ポリライン計画 =====
function chooseSlopes(m, set = SLOPE_SET) {
  let closest = set.reduce((best, s) =>
    Math.abs(s - m) < Math.abs(best - m) ? s : best, set[0]);
  if (Math.abs(closest - m) < 1e-9) return [closest, closest];
  const below = set.filter(s => s <= m);
  const above = set.filter(s => s >= m);
  const a = below.length ? below[below.length - 1] : set[0];
  const b = above.length ? above[0] : set[set.length - 1];
  return a <= b ? [a, b] : [b, a];
}

function planPolylineWorld(start, end, slopeSet = SLOPE_SET, opts = {}) {
  const { order = 'auto', roundToInt = true } = opts;

  let x0 = roundToInt ? Math.round(start.x) : start.x;
  let y0 = roundToInt ? Math.round(start.y) : start.y;
  let x1 = roundToInt ? Math.round(end.x)   : end.x;
  let y1 = roundToInt ? Math.round(end.y)   : end.y;

  let flippedX = false;
  if (x1 < x0) { x0 = -x0; x1 = -x1; flippedX = true; }

  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  if (dx === 0) {
    const s = { x: (flippedX ? -x0 : x0), y: y0 };
    const e = { x: (flippedX ? -x1 : x1), y: y1 };
    return {
      a: null, b: null, Na: 0, Nb: 0, bend: null,
      plannedEnd: e,
      polylineWorld: [s, e],
      polylineLocal: [toLocal(s.x, s.y), toLocal(e.x, e.y)],
      errorPx: { dx: e.x - end.x, dy: e.y - end.y },
    };
  }

  const m = dy / dx;
  let [a, b] = chooseSlopes(m, slopeSet);

  let Nb = (Math.abs(b - a) < 1e-9) ? 0 : Math.round((dy - a * dx) / (b - a));
  Nb = Math.max(0, Math.min(dx, Nb));
  const Na = dx - Nb;

  const sgnY = (y1 >= y0) ? 1 : -1;
  const sx = flippedX ? -1 : 1;
  const startW = { x: (flippedX ? -x0 : x0), y: y0 };

  const candA = {
    bend: { x: startW.x + sx * Na,        y: y0 + sgnY * (a * Na) },
    end:  { x: startW.x + sx * (Na + Nb), y: y0 + sgnY * (a * Na + b * Nb) }
  };
  const candB = {
    bend: { x: startW.x + sx * Nb,        y: y0 + sgnY * (b * Nb) },
    end:  { x: startW.x + sx * (Na + Nb), y: y0 + sgnY * (b * Nb + a * Na) }
  };

  let chosen;
  if (order === 'a-first') chosen = candA;
  else if (order === 'b-first') chosen = candB;
  else {
    const tx = (flippedX ? -x1 : x1), ty = y1;
    const errA = Math.hypot(candA.end.x - tx, candA.end.y - ty);
    const errB = Math.hypot(candB.end.x - tx, candB.end.y - ty);
    chosen = (errA <= errB) ? candA : candB;
  }

  return {
    a, b, Na, Nb,
    bend: chosen.bend,
    bendLocal: toLocal(chosen.bend.x, chosen.bend.y, MOD_CHUNK),
    plannedEnd: chosen.end,
    polylineWorld: [startW, chosen.bend, chosen.end],
    polylineLocal: [
      toLocal(startW.x, startW.y, MOD_CHUNK),
      toLocal(chosen.bend.x, chosen.bend.y, MOD_CHUNK),
      toLocal(chosen.end.x, chosen.end.y, MOD_CHUNK)
    ],
    errorPx: { dx: chosen.end.x - (flippedX ? -x1 : x1), dy: chosen.end.y - y1 },
  };
}
