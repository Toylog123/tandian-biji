/**
 * 数据层 —— 默认存在浏览器的 localStorage
 *
 * 在 js/config.js 里填了 Supabase 之后，会额外同步一份到云端，
 * 这样两个人在各自手机上看到的是同一份数据。
 *
 * 没填的话这里就是个纯单机应用，跟以前完全一样。
 */

import { SUPABASE } from './config.js';
import * as backend from './backend.js';

const KEY = 'lulu_family_menu_v1';

/* ---------- 示例数据 ---------- */

const SEED = {
  shops: [
    { id: 's1', name: '巷口黄焖鸡', platform: '美团', category: '快餐简餐',
      note: '就在小区南门，配送快', rating: 4.8, createdAt: 1,
      summary: '汤汁给得足，鸡肉嫩。就是偏咸，备注少盐。' },
    { id: 's2', name: '老四川麻辣烫', platform: '饿了么', category: '麻辣烫',
      note: '微辣就好，别太油', rating: 4.5, createdAt: 2,
      summary: '汤底比别家香，丸子扎实。选菜别贪多，贵还不出数。' },
    { id: 's3', name: '楼下沙县', platform: '美团', category: '快餐简餐',
      note: '早餐也不错', rating: 2.5, createdAt: 3,
      summary: '拌面咸得离谱，卤蛋不新鲜。已经不去第二次了。' },
    { id: 's4', name: '一点点', platform: '饿了么', category: '甜点饮品',
      note: '', rating: 5, createdAt: 4,
      summary: '三分糖刚刚好，波霸很足。下午三点去人少。' },
  ],
  dishes: [
    { id: 'd1', shopId: 's1', name: '黄焖鸡米饭', price: 22, tags: ['招牌'], desc: '偏咸，备注少盐。米饭管够。', rating: 5, available: true },
    { id: 'd2', shopId: 's1', name: '加份午餐肉', price: 6, tags: [], desc: '', rating: null, available: true },
    { id: 'd3', shopId: 's1', name: '例汤', price: 3, tags: [], desc: '很烫，小孩慎点', rating: 3, available: true },
    { id: 'd4', shopId: 's2', name: '麻辣烫（自己选菜）', price: 25, tags: ['自己选'], desc: '选菜别拿丸子，贵又不出数', rating: 4, available: true },
    { id: 'd5', shopId: 's2', name: '加一份宽粉', price: 4, tags: [], desc: '', rating: null, available: true },
    { id: 'd6', shopId: 's3', name: '蒸饺', price: 10, tags: [], desc: '早上现蒸的比中午好', rating: 4, available: true },
    { id: 'd7', shopId: 's3', name: '拌面', price: 12, tags: [], desc: '咸得很，慎点', rating: 2, available: true },
    { id: 'd8', shopId: 's3', name: '卤蛋', price: 2, tags: [], desc: '不新鲜，别点了', rating: 1, available: true },
    { id: 'd9', shopId: 's4', name: '波霸奶茶', price: 13, tags: ['三分糖'], desc: '三分糖刚好', rating: 5, available: true },
    { id: 'd10', shopId: 's4', name: '柠檬养乐多', price: 12, tags: [], desc: '', rating: null, available: true },
  ],
  orders: [],

  /* 探店记录 —— 每去一次记一条，只往后加，不覆盖以前的。
     date 是「什么时候去的」，不是录入时间；两者可能差很久（补录历史）。 */
  visits: [
    { id: 'v1', shopId: 's1', orderId: null, date: '2026-10-12', rating: 5,
      text: '汤汁多，鸡肉嫩，好吃', tags: ['好吃'], images: [], createdAt: 1 },
    { id: 'v2', shopId: 's1', orderId: null, date: '2026-09-28', rating: 4,
      text: '送得有点慢', tags: [], images: [], createdAt: 2 },
    { id: 'v3', shopId: 's3', orderId: null, date: '2026-10-05', rating: 2,
      text: '卤蛋不新鲜，别再点了', tags: ['别再点'], images: [], createdAt: 3 },
    { id: 'v4', shopId: 's3', orderId: null, date: '2026-08-19', rating: 3,
      text: '蒸饺还行，拌面还是咸', tags: [], images: [], createdAt: 4 },
  ],

  people: ['我', '她'],
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


/**
 * 各平台的入口。
 *
 * 查证情况（2026-10）：
 * - 美团外卖 H5 是 https://waimai.meituan.com/ —— 标题「美团外卖，送啥都快」，
 *   能浏览能搜索。**注意**：网上到处流传的 https://www.meituan.com/waimai/ 是错的，
 *   实测直接返回 Not Found，别用那个。
 * - 饿了么 H5 https://h5.ele.me/ 能浏览和找店，但**不能下单结算**，
 *   所以饿了么主要靠 App 唤起，网页只是兜底看看。
 *
 * 两个 scheme 唤起效果没法在这里验证（需要真机 + 装了 App），失败会自动回退网页。
 * 用户手动填了店铺链接时一律用用户的，那条路最准。
 */
export const PLATFORMS = {
  '美团':   { app: 'imeituan://www.meituan.com/', web: 'https://waimai.meituan.com/' },
  '饿了么': { app: 'eleme://',                   web: 'https://h5.ele.me/' },
  '其他':   { app: '',                           web: '' },
};

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
  });
  return data;
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
  if (backend.isRemote()) backend.push(db);
  return db;
}

let db = load();

/* 数据被别人改了或者云端拉下来了，要让页面重画 */
const changeHooks = new Set();
function emit() { changeHooks.forEach(fn => { try { fn(); } catch { /* ignore */ } }); }

// 没配后端就是空操作，配了就返回 true
const REMOTE = backend.configure(SUPABASE);

/**
 * 云端比新的就用云端的。
 *
 * 先用本地数据把界面画出来，再悄悄拉一次云端——这样即使网络慢也不卡首屏。
 * 拉到不同的内容才重画，避免每次打开都闪一下。
 */
if (REMOTE) {
  backend.pull().then(remote => {
    if (!remote) return;                       // 远端还没有数据，保留本地的
    if (JSON.stringify(remote) === JSON.stringify(db)) return;
    db = migrate(remote);
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* 存不下就算了，云端有 */ }
    emit();
  });
}

/* ---------- 对外的操作接口 ---------- */

export const store = {
  get db() { return db; },
  /** 后端有没有配上。false = 纯单机，数据只在这台设备上 */
  get shared() { return REMOTE; },

  /** 云端数据到了 / 同步状态变了，就回调一下，用来重画页面 */
  onChange(fn) {
    changeHooks.add(fn);
    return () => changeHooks.delete(fn);
  },

  shops() { return db.shops.slice().sort((a, b) => a.createdAt - b.createdAt); },
  shop(id) { return db.shops.find(s => s.id === id); },

  /**
   * 这家店的下单入口。
   * 优先用用户自己贴的店铺链接（最准，能直达那一家），
   * 否则按平台给 App 唤起地址 + 网页兜底。
   */
  entryOf(shop) {
    const p = PLATFORMS[shop.platform] || PLATFORMS['其他'];
    if (shop.link) return { kind: 'custom', app: shop.link, web: shop.link };
    return { kind: p.app ? 'platform' : 'none', app: p.app, web: p.web };
  },

  dishes(shopId) {
    return db.dishes.filter(d => d.shopId === shopId && d.available !== false);
  },
  allDishes() { return db.dishes; },

  /** 待下单的清单 */
  pendingOrder() { return db.orders.find(o => o.status === 'pending'); },
  orders() { return db.orders.slice().reverse(); },

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

  /** 某笔订单里还没写记录的店 */
  unratedShops(order) {
    if (!order) return [];
    const shopIds = [...new Set(order.items.map(i => i.shopId))];
    return shopIds.filter(sid => !db.visits.some(v => v.orderId === order.id && v.shopId === sid));
  },

  /* 店铺增删改 */
  addShop(data) {
    const shop = { id: uid('s'), createdAt: Date.now(), rating: 0, note: '', summary: '', platform: '美团', category: '', link: '', image: '', ...data };
    db.shops.push(shop);
    save(db);
    return shop;
  },
  updateShop(id, patch) {
    const s = this.shop(id);
    if (!s) return null;
    Object.assign(s, patch);
    save(db);
    return s;
  },
  removeShop(id) {
    db.shops = db.shops.filter(s => s.id !== id);
    db.dishes = db.dishes.filter(d => d.shopId !== id);
    db.visits = db.visits.filter(v => v.shopId !== id);
    save(db);
  },

  /* 菜品增删改 */
  addDish(data) {
    const dish = { id: uid('d'), available: true, tags: [], desc: '', rating: null, image: '', ...data };
    dish.price = Number(dish.price) || 0;
    db.dishes.push(dish);
    save(db);
    return dish;
  },
  updateDish(id, patch) {
    const d = db.dishes.find(x => x.id === id);
    if (!d) return null;
    Object.assign(d, patch);
    d.price = Number(d.price) || 0;
    save(db);
    return d;
  },
  removeDish(id) {
    db.dishes = db.dishes.filter(d => d.id !== id);
    save(db);
  },

  /**
   * 给单个菜品打分。传 null / 0 表示清掉评分（回到「没吃过，不知道」）。
   * 从店铺页点星星走这里，点第 n 颗就是 n 分，再点同一颗取消。
   */
  rateDish(id, rating) {
    const d = db.dishes.find(x => x.id === id);
    if (!d) return null;
    d.rating = (rating === null || rating === d.rating) ? null : Number(rating);
    save(db);
    return d;
  },

  /**
   * 给菜品设图 / 清图（传空字符串就是删掉）。
   *
   * 存不下时必须把内存里的值退回去——不然 db.image 已经是那张超大的图，
   * 下次任何一次 save 都会重复失败，页面看着还正常但再也存不进去东西。
   */
  setDishImage(id, url) {
    const d = db.dishes.find(x => x.id === id);
    if (!d) return null;
    const prev = d.image;
    d.image = url || '';
    try {
      save(db);
    } catch (e) {
      d.image = prev;
      throw e;
    }
    return d;
  },

  dish(id) { return db.dishes.find(d => d.id === id); },

  /* 清单操作 */
  addToOrder(dishId, qty, note, who) {
    const d = db.dishes.find(x => x.id === dishId);
    if (!d) return null;

    let order = db.orders.find(o => o.status === 'pending');

    if (!order) {
      order = { id: uid('o'), createdAt: Date.now(), status: 'pending', items: [] };
      db.orders.unshift(order);
    }

    const line = {
      dishId: d.id,
      shopId: d.shopId,
      shopName: (this.shop(d.shopId) || {}).name || '未知店铺',
      name: d.name,
      // 清单是快照：当时有没有图、多少钱，都按加入那一刻记下来。
      // 后来改了菜也不影响已经加进来的这一行。
      image: d.image || '',
      price: d.price,
      qty: Math.max(1, qty | 0),
      note: note || '',
      who: who || '',
    };

    // 同一个人点同一道菜就合并，方便改数量
    const same = order.items.find(i => i.dishId === line.dishId && i.note === line.note && i.who === line.who);
    if (same) same.qty += line.qty;
    else order.items.push(line);

    save(db);
    return order;
  },

  updateItem(orderId, index, patch) {
    const o = db.orders.find(x => x.id === orderId);
    if (!o || !o.items[index]) return;
    if (patch.qty !== undefined) o.items[index].qty = Math.max(1, patch.qty | 0);
    if (patch.note !== undefined) o.items[index].note = patch.note;
    save(db);
  },

  removeItem(orderId, index) {
    const o = db.orders.find(x => x.id === orderId);
    if (!o) return;
    o.items.splice(index, 1);
    if (!o.items.length) db.orders = db.orders.filter(x => x.id !== orderId);
    save(db);
  },

  /** 标记为「已下单」或「已搞定」 */
  setOrderStatus(orderId, status) {
    const o = db.orders.find(x => x.id === orderId);
    if (!o) return;
    o.status = status;
    o.doneAt = Date.now();
    save(db);
  },

  clearPending() {
    db.orders = db.orders.filter(o => o.status !== 'pending');
    save(db);
  },

  /** 重置回示例数据 */
  reset() {
    db = structuredClone(SEED);
    save(db);
  },

  total(order) {
    return order.items.reduce((sum, i) => sum + i.price * i.qty, 0);
  },
};

/* ---------- 工具 ---------- */

function uid(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

export function money(n) {
  return '¥' + (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, '');
}
