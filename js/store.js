/**
 * 数据层 —— 默认存在浏览器的 localStorage
 *
 * 在 js/config.js 里配好 GitHub 仓库、并且在管理页填了 token 之后，
 * 会额外同步一份到云端，这样两台手机看到的是同一份数据。
 *
 * 没填的话这里就是个纯单机应用，跟以前完全一样。
 */

import * as cloud from './ghstore.js';

const KEY = 'lulu_family_menu_v1';

/* ---------- 初始数据 ---------- */

/**
 * 故意是空的。
 *
 * 这是「我自己的探店档案库」，不是演示站。第一次打开就该是干净的空档案，
 * 由本人从零开始录 —— 预置几家虚构的店反而会让人分不清哪条是真记录。
 *
 * 空状态下首页会显示「还没记过任何一家店」+「去记店」入口（见 app.js 的
 * renderShops），点进去就是录店表单。
 *
 * 想临时灌一批假数据看效果：本地存储里删掉这一项再刷新即可。
 *   localStorage.removeItem('lulu_family_menu_v1'); location.reload();
 * 删完会重新用下面的空 SEED 初始化。想找回以前那批虚构数据，
 * 见 git 历史 commit 287eeb8。
 */
const SEED = {
  shops: [],
  dishes: [],
  orders: [],
  visits: [],
  people: ['我', '她'],
  updatedAt: 0,
};

/**
 * 评分档位。首页按这四组排，一眼躲开踩雷的。
 *
 * 阈值不是随手定的：5 星是「很好吃」、4 星「还不错」、3 星「一般般」，
 * 2 星「不太行」、1 星「难以下咽」。均分 >=4.5 算值得专程去，
 * <2.5 就是别再去了。
 */
export const TIERS = [
  { key: 'love',  min: 4.5, label: '强烈推荐', emoji: '💛', cls: 't-love' },
  { key: 'ok',    min: 3.5, label: '还可以',   emoji: '🙂', cls: 't-ok' },
  { key: 'meh',   min: 2.5, label: '一般',     emoji: '😐', cls: 't-meh' },
  { key: 'avoid', min: 0,   label: '别再去',   emoji: '⛔', cls: 't-avoid' },
];

/* ---------- 读写 ---------- */

/**
 * 补齐后加的字段。
 *
 * 老数据是从上一版存下来的，里面没有后来新增的键（比如 reviews），
 * 直接读会拿到 undefined，页面一渲染就炸。
 * 每加一个新字段，在这里补一行就行。
 */
function migrate(data) {
  if (!Array.isArray(data.shops))     data.shops = [];
  if (!Array.isArray(data.dishes))    data.dishes = [];
  if (!Array.isArray(data.orders))    data.orders = [];
  if (!Array.isArray(data.people))    data.people = ['我', '她'];

  /* 这一份数据最后一次改动的时间。用来判断云端和本地谁更新，
     见 syncFromRemote —— 没有它，旧的云端会把新的本地盖掉。 */
  if (!Number.isFinite(Number(data.updatedAt))) data.updatedAt = 0;
  data.updatedAt = Number(data.updatedAt);

  /* reviews -> visits。
     以前叫「评价」，一个店一条；现在是「探店记录」，去一次记一条。
     老数据直接搬过来，createdAt 反推日期当 date 用，
     这样「今天存的」不会在时间线里莫名显示成 1970 年。 */
  if (!Array.isArray(data.visits)) {
    data.visits = (Array.isArray(data.reviews) ? data.reviews : []).map(r => ({
      ...r,
      date: r.date || fromTs(r.createdAt),
      images: Array.isArray(r.images) ? r.images : [],
    }));
  }
  delete data.reviews;

  data.visits.forEach(v => {
    if (!v.date)              v.date = fromTs(v.createdAt);
    if (!Array.isArray(v.tags))    v.tags = [];
    if (!Array.isArray(v.images)) v.images = [];
    if (typeof v.text !== 'string') v.text = '';
    if (v.rating == null)      v.rating = 3;
    // 人均价格：没记是 null。跟「0 元」必须分得开，否则排序时混在一起
    v.price = normPrice(v.price);
  });

  // 菜品是后加 desc / rating / image 的，老数据里没有
  data.dishes.forEach(d => {
    if (typeof d.desc !== 'string')   d.desc = '';
    if (d.rating == null)             d.rating = null;
    if (typeof d.image !== 'string')  d.image = '';
  });
  // 店铺是后加 link / summary 的
  data.shops.forEach(s => {
    if (typeof s.link !== 'string')    s.link = '';
    if (typeof s.image !== 'string')   s.image = '';
    if (typeof s.summary !== 'string') s.summary = '';
    // score = 「这家值不值」的手给总分。null 是「还没打过分」，
    // 跟 1 分（明确不值）是两回事，所以不能用 0 兜底。
    if (s.score != null) {
      const n = Math.round(Number(s.score));
      s.score = (Number.isFinite(n) && n >= 1 && n <= 5) ? n : null;
    } else {
      s.score = null;
    }
  });
  return data;
}

/**
 * 人均价格归一化。
 *
 * 「没填」和「0 元」是两件事，必须分得开：
 *   空输入是 undefined / null / '' / 纯空白 -> null（没记）
 *   填了 0                              -> 0（真的是 0 元）
 *
 * 不能写成 `Number(x) > 0 ? ... : null` —— 那样 0 会被当成没填，
 * 用户老老实实填的「人均 0」就被静默吞掉了。
 * 注意空串要单独判：Number('') 是 0，不先拦掉就会把「没填」变成 0。
 */
function normPrice(x) {
  if (x === null || x === undefined) return null;
  if (typeof x === 'string' && x.trim() === '') return null;
  const n = Number(x);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * 「这家值不值」的总评分归一化。
 *
 * 只接受 1~5 的整数，其余一律 null（= 还没打过分）。
 * 不能拿 0 兜底：0 会被当成一个真实分数，而「没打过分」和「打了低分」
 * 是两回事——前者是还没想好，后者是想过了。
 */
function normScore(x) {
  if (x === null || x === undefined || x === '') return null;
  const n = Math.round(Number(x));
  return (Number.isFinite(n) && n >= 1 && n <= 5) ? n : null;
}

/** 时间戳 -> 'YYYY-MM-DD'；时间戳是秒（老示例数据）就乘 1000 */
function fromTs(ts) {
  const ms = Number(ts) < 1e12 ? Number(ts) * 1000 : Number(ts);
  const d = new Date(ms || Date.now());
  if (!Number.isFinite(d.getTime())) return today();
  return d.toISOString().slice(0, 10);
}

export function today() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}


function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch (e) {
    console.warn('读取本地数据失败，用示例数据', e);
  }
  return structuredClone(SEED);
}

function save(db) {
  db.updatedAt = Date.now();
  // 本地永远先写：即使云端挂了、断网了，这一台设备上的操作也不能丢
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch (e) {
    // 存图片最容易撞到这个：localStorage 一般 5~10MB，满了就是这个错
    if (e.name === 'QuotaExceededError' || e.code === 22 || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
      throw new Error('本地空间满了（浏览器一般只给 5MB，存不下更多图片了）。\n\n' +
                      '可以：删掉几张不常用的图片，或者把不常看的菜删掉。');
    }
    throw e;
  }
  if (cloud.isRemote()) cloud.push(db);
  return db;
}

let db = load();

/* 数据被别人改了或者云端拉下来了，要让页面重画 */
const changeHooks = new Set();
function emit() { changeHooks.forEach(fn => { try { fn(); } catch { /* ignore */ } }); }

// config.js 里配了仓库地址没有？配了也不代表在同步，还得填 token。
const CONFIGURED = cloud.isConfigured();

/**
 * 键序无关的深比较。
 *
 * 比内容而不是比字符串：任何一次序列化顺序的变化都会让
 * JSON.stringify 的结果对不上，于是每次打开页面都误判成「云端有更新」，
 * 白白重画一次，还把「真的没变」和「别人改了」混为一谈。
 */
function stableEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => stableEqual(v, b[i]));
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && stableEqual(a[k], b[k]));
}

/* 同时只跑一次拉取，别让切前台和轮询撞在一起 */
let syncing = false;

/**
 * 拉一次云端，确实有新内容才换本地。
 *
 * 三道保险：
 * 1. 本地还有没推上去的改动就直接不换——否则防抖窗口里刚敲的字会被云端旧数据冲掉；
 * 2. 云端比本地旧就不换——**hasPending() 挡不住刷新页面**。
 *    推送是防抖 90 秒的，用户在窗口里刷新或杀掉进程，排队中的那次推送
 *    就随内存一起没了，localStorage 里是新的、云端还是旧的；
 *    下次打开页面 hasPending() 又是 false，于是旧的云端把刚写的数据盖掉，
 *    还会顺手把旧的写回 localStorage，改动就没了。靠 updatedAt 比时间才躲得开。
 * 3. 内容确实一致就什么都不做——避免每次切回前台都闪一下。
 */
async function syncFromRemote() {
  if (!CONFIGURED || !cloud.isRemote() || syncing) return false;
  if (cloud.hasPending()) return false;         // 本地有改动没推完，先让推完
  syncing = true;
  try {
    const remote = await cloud.pull();
    if (!remote) return false;                  // 远端还没数据，保留本地的
    remote.updatedAt = Number(remote.updatedAt) || 0;   // 老云端数据没这个字段
    if (stableEqual(remote, db)) return false;  // 真的没变，别白重画
    /* 归一化之后才能比：云端老数据里没有 updatedAt，直接 Number(undefined)
       得到 NaN，而 NaN < 任何值都是 false —— 拿它当保护等于没保护。 */
    if (remote.updatedAt < (Number(db.updatedAt) || 0)) return false;
    db = migrate(remote);
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* 存不下就算了，云端有 */ }
    emit();
    return true;
  } finally {
    syncing = false;
  }
}

if (CONFIGURED) {
  /* 上次有改动没推完，页面就被刷新了或者进程被手机回收了：
     内存里的队列已经没了，但改动还在本地。打开页面就补推一次，
     别让它停在这一台设备上——另一台手机就再也看不到这些记录了。 */
  if (cloud.isRemote() && cloud.hasStalePending()) cloud.pushNow(db);

  syncFromRemote();

  /* 切回前台就拉一次。
     手机上 PWA 常挂着几天不关，只在启动时拉一次等于「换设备不同步」——
     这条才是「不同设备同步」真正能用的关键。 */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncFromRemote();
  });

  /* 页面一直开着不切走的情况（比如挂在另一块屏上），靠低频轮询兜底。
     30 秒一次，份量很轻，但别再调小了：拉的是整份 JSON。 */
  setInterval(() => {
    if (document.visibilityState === 'visible') syncFromRemote();
  }, 30000);
}

/**
 * 填/改 token。传空串 = 断开，只在这台设备上改。
 *
 * token 存在本机，**不进仓库**——仓库是公开的，写在里面等于没设防。
 * 换设备要再填一次，这是有意的代价。
 *
 * 填对之后立刻拉一次：两个人都填好之后，第二个人填完马上就能看到
 * 第一个人的记录，不用等 30 秒轮询。
 */
export function enableSync(token) {
  const ok = cloud.setToken(token);
  cloud.resetCache();          // token 可能指到另一份数据，别用旧的 sha
  if (ok && cloud.isRemote()) syncFromRemote();
  return ok && cloud.isRemote();
}

export function disconnectSync() {
  cloud.setToken('');
  cloud.resetCache();
}

/** 手动立刻同步一次（「立即同步」按钮） */
export function syncNow() { return syncFromRemote(); }

/** config.js 里配了仓库地址吗（跟「现在有没有在同步」是两回事） */
export const cloudConfigured = CONFIGURED;

/* ---------- 对外的操作接口 ---------- */

export const store = {
  get db() { return db; },
  /** 现在是不是真的在同步。false = 纯单机，数据只在这台设备上 */
  get shared() { return CONFIGURED && cloud.isRemote(); },

  /** 云端数据到了 / 同步状态变了，就回调一下，用来重画页面 */
  onChange(fn) {
    changeHooks.add(fn);
    return () => changeHooks.delete(fn);
  },

  shops() { return db.shops.slice().sort((a, b) => a.createdAt - b.createdAt); },
  shop(id) { return db.shops.find(s => s.id === id); },

  people() { return db.people; },

  /* ---------- 探店记录 ---------- */

  /** 这家店的全部记录，按去的时间倒序（没填日期的沉底） */
  visitsOf(shopId) {
    return db.visits
      .filter(v => v.shopId === shopId)
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
  },

  /** 最近一次去是什么时候去的；一次都没去过返回 null */
  lastVisitOf(shopId) {
    return this.visitsOf(shopId)[0] || null;
  },

  /** 这家店我给的均分，没有记录返回 null */
  avgRating(shopId) {
    const list = db.visits.filter(v => v.shopId === shopId);
    if (!list.length) return null;
    return Math.round(list.reduce((s, v) => s + v.rating, 0) / list.length * 10) / 10;
  },

  /** 这家店落在哪一档；没记录返回 null */
  tierOf(shopId) {
    const avg = this.avgRating(shopId);
    if (avg === null) return null;
    return TIERS.find(t => avg >= t.min) || TIERS[TIERS.length - 1];
  },

  /**
   * 记一次探店。
   * date 默认今天；补录以前去过的那次要显式传，不然时间线会排在最前面。
   */
  addVisit(data) {
    const v = {
      id: uid('v'),
      orderId: null,
      date: today(),
      text: '',
      tags: [],
      images: [],
      createdAt: Date.now(),
      ...data,
    };
    v.rating = Math.min(5, Math.max(1, Number(v.rating) || 3));
    if (!v.date) v.date = today();
    v.price = normPrice(v.price);
    db.visits.push(v);
    save(db);
    return v;
  },

  updateVisit(id, patch) {
    const v = db.visits.find(x => x.id === id);
    if (!v) return null;
    Object.assign(v, patch);
    save(db);
    return v;
  },

  removeVisit(id) {
    db.visits = db.visits.filter(v => v.id !== id);
    save(db);
  },

  /* 店铺增删改 */
  addShop(data) {
    const shop = { id: uid('s'), createdAt: Date.now(), rating: 0, note: '', summary: '', category: '', score: null, ...data };
    shop.score = normScore(shop.score);
    db.shops.push(shop);
    save(db);
    return shop;
  },
  updateShop(id, patch) {
    const s = this.shop(id);
    if (!s) return null;
    Object.assign(s, patch);
    s.score = normScore(s.score);
    save(db);
    return s;
  },
  removeShop(id) {
    db.shops = db.shops.filter(s => s.id !== id);
    db.visits = db.visits.filter(v => v.shopId !== id);
    save(db);
  },

  /** 重置回示例数据 */
  reset() {
    db = structuredClone(SEED);
    save(db);
  },
};

/* ---------- 工具 ---------- */

function uid(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}
