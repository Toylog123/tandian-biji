/**
 * 后端同步（可选）
 *
 * 没配置 `js/config.js` 里的 SUPABASE_URL 时，这个文件什么都不做，
 * 应用退回纯 localStorage 单机版——也就是说加了它不会把现在能跑的搞坏。
 *
 * 为什么只存「一整份 JSON」而不建一堆表：
 * 就两个人用、几十条记录，拆成 shops/dishes/orders 三张表纯属自找麻烦——
 * 每次改动都要同步 schema。而 Postgres 的 jsonb 能直接存整个对象，
 * 读写就是一次 GET / PUT。以后真要做统计再拆表也不迟。
 *
 * 并发策略是「后写覆盖」。两个人同时改不同东西时，后写的会把先写的盖掉。
 * 家庭场景下同时编辑的概率很低，先不做冲突合并。
 */

/** 同一行的固定 id——就一份菜单，不分账号 */
const ROW_ID = 'home';
const TABLE = 'lulu_menu';

let conf = null;
let status = 'local';          // local | syncing | ok | error
const watchers = new Set();

/* ---------- 配置 ---------- */

/**
 * 传入 {url, key} 就开同步，传 null 就关。
 * key 是 Supabase 的 anon / publishable key，本来就是设计成可以放进前端公开的，
 * 但仍然只该配合下面那种「谁都能改」的 RLS 策略用，见 docs/接入后端.md。
 */
export function configure({ url, key } = {}) {
  conf = url && key ? { url: url.replace(/\/+$/, ''), key } : null;
  setStatus(conf ? 'syncing' : 'local');
  return !!conf;
}

export function isRemote() { return !!conf; }

/* ---------- 状态 ---------- */

export function onStatus(fn) {
  watchers.add(fn);
  fn(status);
  return () => watchers.delete(fn);
}

function setStatus(next) {
  if (status === next) return;
  status = next;
  watchers.forEach(fn => { try { fn(status); } catch { /* 单个订阅者出错别拖垮别人 */ } });
}

/* ---------- 读 ---------- */

/**
 * 拉远端那一份。返回 db 或 null（没配后端 / 网络失败 / 远端还没有数据）。
 * 调用方拿 null 时继续用本地那份，不算错误。
 */
export async function pull() {
  if (!conf) return null;
  setStatus('syncing');
  try {
    const r = await fetch(
      `${conf.url}/rest/v1/${TABLE}?select=data&id=eq.${ROW_ID}&limit=1`,
      { headers: authHeaders() }
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length || !rows[0].data) {
      // 远端还没建过行：不是错误，保持本地数据，下一次保存会把它推上去
      setStatus('ok');
      return null;
    }
    setStatus('ok');
    return rows[0].data;
  } catch (e) {
    setStatus('error');
    console.warn('拉取云端数据失败，继续用本地那份', e);
    return null;
  }
}

/* ---------- 写 ---------- */

let timer = null;
let queued = null;
let inflight = false;

/**
 * 推一份上去。**立即返回，不等网络**——打字时每敲一下都要存，
 * 等网络会让界面卡住。所以是防抖合并：停手 900ms 后推一次。
 */
export function push(db) {
  if (!conf) return Promise.resolve(false);
  queued = db;
  clearTimeout(timer);
  timer = setTimeout(flush, 900);
  return Promise.resolve(true);
}

/** 立刻把排队中的那份推出去（页面被关掉前调用） */
export async function flushNow(db) {
  if (db) queued = db;
  clearTimeout(timer);
  return flush();
}

async function flush() {
  if (!conf || inflight || !queued) return false;
  const payload = queued;
  queued = null;
  inflight = true;
  setStatus('syncing');
  try {
    const r = await fetch(`${conf.url}/rest/v1/${TABLE}?on_conflict=id`, {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
        // 没有这行，重复 POST 会因为主键冲突直接报错而不是更新
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        id: ROW_ID,
        data: payload,
        updated_at: new Date().toISOString(),
      }),
    });
    if (!r.ok) throw new Error(await r.text() || `HTTP ${r.status}`);
    setStatus('ok');
    return true;
  } catch (e) {
    // 推失败就把这份放回队列，下次再试；不要丢
    queued = queued || payload;
    setStatus('error');
    console.warn('推送云端失败，已排队重试', e);
    return false;
  } finally {
    inflight = false;
  }
}

function authHeaders() {
  return {
    apikey: conf.key,
    Authorization: `Bearer ${conf.key}`,
  };
}

/* 页面被关掉时，把还没推出去的那份尽量抢救一下。
   visibilitychange 在手机上比 beforeunload 靠谱得多。 */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush();
});
window.addEventListener('pagehide', flush);
