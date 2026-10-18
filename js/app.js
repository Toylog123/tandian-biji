import { store, TIERS, today,
         cloudConfigured, enableSync, disconnectSync, syncNow } from './store.js';
import { compressImage, usage } from './img.js';
import { fromNow } from './dates.js';
import * as cloud from './ghstore.js';

/* 噜噜形象。
   face 是正脸方图，裁成圆形当头像；另三张是横幅场景，
   宽高比 16:9，当空状态插图正好（缩成小方块会看不清在干嘛）。 */
const LULU = {
  face:    'assets/lulu-app-icon.webp',
  waiting: 'assets/lulu-waiting.webp',
  cooking: 'assets/lulu-cooking.webp',
  ride:    'assets/lulu-delivering.webp',
};

/** 头部的小圆头像 */
function mascot(src = LULU.face, cls = '') {
  return `<img class="mascot ${cls}" src="${src}" alt="" aria-hidden="true">`;
}

/* 云端拉下来的数据到了就重画；同步状态变了只改那一个小圆点，不整页重画
   ——整页重画会把正在输入的框冲掉，打字打到一半焦点就没了。 */
store.onChange(render);

let syncState = 'local';
cloud.onStatus(s => {
  syncState = s;
  paintSync();
});

function syncLabel() {
  if (!cloudConfigured) return '仅本机';
  if (!store.shared) return '没连云端';
  if (syncState === 'locked') return 'token 无效';
  /* pending = 改动还在这台手机上排队，准备上传。
     这两种必须分开，不然绿灯「已同步」会把用户骗了——
     另一台手机这时候还看不到他刚记的东西。 */
  if (syncState === 'pending') return '待上传…';
  if (syncState === 'ok') return '已同步';
  if (syncState === 'syncing') return '同步中…';
  return '云端没连上，先存本地';
}

function syncChip() {
  return `<span class="sync-chip" data-state="${syncState}" data-sync>● ${syncLabel()}</span>`;
}

function paintSync() {
  const el = document.querySelector('[data-sync]');
  if (!el) return;
  el.dataset.state = syncState;
  el.textContent = '● ' + syncLabel();
}

/* ============================================================
   路由
   ============================================================ */

const routes = {
  '/':       renderShops,
  '/shop':   renderShop,
  '/manage': renderManage,
};

let current = { path: '/', params: [] };

/** 店档案页的「✎ 编辑」是不是展开着。存店 id 而不是布尔：
 *  布尔会让「在 A 店展开编辑 → 回首页 → 进 B 店」也展开着，
 *  而编辑框是输入即存的，B 店的资料会被误改。 */
let editingId = null;

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const parts = raw.split('/').filter(Boolean);
  const head = '/' + (parts[0] || '');
  if (head === '/shop' && parts[1]) return { path: '/shop', params: [parts[1]] };
  if (routes[head]) return { path: head, params: [] };
  return { path: '/', params: [] };
}

function go(path) { location.hash = path; }

function render() {
  current = parseHash();
  /* 编辑面板只在当前这家店的页面上成立：换店或离开店档案页就收起，
     免得回来时对着一个开着的输入框，直接把字打进了别的店。 */
  if (editingId && current.params[0] !== editingId) editingId = null;
  const view = routes[current.path] || renderShops;
  document.getElementById('app').innerHTML = view(current.params);
  paintTabbar();
  window.scrollTo(0, 0);
}

/* ---------- 轻提示（图片处理是异步的，需要有反馈） ---------- */

function toast(msg, ms = 2200) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/**
 * 选图：先登记「这张图要送去哪」，再让 <label for="picInput"> 触发隐藏的 input。
 *
 * 分两步是因为没法从 input 的 change 事件里反推是哪个按钮点的——DOM 里有一堆
 * 📷，只有一个 input。用回调把上下文带过去。
 */
let picHandler = null;

function pickImage(handler) { picHandler = handler; }

const picInput = document.getElementById('picInput');
picInput.addEventListener('change', async () => {
  const file = picInput.files && picInput.files[0];
  const handler = picHandler;
  picHandler = null;
  picInput.value = '';           // 清掉，否则连选同一张不会触发 change
  if (!file || !handler) return;

  toast('正在压缩图片…', 60000);
  handler(await compressImage(file));
});

/* 用户在系统选图框里点「取消」时 change 根本不触发，
   只能靠窗口重新拿到焦点来判断「啥也没选就关了」。 */
window.addEventListener('focus', () => {
  setTimeout(() => {
    if (picHandler && !(picInput.files && picInput.files.length)) {
      const handler = picHandler;
      picHandler = null;
      handler(null);
    }
  }, 700);
});

/* ============================================================
   页面 1：探店档案（按评分分组，一眼躲开踩雷的）
   ============================================================ */

function renderShops() {
  const shops = store.shops();
  const rated = shops.filter(s => store.tierOf(s.id));
  const best = rated.length ? Math.max(...rated.map(s => store.avgRating(s.id))) : null;

  const banner = `
    <div class="banner">
      <img src="${LULU.ride}" alt="" class="banner-img">
      <div class="banner-txt">
        <strong>吃过哪些店，还记得吗</strong>
        <span>${
          shops.length
            ? (rated.length
                ? `${shops.length} 家 · 最高 ${best} ★`
                : `${shops.length} 家，都还没记过`)
            : '还没有店，点右上角记一家'
        }</span>
      </div>
    </div>`;

  /* 「记一家新店」放在档案这边而不是管理页——
     管理只管同步，所有跟店有关的动作都在这儿。 */
  const head = `
    <div class="page-head">
      ${mascot()}
      <div>
        <div class="shop-title">探店档案</div>
        <div class="shop-sub">吃饭前翻一翻，躲开踩雷的</div>
      </div>
      ${syncChip()}
      <button class="btn-primary btn-sm" data-addshop>＋ 探店</button>
    </div>`;

  if (!shops.length) {
    return head + banner + emptyState(
      '还没记过任何一家店', '吃完顺手记一条，下次就有底了',
      '', '＋ 探店', LULU.cooking, '', 'data-addshop');
  }

  // 每组内部：均分高的排前面
  const groups = TIERS.map(t => ({ ...t, list: [] }));
  const unrated = [];
  shops.forEach(s => {
    const t = store.tierOf(s.id);
    if (t) groups.find(g => g.key === t.key).list.push(s);
    else unrated.push(s);
  });
  groups.forEach(g => g.list.sort((a, b) => store.avgRating(b.id) - store.avgRating(a.id)));

  const section = (title, list, cls) => list.length ? `
    <section class="block ${cls}">
      <h2 class="block-title">${title} <span class="dim">${list.length} 家</span></h2>
      <div class="shop-list">${list.map(shopCard).join('')}</div>
    </section>` : '';

  const body = [
    ...groups.map(g => section(`${g.emoji} ${g.label}`, g.list, `grp-${g.cls}`)),
    section('❓ 还没记过', unrated, 'grp-none'),
  ].join('');

  return `
    ${head}
    ${banner}
    ${body}`;
}

/** 档案卡片：一句话总结 + 平均分 + 去过几次 */
function shopCard(s) {
  const avg = store.avgRating(s.id);
  const tier = store.tierOf(s.id);
  const times = store.visitsOf(s.id).length;
  const last = store.lastVisitOf(s.id);

  return `
    <button class="shop-card ${tier ? tier.cls : ''}" data-go="/shop/${s.id}">
      ${avg !== null
        ? ratingArt(avg, 'shop-mood', s.id)
        : `<div class="shop-avatar">${esc((s.name || '店').slice(0, 1))}</div>`}
      <div class="shop-main">
        <div class="shop-name">
          ${esc(s.name)}
          ${avg !== null ? `<span class="avg-chip">${avg} ★</span>` : ''}
        </div>
        <div class="shop-meta">
          ${s.category ? `<span>${esc(s.category)}</span>` : ''}
          ${last ? `<span title="最近一次：${esc(last.date || '')}">去过 ${times} 次 · 最近 ${fromNow(last.date)}</span>` : ''}
        </div>
        ${s.summary
          ? `<div class="shop-note">${esc(s.summary)}</div>`
          : `<div class="shop-note dim">还没写一句话总结</div>`}
      </div>
      <div class="shop-go">›</div>
    </button>`;
}

/* 日期怎么显示给人看，在 js/dates.js。纯函数，能直接扔进 node 测。 */


/* ============================================================
   页面 2：这家店的档案
   ============================================================ */

function renderShop([id]) {
  const shop = store.shop(id);
  if (!shop) return emptyState('这家店不见了', '可能已经被删掉了', '/', '回到首页', LULU.waiting);

  const avg = store.avgRating(id);
  const tier = store.tierOf(id);

  return `
    <div class="page-head">
      <button class="back" data-go="/">‹</button>
      ${mascot()}
      <div style="flex:1">
        <div class="shop-title">${esc(shop.name)}</div>
        <div class="shop-sub">
          ${avg !== null
            ? `<span class="tier-tag ${tier.cls}">${tier.emoji} ${tier.label} · ${avg} ★</span>`
            : `还没记过`}
        </div>
      </div>
      <button class="btn-ghost btn-sm" data-toggleedit>${editingId === shop.id ? '收起' : '✎ 编辑'}</button>
    </div>

    ${shopVerdict(shop)}
    ${shop.note ? `<div class="notice">📌 ${esc(shop.note)}</div>` : ''}

    ${editingId === shop.id ? shopEditor(shop) : ''}

    ${visitSection(shop)}`;
}

/**
 * 「这家值不值」——手给的店铺总评分，跟每次去打的星是两回事。
 *
 * 均分是**算出来的**（所有探店记录的平均），容易被某一次的心情带偏；
 * 总分是**你自己下的结论**，可以不跟均分一致。
 * 所以两个都留着，不互相覆盖。没打过分显示 null，不占地方。
 */
function shopVerdict(shop) {
  const score = shop.score;
  const words = { 1: '不值', 2: '不太值', 3: '一般', 4: '值得再来', 5: '闭眼冲' };
  return `
    <section class="block verdict">
      <h2 class="block-title">这家值不值 <span class="dim">你自己下的结论</span></h2>
      <div class="verdict-row">
        <div class="star-pick big">
          ${[1, 2, 3, 4, 5].map(i =>
            `<button data-score="${i}" class="${score && i <= score ? 'on' : ''}"
                     aria-label="${i} 星">★</button>`).join('')}
        </div>
        <span class="verdict-word">${score ? `${words[score]}` : '还没打过分'}</span>
      </div>
      ${shop.summary
        ? `<div class="summary-box inline">${esc(shop.summary)}</div>`
        : `<div class="dim pad-sm">还没写一句话总结。</div>`}
    </section>`;
}

/** 点「✎ 编辑」才出现的就地编辑区。改动输入即存，不点保存。 */
function shopEditor(shop) {
  return `
    <section class="block">
      <h2 class="block-title">改这家店 <span class="dim">输入即存</span></h2>
      <div class="mng-row col">
        <input class="line-edit" value="${esc(shop.name)}" data-shname="${shop.id}" placeholder="店名">
        <input class="line-edit" value="${esc(shop.category || '')}"
               data-shcat="${shop.id}" placeholder="分类：快餐简餐 / 烧烤 / 甜品">
        <textarea class="line-edit summary-edit" rows="2" data-shsum="${shop.id}"
          placeholder="一句话总结：这家到底行不行？下次靠这句想起来">${esc(shop.summary || '')}</textarea>
        <input class="line-edit" value="${esc(shop.note || '')}" data-shnote="${shop.id}"
               placeholder="备注：配送快 / 别点微辣">
        <button class="link-del danger" data-delshop="${shop.id}">删这家店</button>
      </div>
    </section>`;
}

/**
 * 每一档星级对应好几张噜噜图，看哪张随机。
 *
 * 随的是**这条记录**，不是每次渲染：同一个 id 永远落到同一张图。
 * 要是每次 render 都重新摇一遍，首页一滚动、一碰按钮，图就换，
 * 看着像出了 bug，而且同一条记录前后两张脸对不上。
 * 用 id 散列代替真随机，既稳又不用往数据里存字段——
 * 新记一条就是新 id，自然就换了一张图。
 *
 * 补图只要两步：把文件丢进 assets/rating/，然后往对应的数组里加一行文件名。
 */
const RATING_ART = {
  1: [
    'assets/rating/rating-1a.gif',
    'assets/rating/rating-1b.gif',
    'assets/rating/rating-1c.gif',
    'assets/rating/rating-1d.gif',
  ],
  2: [
    'assets/rating/rating-2a.gif',
    'assets/rating/rating-2b.gif',
    'assets/rating/rating-2c.gif',
  ],
  3: [
    'assets/rating/rating-3a.gif',
    'assets/rating/rating-3b.gif',
  ],
  4: [
    'assets/rating/rating-4a.gif',
    'assets/rating/rating-4b.gif',
    'assets/rating/rating-4c.gif',
  ],
  5: [
    'assets/rating/rating-5a.gif',
    'assets/rating/rating-5b.gif',
  ],
};

/** 把 id 散成一个稳定的整数。同一串字符永远得到同一个数。 */
function seedOf(str) {
  let h = 2166136261;
  const s = String(str == null ? '' : str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0);
}

/**
 * 星级配图。seed 决定这一条取哪张，缺省按星级来（那就没有随机效果了）。
 * 这一档一张图都没有时，给一块写清楚几星的虚线占位。
 */
function ratingArt(n, cls = '', seed = '') {
  const k = Math.min(5, Math.max(1, Math.round(Number(n)) || 3));
  const list = RATING_ART[k] || [];
  if (list.length) {
    const src = list[seed ? seedOf(seed) % list.length : 0];
    return `<img class="rate-art ${cls}" src="${src}" alt="${k} 星" loading="lazy">`;
  }
  return `<span class="rate-art rate-art-empty ${cls}" aria-label="${k} 星">${k}★</span>`;
}

/**
 * 探店记录排序方式。放模块作用域——每次 render 都重建 DOM，
 * 放局部变量里等于每切一次就跳回默认排序。
 */
let visitSort = 'date';

const VISIT_SORTS = [
  { key: 'date',       label: '最近去' },
  { key: 'rating',     label: '星数高' },
  { key: 'price-asc',  label: '人均低→高' },
  { key: 'price-desc', label: '人均高→低' },
];

/** 人均价格。没填返回 null，跟「0 元」分得开（见 store.js 的 normPrice）。 */
function priceOf(v) {
  const p = v ? v.price : null;
  if (p === null || p === undefined) return null;
  if (typeof p === 'string' && p.trim() === '') return null;
  const n = Number(p);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * 排序。**没填价格的永远排最后**，不管升序还是降序——
 * 升序靠 null=Infinity 能做到，降序那样会把空的顶到最前面，
 * 而最没信息的一行不该占最好的位置。
 */
function sortVisits(list, key) {
  const v = [...list];
  if (key === 'rating') {
    v.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  } else if (key === 'price-asc' || key === 'price-desc') {
    const dir = key === 'price-asc' ? 1 : -1;
    v.sort((a, b) => {
      const x = priceOf(a), y = priceOf(b);
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x - y) * dir;
    });
  } else {
    v.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  }
  return v;
}

/**
 * 探店记录：去一次一条。
 * 这是这个应用的正文——菜可以忘，哪次好吃哪次踩雷不能忘。
 */
function visitSection(shop) {
  const all = store.visitsOf(shop.id);
  const list = sortVisits(all, visitSort);
  const avg = store.avgRating(shop.id);
  const prices = all.map(priceOf).filter(x => x !== null);
  const avgPrice = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null;

  return `
    <section class="block">
      <h2 class="block-title">
        探店记录
        ${avg !== null ? `<span class="avg-chip">${avg} ★</span>` : ''}
        ${avgPrice !== null ? `<span class="avg-chip">人均 ¥${avgPrice}</span>` : ''}
        <span class="dim">${list.length} 次</span>
        <button class="btn-primary btn-sm" data-visit="${shop.id}">记一次</button>
      </h2>

      ${all.length > 1 ? `
      <div class="sort-bar">
        <span class="dim">排序</span>
        ${VISIT_SORTS.map(s => `<button class="sort-opt ${visitSort === s.key ? 'on' : ''}" data-vsort="${s.key}">${s.label}</button>`).join('')}
      </div>` : ''}

      ${list.length ? list.map(v => `
        <div class="visit" data-editvisit="${v.id}" role="button" tabindex="0">
          <div class="visit-head">
            ${ratingArt(v.rating, 'visit-mood', v.id)}
            <div class="rev-stars">${stars(v.rating)}</div>
            <div class="visit-date">${esc(v.date || '')}${priceOf(v) !== null ? ` · 人均 ¥${priceOf(v)}` : ''}</div>
            <button class="link-del" data-delvisit="${v.id}" title="删掉这条">删</button>
          </div>
          ${(v.dishes || []).length ? `
            <div class="visit-dishes">${v.dishes.map(d => `
              <div class="dish-line">
                <span class="dish-chip static">${esc(d.name)}</span>
                ${miniStars(d.rating)}
                ${d.text ? `<span class="dish-note-out">${esc(d.text)}</span>` : ''}
              </div>`).join('')}</div>` : ''}
          ${v.text ? `<div class="visit-text">${esc(v.text)}</div>` : ''}
          ${(v.tags || []).map(t => `<span class="rev-tag">${esc(t)}</span>`).join('')}
          ${(v.images || []).length ? `
            <div class="visit-imgs">
              ${v.images.map(src => `<img src="${esc(src)}" alt="" loading="lazy">`).join('')}
            </div>` : ''}
        </div>`).join('')
      : `<div class="dim pad">还没记过。下次吃完顺手记一条，下次就有底了。</div>`}
    </section>`;
}


function stars(n) {
  return Array.from({ length: 5 }, (_, i) =>
    `<span class="${i < n ? 'on' : ''}">★</span>`).join('');
}

/**
 * 菜品行上那排小星。
 *
 * 没打分（null）就整排不画——画一排灰星会被读成「打了 1 星」，
 * 跟「没打过分」不是一回事。只画实心的，灰色的一概不画。
 */
function miniStars(n) {
  const k = n == null ? 0 : Math.round(Number(n));
  if (!Number.isFinite(k) || k <= 0) return '';
  const v = Math.min(5, k);
  return `<span class="mini-stars" aria-label="${v} 星">` +
    Array.from({ length: v }, () => '<span>★</span>').join('') + '</span>';
}

/* ============================================================
   页面 3：管理（只管同步）
   ============================================================ */

/**
 * 管理页现在**只管一件事：云端同步**。
 * 记店、给店铺评价、改资料全在「档案」那边——
 * 跟店有关的动作都聚在一处，管理页不再分两半。
 */
function renderManage() {
  const u = usage();
  return `
    <div class="page-head">
      ${mascot()}
      <div>
        <div class="shop-title">管理</div>
        <div class="shop-sub">这里只管两台手机怎么共用数据</div>
      </div>
      ${syncChip()}
    </div>

    ${cloudPanel()}

    <section class="block">
      <h2 class="block-title">这台设备上的空间</h2>
      <div class="pad dim">已用 ${u.usedMB} MB，还能再放大约 ${u.approxLeft} 张照片。
        照片会自动压到 400px 再存。</div>
    </section>`;
}

/**
 * 云端同步设置。
 *
 * 只在 js/config.js 配了仓库地址时才出现。
 *
 * token **故意不写进代码**：网页和仓库都是公开的，写在里面等于没设防。
 * 每台设备粘一次，存在那台设备上。
 */
function cloudPanel() {
  if (!cloudConfigured) return '';
  if (store.shared) {
    return `
      <section class="block">
        <h2 class="block-title">云端同步</h2>
        <div class="pad dim">已连上。你们两台手机看到的是同一份数据，
          谁记了一条，另一台切回前台就能看到。</div>
        <div class="pad">
          <button class="btn-ghost" data-sync-now>立即同步</button>
          <button class="link-btn" data-cloud-off>断开</button>
        </div>
      </section>`;
  }
  return `
    <section class="block">
      <h2 class="block-title">云端同步</h2>
      <div class="pad dim">填一次 token 就跟另一台手机共用一份数据。
        <strong>token 只存在这台设备上</strong>，不进代码、不进仓库——
        网页是公开的，写在里面等于没设防。</div>
      <div class="pad">
        <input class="line-edit" id="ghToken" type="password"
               placeholder="github_pat_..." autocomplete="off">
      </div>
      <div class="pad"><button class="btn-primary" data-cloud-on>连上</button></div>
    </section>`;
}

/* ---------- 弹层：记一次探店 ---------- */

const QUICK_TAGS = ['好吃', '量大', '踩雷', '别再点', '送得快', '有点咸', '分量足'];

/** 一条探店记录最多几张照片。每张压到 400px 约 30~45KB，9 张也就三百来 KB。 */
const MAX_VISIT_IMAGES = 9;

/**
 * 这家店以前点过的菜名，次数多的排前面。
 *
 * 记一次要重新打一遍「辣子鸡」纯属浪费——去第二次肯定还是那几样。
 * visitsOf 已经按时间倒序，所以顺着抄一遍自然就是「最近吃的在前」。
 * 同名只留一次，已在本次记录里的由调用处过滤。
 */
function dishSuggest(shopId) {
  if (!shopId) return [];
  const seen = new Set(), out = [];
  store.visitsOf(shopId).forEach(v => (v.dishes || []).forEach(d => {
    const n = d && d.name;
    if (n && !seen.has(n)) { seen.add(n); out.push(n); }
  }));
  return out;
}

/**
 * 探店记录的表单区。
 *
 * 建店时的「第一次」和店里的「记一次 / 改这次」是同一套东西，
 * 抽出来是为了只写一遍。pfx 是 id 前缀——两处同时存在于页面上时不会撞。
 * shopId 给了才会列「以前点过的菜」，建新店时传 null 就行。
 *
 * 返回 { el, read, touched }：
 *   read()   取当前填的值，交给 store
 *   touched  用户有没有动过这里。建店时用它判断该不该顺手建第一条记录：
 *             一个字段都没碰就只建店，不硬塞一条空记录进去。
 */
function makeVisitFields(pfx, seed = {}, shopId = null) {
  const el = document.createElement('div');
  el.className = 'vfields';

  const WORDS = { 1: '难下的咽', 2: '不太行', 3: '一般般', 4: '还不错', 5: '很好吃' };
  let rating = seed.rating != null ? Number(seed.rating) : 4;
  let images = Array.isArray(seed.images) ? seed.images.slice() : [];
  let dishes = Array.isArray(seed.dishes) ? seed.dishes.slice() : [];
  const picked = new Set(Array.isArray(seed.tags) ? seed.tags : []);
  let touched = false;
  const mark = () => { touched = true; };

  const seedDate = seed.date || today();
  /* 以前在这家点过的菜，点一下就能加，省得每次重新打字 */
  const suggest = dishSuggest(shopId);

  el.innerHTML = `
    <div class="field">
      <label>什么时候去的</label>
      <input id="${pfx}Date" type="date" value="${esc(seedDate)}" max="${today()}">
    </div>

    <div class="field">
      <label>人均花了多少（可留空）</label>
      <input id="${pfx}Price" type="number" step="1" min="0" inputmode="decimal"
             placeholder="例：32"
             value="${seed.price != null ? esc(String(seed.price)) : ''}">
    </div>

    <div class="field">
      <label>这次吃得怎么样</label>
      <div class="star-pick" id="${pfx}Stars">
        ${[1, 2, 3, 4, 5].map(i => `<button type="button" data-star="${i}" class="${i <= rating ? 'on' : ''}">★</button>`).join('')}
      </div>
      <div class="star-word" id="${pfx}Word">${WORDS[rating]}</div>
    </div>

    <div class="field">
      <label>这次吃了什么（可留空）</label>
      <div class="dish-add">
        <input id="${pfx}Dish" placeholder="例：辣子鸡、肥肠、藕汤" autocomplete="off">
        <button type="button" class="btn-ghost btn-sm" id="${pfx}DishAdd">加上</button>
      </div>
      <div class="dish-suggest" id="${pfx}DishSuggest"></div>
      <div class="dish-list" id="${pfx}Dishes"></div>
    </div>

    <div class="field">
      <label>一句话（下次就靠这句想起来）</label>
      <textarea id="${pfx}Text" rows="2" placeholder="例：汤很足，鸡肉不柴。下次还来。">${esc(seed.text || '')}</textarea>
    </div>

    <div class="field">
      <label>快速标签（可多选）</label>
      <div class="tag-pick" id="${pfx}Tags">
        ${QUICK_TAGS.map(t => `<button type="button" class="tag-opt ${picked.has(t) ? 'on' : ''}" data-tag="${t}">${t}</button>`).join('')}
      </div>
    </div>

    <div class="field">
      <label>照片（最多 ${MAX_VISIT_IMAGES} 张，会自动压小）</label>
      <div class="visit-pick" id="${pfx}Imgs"></div>
      <!-- 必须是 label：系统选图框是让 <label for="picInput"> 触发的。
           这里要是写成 <button>，点它只会登记回调，照片库根本不会弹出来。 -->
      <label class="link-btn" for="picInput" id="${pfx}Add">＋ 再加一张</label>
    </div>`;

  const q = sel => el.querySelector(sel);

  const paintStars = () => {
    el.querySelectorAll('[data-star]').forEach(b =>
      b.classList.toggle('on', Number(b.dataset.star) <= rating));
    q(`#${pfx}Word`).textContent = WORDS[rating];
  };

  /* 一道菜 = 菜名 + 自己的星级 + 一句话。
     星级可以不打（rating 是 null），那就不画星，别拿 1 星顶替——
     「没打分」和「打了低分」是两回事，跟店总分一个道理。 */
  const paintDishes = () => {
    q(`#${pfx}Dishes`).innerHTML = dishes.map((d, i) => `
      <div class="dish-row">
        <div class="dish-row-head">
          <span class="dish-name">${esc(d.name)}</span>
          <span class="dish-stars">${[1, 2, 3, 4, 5].map(n => `
            <button type="button" class="${d.rating != null && n <= d.rating ? 'on' : ''}"
                    data-dstar="${n}" data-di="${i}" title="打 ${n} 星">★</button>`).join('')}</span>
          <button type="button" class="dish-del" data-rmdish="${i}" title="删掉这道菜">✕</button>
        </div>
        <input class="dish-note" data-dnote="${i}" autocomplete="off"
               placeholder="这道菜怎么样（可留空）" value="${esc(d.text || '')}">
      </div>`).join('');
    paintSuggest();
  };

  /* 以前点过的菜，点一下直接加进来。已经加过的不再列。 */
  const paintSuggest = () => {
    const box = q(`#${pfx}DishSuggest`);
    if (!box) return;
    const have = new Set(dishes.map(d => d.name));
    const rest = suggest.filter(n => !have.has(n));
    box.innerHTML = rest.length
      ? `<span class="dim">以前点过</span>${rest.map(n =>
          `<button type="button" class="tag-opt" data-suggest="${esc(n)}">${esc(n)}</button>`).join('')}`
      : '';
  };

  const paintImgs = () => {
    q(`#${pfx}Imgs`).innerHTML = images.map((src, i) => `
      <div class="vimg">
        <img src="${esc(src)}" alt="">
        <button type="button" data-rmimg="${i}" title="删掉">✕</button>
      </div>`).join('');
    q(`#${pfx}Add`).hidden = images.length >= MAX_VISIT_IMAGES;
  };

  const addDish = (given) => {
    const inp = q(`#${pfx}Dish`);
    const raw = given != null ? given : inp.value;
    // 顿号逗号换行都能分隔，顺手一次写几个也行
    const parts = String(raw || '').split(/[,，、\n]/)
      .map(x => x.trim()).filter(Boolean);
    if (!parts.length) return;
    /* 重名的菜直接跳过：同一家去两次都点「辣子鸡」，
       第二次再排一行出来看着像点了两道，星级还得分两份。 */
    parts.forEach(n => {
      if (dishes.some(d => d.name === n)) return;
      dishes.push({ name: n, rating: null, text: '' });
    });
    inp.value = '';
    mark();
    paintDishes();
  };

  paintStars();
  paintDishes();
  paintImgs();

  el.addEventListener('click', e => {
    const s = e.target.closest('[data-star]');
    if (s) { rating = Number(s.dataset.star); mark(); return paintStars(); }

    /* 菜品的星级。点同一个星再一下就取消打分——
       跟「这家值不值」一个手感，不然想改成「没打过分」只能全删了重来。 */
    const ds = e.target.closest('[data-dstar]');
    if (ds) {
      const d = dishes[Number(ds.dataset.di)];
      if (d) {
        const n = Number(ds.dataset.dstar);
        d.rating = d.rating === n ? null : n;
        mark();
        paintDishes();
      }
      return;
    }

    const sg = e.target.closest('[data-suggest]');
    if (sg) return addDish(sg.dataset.suggest);

    const g = e.target.closest('[data-tag]');
    if (g) {
      const t = g.dataset.tag;
      picked.has(t) ? picked.delete(t) : picked.add(t);
      g.classList.toggle('on', picked.has(t));
      return mark();
    }

    const rd = e.target.closest('[data-rmdish]');
    if (rd) { dishes.splice(Number(rd.dataset.rmdish), 1); return paintDishes(); }

    const ri = e.target.closest('[data-rmimg]');
    if (ri) { images.splice(Number(ri.dataset.rmimg), 1); return paintImgs(); }

    if (e.target.id === `${pfx}DishAdd`) return addDish();

    if (e.target.id === `${pfx}Add`) {
      if (images.length >= MAX_VISIT_IMAGES) return;
      return pickImage(async r => {
        if (!r) return;
        if (!r.ok) return toast(r.error, 3000);
        images.push(r.url);
        mark();
        paintImgs();
      });
    }
  });

  /* 菜品框里回车就是「加上」，不用去够按钮 */
  q(`#${pfx}Dish`).addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    addDish();
  });

  ['Date', 'Price', 'Text'].forEach(k =>
    q(`#${pfx}${k}`).addEventListener('input', mark));

  /* 菜品那句话只往内存里写，不重画列表。
     重画会把整个列表的 innerHTML 换掉，正在输入的那个框被抽走，
     打到一半就失焦——这是「边打字边丢焦点」最常见的成因。 */
  el.addEventListener('input', e => {
    const n = e.target.closest('[data-dnote]');
    if (!n) return;
    const d = dishes[Number(n.dataset.dnote)];
    if (d) { d.text = e.target.value; mark(); }
  });

  return {
    el,
    touched: () => touched,
    read: () => ({
      date: q(`#${pfx}Date`).value || today(),
      rating,
      // 原样交给 store.normPrice：空串 -> null（没填），"0" -> 0（真的是 0 元）。
      // 这里要是写成 Number(x) || 0，空着也会存成 0，界面上就显示成「人均 ¥0」。
      price: q(`#${pfx}Price`).value,
      text: q(`#${pfx}Text`).value.trim(),
      tags: [...picked],
      images,
      dishes,
    }),
  };
}

/**
 * 店里的「记一次」/「改这条」。
 * 传 visitId 就是改那一条，不传就是新记一条。
 */
function openVisitSheet(shopId, visitId) {
  const shop = store.shop(shopId);
  if (!shop) return;

  const editing = visitId ? store.visit(visitId) : null;
  if (visitId && !editing) return;

  /* 新增时默认填上次的分：多半这次感受差不多，少点一下。日期重置成今天。 */
  const last = editing || store.lastVisitOf(shopId);

  const sheet = document.createElement('div');
  sheet.className = 'sheet-mask';
  sheet.innerHTML = `
    <div class="sheet">
      <div class="sheet-head">
        ${mascot(LULU.face, 'sheet-mascot')}
        <div><div class="sheet-name">${editing ? '改这条记录' : `在「${esc(shop.name)}」记一次`}</div>
        <div class="dim">${editing ? '改了点保存就行' : '去一次记一条，以前的不动'}</div></div>
      </div>
      <div class="visit-slot"></div>
      <button class="btn-primary" id="confirmVisit">${editing ? '保存修改' : '保存这条记录'}</button>
      <button class="btn-ghost" id="cancelVisit">取消</button>
    </div>`;

  document.body.appendChild(sheet);

  const vf = makeVisitFields('vs', {
    date: editing ? editing.date : today(),
    rating: last ? last.rating : 4,
    price: last ? priceOf(last) : null,
    text: editing ? editing.text : '',
    tags: editing ? editing.tags : (last ? last.tags : []),
    images: editing ? editing.images : [],
    dishes: editing ? editing.dishes : [],
  }, shopId);
  sheet.querySelector('.visit-slot').appendChild(vf.el);

  sheet.addEventListener('click', e => {
    if (e.target === sheet || e.target.id === 'cancelVisit') return sheet.remove();

    if (e.target.id === 'confirmVisit') {
      try {
        if (editing) store.updateVisit(editing.id, vf.read());
        else store.addVisit({ shopId, ...vf.read() });
        sheet.remove();
        render();
      } catch (err) {
        toast(err.message, 4500);
      }
    }
  });
}


/* ---------- 弹层：记店 / 记菜 ---------- */

/**
 * 「＋ 探店」：建店 + 第一条记录，一步做完。
 *
 * 刚吃到一家，想记的时候人就在店里——让他先建店、再点「记一次」、再填一遍店名，
 * 中间那一步纯属折磨。所以第一次的情况直接跟着这个弹层一起填。
 * 记录区一个字段都没碰的话，就只建店，不塞一条空记录进去。
 */
function openShopSheet() {
  const sheet = document.createElement('div');
  sheet.className = 'sheet-mask';
  sheet.innerHTML = `
    <div class="sheet">
      <div class="sheet-head">
        ${mascot(LULU.cooking, 'sheet-mascot')}
        <div><div class="sheet-name">记一家新店</div>
        <div class="dim">刚吃到的那家，顺手记下来</div></div>
      </div>

      <div class="field">
        <label>店名</label>
        <input id="nsName" placeholder="例：巷口黄焖鸡">
      </div>

      <div class="field">
        <label>分类（可留空）</label>
        <input id="nsCat" placeholder="例：快餐简餐">
      </div>

      <div class="field">
        <label>备注（可留空）</label>
        <input id="nsNote" placeholder="例：配送快 / 别点微辣">
      </div>

      <div class="sheet-split">第一次去的情况</div>
      <div class="hint">不填也行，那就只建个空档案，以后再补。</div>
      <div class="visit-slot"></div>

      <button class="btn-primary" id="nsOk">保存</button>
      <button class="btn-ghost" id="nsCancel">取消</button>
    </div>`;

  document.body.appendChild(sheet);

  const vf = makeVisitFields('nv', { rating: 4 });
  sheet.querySelector('.visit-slot').appendChild(vf.el);

  sheet.addEventListener('click', e => {
    if (e.target === sheet || e.target.id === 'nsCancel') return sheet.remove();

    if (e.target.id === 'nsOk') {
      const name = sheet.querySelector('#nsName').value.trim();
      if (!name) return toast('先填店名');

      try {
        const shop = store.addShop({
          name,
          category: sheet.querySelector('#nsCat').value.trim(),
          note: sheet.querySelector('#nsNote').value.trim(),
        });
        /* 记录区被碰过才建记录。用户只想先把店存下来的时候不该被塞一条空数据。 */
        if (vf.touched()) store.addVisit({ shopId: shop.id, ...vf.read() });
        sheet.remove();
        render();
        if (vf.touched()) toast(`「${name}」记好了`);
      } catch (err) {
        toast(err.message, 4500);
      }
    }
  });
}

/* ============================================================
   事件绑定
   ============================================================ */

document.addEventListener('click', e => {
  const t = e.target.closest('[data-go],[data-delshop],[data-addshop],[data-visit],[data-delvisit],[data-editvisit],[data-toggleedit],[data-score],[data-vsort],[data-cloud-on],[data-cloud-off],[data-sync-now]');
  if (!t) return;

  if (t.dataset.go)        return go(t.dataset.go);
  if (t.dataset.visit)     return openVisitSheet(t.dataset.visit);
  /* 删要在编辑前面：记录行整体可点，「删」在行里面，
     万一两个属性落到同一个元素上，先命中的一定得是删除。 */
  if (t.dataset.delvisit) {
    const v = store.visit(t.dataset.delvisit);
    if (!v) return;
    if (!confirm(`删掉 ${v.date} 这条记录？删不回来。`)) return;
    return store.removeVisit(t.dataset.delvisit) ?? render();
  }
  if (t.dataset.editvisit) return openVisitSheet(current.params[0], t.dataset.editvisit);

  if (t.hasAttribute('data-toggleedit')) {
    const id = current.params[0];
    if (!id) return;
    editingId = editingId === id ? null : id;
    return render();
  }

  /* 店铺总评分：点第 n 颗就是 n 分，再点同一颗取消。
     「没打过分」是有意义的状态——它跟「打了低分」不是一回事，
     所以能取消回去，不能用 0 代替。 */
  if (t.dataset.score) {
    const shop = store.shop(current.params[0]);
    if (!shop) return;
    const n = Number(t.dataset.score);
    store.updateShop(shop.id, { score: shop.score === n ? null : n });
    return render();
  }

  if (t.dataset.delshop) {
    const s = store.shop(t.dataset.delshop);
    if (!s) return;
    const n = store.visitsOf(s.id).length;
    if (!confirm(`删掉「${s.name}」？\n\n${n ? `这家店的 ${n} 条探店记录会一起没了，删不回来。` : ''}`)) return;
    store.removeShop(s.id);
    if (editingId === s.id) editingId = null;
    toast('已删掉');
    return go('/');
  }

  if (t.hasAttribute('data-cloud-on')) {
    const inp = document.querySelector('#ghToken');
    const v = inp ? inp.value.trim() : '';
    if (!v) return toast('先填 token');
    const on = enableSync(v);
    if (inp) inp.value = '';              // 填完就从输入框清掉，别留在页面上
    toast(on ? '已连上，正在拉取云端数据' : 'token 无效或没权限');
    return render();
  }

  if (t.hasAttribute('data-cloud-off')) {
    disconnectSync();
    toast('已断开，这台设备只存本地');
    return render();
  }

  if (t.hasAttribute('data-sync-now')) {
    toast('正在同步…');
    return syncNow().then(ok => toast(ok ? '已同步' : '这次没变化'));
  }

  if (t.dataset.vsort) {
    visitSort = t.dataset.vsort;
    return render();
  }

  if (t.hasAttribute('data-addshop')) {
    return openShopSheet();
  }
});

/* 文本框：输入即存（去抖 400ms）。
   不用 change 事件——那样「打完字直接点星星」会因为没失焦而丢掉输入。

   计时器按元素分开存，不是共用一个：共用的话，在 A 打完字 300ms 内切到 B 再打字，
   A 的那次保存会被 B 的计时器顶掉，A 输的东西就没了。 */
const saveTimers = new WeakMap();

document.addEventListener('input', e => {
  const t = e.target;

  clearTimeout(saveTimers.get(t));
  saveTimers.set(t, setTimeout(() => {
    if (t.dataset.shname) store.updateShop(t.dataset.shname, { name: t.value });
    if (t.dataset.shcat)  store.updateShop(t.dataset.shcat,  { category: t.value });
    if (t.dataset.shsum)  store.updateShop(t.dataset.shsum,  { summary: t.value });
    if (t.dataset.shnote) store.updateShop(t.dataset.shnote, { note: t.value });
  }, 400));
});

/* 记录行现在是 role="button"，键盘得能走通。
   只认 Enter / 空格——方向键留给正常滚动，不然没法上下看记录。

   必须要求 e.target 就是记录行本身：行里还嵌着「删」按钮，
   它也在这行的 tab 序列里。要是只看 closest('[data-editvisit]')，
   在「删」上按回车会被这里的 preventDefault 吃掉按钮的原生激活，
   删不掉，反倒把编辑弹层开起来了。 */
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const t = e.target.closest && e.target.closest('[data-editvisit]');
  if (!t || e.target !== t) return;
  e.preventDefault();
  openVisitSheet(current.params[0], t.dataset.editvisit);
});

/* ============================================================
   公共片段 & 底部导航
   ============================================================ */

/**
 * 空状态。btnAttr 可以换成别的动作（比如 data-addshop 直接开记店弹层），
 * 传了就优先用它，不再按 data-go 跳。
 */
function emptyState(title, sub, goPath, btnText, img, extra = '', btnAttr = '') {
  const btn = btnAttr
    ? `<button class="btn-primary" ${btnAttr}>${esc(btnText)}</button>`
    : `<button class="btn-primary" data-go="${goPath}">${esc(btnText)}</button>`;
  return `
    <div class="empty">
      ${img ? `<div class="empty-art"><img src="${img}" alt="" class="empty-img"></div>` : ''}
      <h2>${esc(title)}</h2>
      <p>${esc(sub)}</p>
      ${btn}
    </div>
    ${extra}`;
}

function paintTabbar() {
  const active = (current.path === '/' || current.path === '/shop') ? 'shops' : 'manage';
  document.querySelectorAll('.tabbar a').forEach(a => {
    a.classList.toggle('on', a.dataset.tab === active);
  });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

window.addEventListener('hashchange', render);
render();
