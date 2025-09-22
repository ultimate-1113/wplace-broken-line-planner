// ===== 基本パラメータ =====
const HOGE = 4000; // 固定

// ===== 変換ユーティリティ =====
function llzToTilePixel(lat, lng, hoge = HOGE) {
  const tileSize = 1000;
  const zoom = 9;
  const scale = hoge * Math.pow(2, zoom);

  const worldX = ((lng + 180) / 360) * scale;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const worldY =
    (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;

  const TLX = Math.floor(worldX / tileSize);
  const TLY = Math.floor(worldY / tileSize);
  const PxX = Math.floor(worldX - TLX * tileSize);
  const PxY = Math.floor(worldY - TLY * tileSize);

  return { TLX, TLY, PxX, PxY, worldX, worldY };
}

// world(px) -> 緯度経度
function worldToLatLng(worldX, worldY, hoge = HOGE) {
  const zoom = 9;
  const scale = hoge * Math.pow(2, zoom);
  const lng = (worldX / scale) * 360 - 180;
  const n = Math.PI - 2 * Math.PI * (worldY / scale);
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
}

// wplace URL 作成
function toWplaceURL(worldX, worldY, hoge = HOGE, zoom = 18) {
  const { lat, lng } = worldToLatLng(worldX, worldY, hoge);
  return `https://wplace.live/?lat=${lat}&lng=${lng}&zoom=${zoom}`;
}

// URL から lat/lng を取り出す
function parseWplaceURL(urlStr) {
  let url;
  try { url = new URL(urlStr); } catch { throw new Error('URL形式が不正です'); }
  const lat = parseFloat(url.searchParams.get('lat'));
  const lng = parseFloat(url.searchParams.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('URLに lat / lng が見つかりません');
  }
  return { lat, lng };
}

// ===== ルーティング計画 =====

// 傾き候補
const SLOPE_SET = [1/5, 1/4, 1/3, 1/2, 1, 2, 3, 4, 5];

// m の下側aと上側bを選ぶ
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

// world -> mod4000
function toLocal(px, py, modSize = HOGE) {
  const chunkX = Math.floor(px / modSize);
  const chunkY = Math.floor(py / modSize);
  const localX = ((px % modSize) + modSize) % modSize;
  const localY = ((py % modSize) + modSize) % modSize;
  return { chunkX, chunkY, x: Math.floor(localX), y: Math.floor(localY) };
}

// ⭐ 追加：表示用 “1000 区切りのチャンク座標” を返すヘルパ
function toChunk1000(px, py) {
  const t = toLocal(px, py, 1000);
  // 表示で使うのはチャンク座標のみ（mod1000の x,y は返さない）
  return { chunkX: t.chunkX, chunkY: t.chunkY };
}

// 使い方：opts.order = 'auto' | 'a-first' | 'b-first'
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

      // ⭐ 追加：1000区切りのチャンク座標（表示用）
      chunks1000: {
        start: toChunk1000(s.x, s.y),
        bend:  null,
        end:   toChunk1000(e.x, e.y)
      }
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
    bendLocal: toLocal(chosen.bend.x, chosen.bend.y),
    plannedEnd: chosen.end,
    polylineWorld: [startW, chosen.bend, chosen.end],
    polylineLocal: [
      toLocal(startW.x, startW.y),
      toLocal(chosen.bend.x, chosen.bend.y),
      toLocal(chosen.end.x, chosen.end.y)
    ],
    errorPx: { dx: chosen.end.x - (flippedX ? -x1 : x1), dy: chosen.end.y - y1 },

    // ⭐ 追加：1000区切りのチャンク座標（表示用）
    chunks1000: {
      start: toChunk1000(startW.x,        startW.y),
      bend:  toChunk1000(chosen.bend.x,   chosen.bend.y),
      end:   toChunk1000(chosen.end.x,    chosen.end.y),
    }
  };
}

function planFromLatLng(lat1, lng1, lat2, lng2, hoge = HOGE, slopeSet = SLOPE_SET) {
  const p1 = llzToTilePixel(lat1, lng1, hoge);
  const p2 = llzToTilePixel(lat2, lng2, hoge);
  const plan = planPolylineWorld(
    { x: p1.worldX, y: p1.worldY },
    { x: p2.worldX, y: p2.worldY },
    slopeSet,
    { order: 'auto', roundToInt: true }
  );
  return { input: { p1, p2 }, ...plan };
}

// 必要なら外からも使えるように公開（モジュールでなければ不要）
window.toChunk1000 = window.toChunk1000 || toChunk1000;

document.getElementById('copyDebugBtn').addEventListener('click', () => {
  const text = document.getElementById('debug').textContent;
  if (!text) {
    alert("コピーするデータがありません。");
    return;
  }
  navigator.clipboard.writeText(text).then(() => {
    alert("デバッグデータをコピーしました！");
  }).catch(err => {
    console.error("コピーに失敗:", err);
    alert("コピーに失敗しました。");
  });
});
