/**
 * 共享存储：把数据存在 GitHub 仓库的一个文件里。
 *
 * 为什么是 GitHub 而不是数据库：反正要一个云上服务，而 GitHub 已经有账号、
 * 免费、能直接从网页调 API（CORS 放行了 PUT）。两个人几十条记录，一个
 * data.json 就够，没必要为它单独开个后端服务。
 *
 * ── 安全上的前提 ──────────────────────────────────────────
 * 这个网页是公开的（GitHub Pages），仓库内容谁都能看。所以：
 *
 *   · **token 不写进任何文件**。js/config.js 里只有 owner/repo，
 *     这两个不是秘密。token 由本人在自己手机上粘一次，存进
 *     那台设备的 localStorage。公开仓库里根本没有 token。
 *   · token 必须限定在 tandian-data 这一个私有仓库上。
 *     用错成 All repositories，拿到它的人就能删掉你别的工程——
 *     这不是假设，是真的很容易点错。
 *
 * ── 两个文件，不是一个 ────────────────────────────────────
 *   data.json    店、菜、探店记录、订单（纯文本）
 *   photos.json  图片，按 id 索引
 *
 * 拆开是因为 git 每次提交都存一个完整快照。图片是 base64，一张 30~45KB。
 * 如果图片混在 data.json 里，改个菜名就要提交几百 KB 的新 blob，
 * 几十次下来仓库直接膨胀。拆开后，改文字只提交几 KB，图片没变就完全不动。
 *
 * ── 提交频率 ──────────────────────────────────────────────
 * 保存是每敲一下就触发的，但**提交不是**。云端写入合并成：
 * 停手 90 秒、切后台、或手动点同步，才产生一次提交。
 * 否则一天几百条提交，再小的仓库也会被撑坏。
 *
 * ── 两台设备同时改 ────────────────────────────────────────
 * GitHub 的 PUT 要求带上文件当前 sha，对不上就返回 409。
 * 冲突时我们重新读一次再覆盖（后写覆盖，不做冲突合并）。
 * 这个沙盒里同时编辑的概率很低。
 */

import { GH } from './config.js';

/* ---------- 配置 ---------- */

/** 没配 owner/repo 就是纯单机，功能一模一样，只是数据不共享。 */
const conf = GH && GH.owner && GH.repo
  ? { owner: String(GH.owner), repo: String(GH.repo), dataPath: GH.dataPath || 'data.json', photoPath: GH.photoPath || 'photos.json' }
  : null;

const API = conf ? `https://api.github.com/repos/${conf.owner}/${conf.repo}/contents` : '';

/** 云端写入的合并窗口：这么久之内的所有改动合并成一次提交。 */
const PUSH_DEBOUNCE = 9000 * 10;   // 90 秒

/* ---------- 状态 ---------- */

let status = 'local';        // local | syncing | ok | error | locked
const watchers = new Set();

function setStatus(next) {
  if (status === next) return;
  status = next;
  watchers.forEach(fn => { try { fn(status); } catch { /* 别让单个订阅者拖垮别人 */ } });
}

export function onStatus(fn) {
  watchers.add(fn);
  fn(status);
  return () => watchers.delete(fn);
}

/* ---------- token ---------- */

/**
 * token 存在这台设备上，绝不进仓库。
 * 每个设备粘一次就行；换设备要再粘一次，这是有意的代价。
 */
const TOKEN_KEY = 'lulu_gh_token';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

export function setToken(t) {
  const v = String(t || '').trim();
  try {
    if (v) localStorage.setItem(TOKEN_KEY, v);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (e) {
    console.warn('token 存不下来', e);
  }
  setStatus(conf && v ? 'syncing' : 'local');
  return !!v;
}

export function hasToken() { return !!getToken(); }

/** 配了地址 + 填了 token 才算真的在共享 */
export function isRemote() { return !!conf && hasToken(); }

export function isConfigured() { return !!conf; }

/* ---------- base64（要正确处理中文） ---------- */

function encode(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  const CH = 0x8000;                     // 分块，否则大文件 apply 会爆栈
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(bin);
}

function decode(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));   // GitHub 返回的 base64 带换行
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes));
}

function headers() {
  return {
    Authorization: `Bearer ${getToken()}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/* ---------- 图片拆合 ---------- */

/**
 * 把图片从数据里抽出来单独放。
 * 抽不抽得干净取决于 migrate() 已经补齐了数组——没补齐会直接炸，
 * 所以每个数组都判一下。
 */
export function splitPhotos(db) {
  const photos = {};
  const text = JSON.parse(JSON.stringify(db));
  const arr = x => (Array.isArray(x) ? x : []);

  arr(text.shops).forEach(s => {
    if (s.image) { photos['s:' + s.id] = s.image; s.image = ''; }
  });
  arr(text.dishes).forEach(d => {
    if (d.image) { photos['d:' + d.id] = d.image; d.image = ''; }
  });
  arr(text.visits).forEach(v => {
    if (Array.isArray(v.images) && v.images.length) { photos['v:' + v.id] = v.images; v.images = []; }
  });
  return { text, photos };
}

/** joinPhotos 是 splitPhotos 的逆操作。 */
export function joinPhotos(text, photos) {
  const db = JSON.parse(JSON.stringify(text || {}));
  const p = photos || {};
  const arr = x => (Array.isArray(x) ? x : []);

  arr(db.shops).forEach(s => { if (p['s:' + s.id]) s.image = p['s:' + s.id]; });
  arr(db.dishes).forEach(d => { if (p['d:' + d.id]) d.image = p['d:' + d.id]; });
  arr(db.visits).forEach(v => { if (p['v:' + v.id]) v.images = p['v:' + v.id]; });
  return db;
}

/* ---------- 底层读写 ---------- */

async function readFile(path) {
  const r = await fetch(`${API}/${path}`, { headers: headers() });
  if (r.status === 404) return { missing: true, sha: null, obj: null };
  if (r.status === 401 || r.status === 403) { setStatus('locked'); return { missing: true, sha: null, obj: null, denied: true }; }
  if (!r.ok) throw new Error(`读 ${path} 失败 HTTP ${r.status}`);
  const j = await r.json();
  return { missing: false, sha: j.sha, obj: decode(j.content) };
}

async function writeFile(path, obj, sha, message) {
  const body = { message, content: encode(obj) };
  if (sha) body.sha = sha;               // 不带 sha 就是新建，带了才是更新
  const r = await fetch(`${API}/${path}`, {
    method: 'PUT',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    return { conflict: r.status === 409 || r.status === 422, msg: err.message || `HTTP ${r.status}` };
  }
  const j = await r.json();
  return { sha: j.content && j.content.sha };
}

/* ---------- 拉 ---------- */

/** 记住各文件当前的 sha，写的时候要用；变了说明别人动过。 */
let shaData = null;
let shaPhoto = null;
/** 上次推上去的内容，用来判断「其实没变」就别提交。 */
let lastPushed = null;

export function resetCache() { shaData = null; shaPhoto = null; lastPushed = null; }

/**
 * 拉一次。返回合并好的 db，或者 null（没配 / 没 token / 网络失败 / 远端还没数据）。
 * 返回 null 不算错误，调用方继续用本地那份。
 */
export async function pull() {
  if (!isRemote()) return null;
  setStatus('syncing');
  try {
    const d = await readFile(conf.dataPath);
    if (d.denied) return null;
    shaData = d.sha;

    const p = await readFile(conf.photoPath);
    if (!p.denied) shaPhoto = p.sha;

    if (d.missing || !d.obj) { setStatus('ok'); return null; }   // 远端还没数据

    const db = joinPhotos(d.obj, p.missing ? {} : p.obj);
    setStatus('ok');
    return db;
  } catch (e) {
    setStatus('error');
    console.warn('拉取失败，继续用本地那份', e);
    return null;
  }
}

/* ---------- 推 ---------- */

let timer = null;
let queued = null;
let inflight = false;

/* 「本地有改动还没推上去」。
   队列是内存里的，一刷新就没了 —— 所以这个状态必须落到 localStorage，
   否则用户改完随手一刷新，改动就永远停在这台手机上，另一台看不到。
   推送成功后才清掉。 */
const PENDING_KEY = 'lulu_gh_pending';

function markPending() { try { localStorage.setItem(PENDING_KEY, '1'); } catch { /* 存不下就算了 */ } }
function clearPending() { try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ } }

/** 上一次是不是没推完就被刷新/回收了 */
export function hasStalePending() {
  try { return localStorage.getItem(PENDING_KEY) === '1'; } catch { return false; }
}

/**
 * 推一份上去，**立即返回不等网络**。
 * 内部是合并节流：90 秒内的所有改动只产生一次提交。
 */
export function push(db) {
  if (!isRemote()) return Promise.resolve(false);
  queued = db;
  markPending();
  clearTimeout(timer);
  timer = setTimeout(flush, PUSH_DEBOUNCE);
  return Promise.resolve(true);
}

/**
 * 不等防抖，立刻推。
 *
 * 只在一种时候用：页面刚打开，发现上次有改动没推完（刷新或进程被回收
 * 把内存里的队列冲掉了）。这时候已经在等用户操作了，没必要再压 90 秒。
 */
export function pushNow(db) {
  if (!isRemote()) return Promise.resolve(false);
  queued = db;
  markPending();
  clearTimeout(timer);
  return flush();
}

/** 立刻把排队中的推出去（页面被关掉前调用） */
export async function flushNow(db) {
  if (db) queued = db;
  clearTimeout(timer);
  return flush();
}

/**
 * 本地还有没有没推上去的改动。
 * 拉云端之前必须问一句：有就别拿云端覆盖本地，
 * 否则防抖窗口里刚敲的那句话会被云端旧数据盖掉。
 */
export function hasPending() { return inflight || queued !== null; }

async function flush() {
  if (!isRemote()) return false;
  // 上一次还没推完就丢掉的话，新改动会一直卡在队列里没人管
  if (inflight) { timer = setTimeout(flush, PUSH_DEBOUNCE); return false; }
  if (!queued) return false;

  const payload = queued;
  queued = null;
  inflight = true;
  setStatus('syncing');

  try {
    const { text, photos } = splitPhotos(payload);

    // 没变就别提交——否则光是打开页面就能刷出一堆空提交
    const sig = JSON.stringify([text, photos]);
    if (sig === lastPushed) { clearPending(); setStatus('ok'); return true; }

    // 提交信息写得具体一点，将来翻 git log 能看懂
    const n = (Array.isArray(text.shops) ? text.shops.length : 0);
    const v = (Array.isArray(text.visits) ? text.visits.length : 0);
    const msg = `同步：${n} 家店 / ${v} 条探店记录`;

    // 图片没变就不动 photos.json，避免每次改文字都提交一遍图片
    if (JSON.stringify(photos) !== lastPhotosSig) {
      const r = await writeFile(conf.photoPath, photos, shaPhoto, '同步照片');
      if (r.conflict) {
        const fresh = await readFile(conf.photoPath);
        shaPhoto = fresh.sha;
        const r2 = await writeFile(conf.photoPath, photos, shaPhoto, '同步照片');
        if (r2.conflict) throw new Error('照片写入持续冲突');
        shaPhoto = r2.sha;
      } else if (r.msg) {
        throw new Error(r.msg);
      } else {
        shaPhoto = r.sha;
      }
    }

    const d = await writeFile(conf.dataPath, text, shaData, msg);
    if (d.conflict) {
      // 别人刚写过。重新读一次 sha 再覆盖 = 后写覆盖。
      const fresh = await readFile(conf.dataPath);
      shaData = fresh.sha;
      const d2 = await writeFile(conf.dataPath, text, shaData, msg);
      if (d2.conflict) throw new Error('数据写入持续冲突，可能两台设备在同时改');
      shaData = d2.sha;
    } else if (d.msg) {
      throw new Error(d.msg);
    } else {
      shaData = d.sha;
    }

    lastPushed = sig;
    lastPhotosSig = JSON.stringify(photos);
    clearPending();
    setStatus('ok');
    return true;
  } catch (e) {
    queued = queued || payload;      // 推失败就放回队列，下次再试；不要丢
    setStatus('error');
    console.warn('推送失败，已排队重试', e);
    return false;
  } finally {
    inflight = false;
  }
}

let lastPhotosSig = null;

/* 页面被关掉时把还没推的尽量抢救一下。
   visibilitychange 在手机上比 beforeunload 靠谱得多。 */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush();
});
window.addEventListener('pagehide', flush);
