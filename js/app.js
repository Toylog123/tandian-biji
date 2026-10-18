import { store, TIERS, today,
         cloudConfigured, enableSync, disconnectSync, syncNow } from './store.js';
import { compressImage, usage } from './img.js';
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

/* 管理页当前选中的店铺。放在模块作用域——parseHash() 每次都会返回新的
   params 数组，写在 current.params 上会在下一次 render 时丢失。 */
let manageShop = null;

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
            : '还没有店，去「管理」里记一家'
        }</span>
      </div>
    </div>`;

  if (!shops.length) {
    return banner + emptyState(
      '还没记过任何一家店', '吃完顺手记一条，下次就有底了',
      '/manage', '去记店', LULU.cooking);
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
          ${last ? `<span>去过 ${times} 次 · 最近 ${prettyDate(last.date)}</span>` : ''}
        </div>
        ${s.summary
          ? `<div class="shop-note">${esc(s.summary)}</div>`
          : `<div class="shop-note dim">还没写一句话总结</div>`}
      </div>
      <div class="shop-go">›</div>
    </button>`;
}

/** 'YYYY-MM-DD' -> '10/12'；今年的就省去年份 */
function prettyDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, m, d] = iso.split('-');
  return (+y === new Date().getFullYear()) ? `${+m}/${+d}` : `${y.slice(2)}/${+m}/${+d}`;
}


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
    </div>

    ${shop.summary ? `<div class="summary-box">${esc(shop.summary)}</div>` : ''}
    ${shop.note ? `<div class="notice">📌 ${esc(shop.note)}</div>` : ''}

    ${visitSection(shop)}`;
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
        <div class="visit">
          <div class="visit-head">
            ${ratingArt(v.rating, 'visit-mood', v.id)}
            <div class="rev-stars">${stars(v.rating)}</div>
            <div class="visit-date">${esc(v.date || '')}${priceOf(v) !== null ? ` · 人均 ¥${priceOf(v)}` : ''}</div>
            <button class="link-del" data-delvisit="${v.id}">删</button>
          </div>
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

/* ============================================================
   页面 3：管理（只有我会用）
   ============================================================ */

/**
 * 当前选中店铺的资料：店名、分类、总结、备注。
 * 都是「输入即存」，改完直接落库，不点保存。
 */
function shopSettings(shop) {
  return `
    <section class="block">
      <h2 class="block-title">店铺设置 <span class="dim">改完自动保存</span></h2>
      <div class="mng-row col">
        <input class="line-edit" value="${esc(shop.name)}" data-shname="${shop.id}" placeholder="店名">
        <input class="line-edit" value="${esc(shop.category || '')}"
               data-shcat="${shop.id}" placeholder="分类：快餐简餐 / 烧烤 / 甜品">
        <textarea class="line-edit summary-edit" rows="2" data-shsum="${shop.id}"
          placeholder="一句话总结：这家到底行不行？下次靠这句想起来">${esc(shop.summary || '')}</textarea>
        <input class="line-edit" value="${esc(shop.note || '')}" data-shnote="${shop.id}"
               placeholder="备注：配送快 / 别点微辣">
      </div>
    </section>`;
}

function renderManage() {
  const shops = store.shops();
  if (!manageShop || !shops.some(s => s.id === manageShop)) manageShop = shops[0]?.id || '';
  const tab = manageShop;

  return `
    <div class="page-head">
      ${mascot()}
      <div>
        <div class="shop-title">管理</div>
        <div class="shop-sub">记店、写总结、改设置，只有你会用到</div>
      </div>
      ${syncChip()}
      <button class="btn-primary btn-sm" data-addshop>＋ 记店</button>
    </div>

    ${cloudPanel()}

    <section class="block">
      <h2 class="block-title">我的店 <span class="dim">${shops.length}</span></h2>
      ${shops.map(s => {
        const t = store.tierOf(s.id);
        return `
        <div class="mng-row ${s.id === tab ? 'on' : ''}">
          <button class="mng-pick" data-pick="${s.id}">
            <strong>${esc(s.name)}</strong>
            <span class="dim">${t ? `${t.emoji} ${t.label} · ${store.avgRating(s.id)} ★ · ${store.visitsOf(s.id).length} 次` : '还没记过'}</span>
          </button>
          <button class="link-del" data-delshop="${s.id}">删</button>
        </div>`;
      }).join('') || `<div class="dim pad">还没有店</div>`}
    </section>

    ${tab && store.shop(tab) ? shopSettings(store.shop(tab)) : ''}

    <div class="pad dim">已用 ${usage().usedMB} MB，还能再放大约 ${usage().approxLeft} 张照片。</div>`;
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

function openVisitSheet(shopId) {
  const shop = store.shop(shopId);
  if (!shop) return;

  const last = store.lastVisitOf(shopId);
  // 默认填上次的分：多半这次感受差不多，少点一下。但日期要重置成今天。
  let rating = last ? last.rating : 4;
  let images = [];
  const picked = new Set(last ? last.tags : []);

  const sheet = document.createElement('div');
  sheet.className = 'sheet-mask';
  sheet.innerHTML = `
    <div class="sheet">
      <div class="sheet-head">
        ${mascot(LULU.face, 'sheet-mascot')}
        <div><div class="sheet-name">在「${esc(shop.name)}」记一次</div>
        <div class="dim">去一次记一条，以前的不动</div></div>
      </div>

      <div class="field">
        <label>什么时候去的</label>
        <input id="vsDate" type="date" value="${today()}" max="${today()}">
      </div>

      <div class="field">
        <label>人均花了多少（可留空）</label>
        <input id="vsPrice" type="number" step="1" min="0" inputmode="decimal"
               placeholder="例：32" value="${last && priceOf(last) !== null ? priceOf(last) : ''}">
      </div>

      <div class="field">
        <label>这次吃得怎么样</label>
        <div class="star-pick" id="starPick">
          ${[1, 2, 3, 4, 5].map(i => `<button data-star="${i}" class="${i <= rating ? 'on' : ''}">★</button>`).join('')}
        </div>
        <div class="star-word" id="starWord">还不错</div>
      </div>

      <div class="field">
        <label>快速标签（可多选）</label>
        <div class="tag-pick" id="tagPick">
          ${QUICK_TAGS.map(t => `<button class="tag-opt ${picked.has(t) ? 'on' : ''}" data-tag="${t}">${t}</button>`).join('')}
        </div>
      </div>

      <div class="field">
        <label>一句话（下次就靠这句想起来）</label>
        <textarea id="vsText" rows="2" placeholder="例：汤很足，鸡肉不柴。下次还来。"></textarea>
      </div>

      <div class="field">
        <label>照片（最多 ${MAX_VISIT_IMAGES} 张，会自动压小）</label>
        <div class="visit-pick" id="vsImgs"></div>
        <!-- 必须是 label：系统选图框是让 <label for="picInput"> 触发的。
             这里要是写成 <button>，点它只会登记回调，照片库根本不会弹出来。 -->
        <label class="link-btn" for="picInput" id="vsAdd">＋ 再加一张</label>
      </div>

      <button class="btn-primary" id="confirmVisit">保存这条记录</button>
      <button class="btn-ghost" id="cancelVisit">取消</button>
    </div>`;

  document.body.appendChild(sheet);

  const WORDS = { 1: '难以下咽', 2: '不太行', 3: '一般般', 4: '还不错', 5: '很好吃' };

  const paintStars = () => {
    sheet.querySelectorAll('[data-star]').forEach(b =>
      b.classList.toggle('on', Number(b.dataset.star) <= rating));
    sheet.querySelector('#starWord').textContent = WORDS[rating];
  };

  const gallery = sheet.querySelector('#vsImgs');
  const addBtn = sheet.querySelector('#vsAdd');
  const paintImgs = () => {
    gallery.innerHTML = images.map((src, i) => `
      <div class="vimg">
        <img src="${esc(src)}" alt="">
        <button data-rmimg="${i}" title="删掉">✕</button>
      </div>`).join('');
    addBtn.hidden = images.length >= MAX_VISIT_IMAGES;
  };
  paintImgs();

  sheet.addEventListener('click', e => {
    if (e.target === sheet || e.target.id === 'cancelVisit') return sheet.remove();

    const s = e.target.closest('[data-star]');
    if (s) { rating = Number(s.dataset.star); return paintStars(); }

    const g = e.target.closest('[data-tag]');
    if (g) {
      const t = g.dataset.tag;
      picked.has(t) ? picked.delete(t) : picked.add(t);
      g.classList.toggle('on', picked.has(t));
      return;
    }

    const rm = e.target.closest('[data-rmimg]');
    if (rm) { images.splice(Number(rm.dataset.rmimg), 1); return paintImgs(); }

    if (e.target.id === 'vsAdd') {
      if (images.length >= MAX_VISIT_IMAGES) return;
      return pickImage(async r => {
        if (!r) return;
        if (!r.ok) return toast(r.error, 3000);
        images.push(r.url);
        paintImgs();
      });
    }

    if (e.target.id === 'confirmVisit') {
      try {
        store.addVisit({
          shopId,
          date: sheet.querySelector('#vsDate').value || today(),
          rating,
          // 原样交给 store.normPrice：空串 -> null（没填），"0" -> 0（真的是 0 元）。
          // 这里要是写成 Number(x) || 0，空着也会存成 0，界面上就显示成「人均 ¥0」。
          price: sheet.querySelector('#vsPrice').value,
          text: sheet.querySelector('#vsText').value.trim(),
          tags: [...picked],
          images,
        });
        sheet.remove();
        render();
      } catch (err) {
        toast(err.message, 4500);
      }
    }
  });

  paintStars();
}


/* ---------- 弹层：记店 / 记菜 ---------- */

function openForm(title, fields, onSubmit) {
  const sheet = document.createElement('div');
  sheet.className = 'sheet-mask';
  sheet.innerHTML = `
    <div class="sheet">
      <div class="sheet-head"><div class="sheet-name">${esc(title)}</div></div>
      ${fields.map(f => `
        <div class="field">
          <label>${esc(f.label)}</label>
          ${f.options
            ? `<select id="f_${f.key}">${f.options.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select>`
            : `<input id="f_${f.key}" placeholder="${esc(f.ph || '')}" type="${f.type || 'text'}">`}
        </div>`).join('')}
      <button class="btn-primary" id="formOk">保存</button>
      <button class="btn-ghost" id="formCancel">取消</button>
    </div>`;

  document.body.appendChild(sheet);
  sheet.addEventListener('click', e => {
    if (e.target === sheet || e.target.id === 'formCancel') return sheet.remove();
    if (e.target.id === 'formOk') {
      const data = {};
      fields.forEach(f => { data[f.key] = sheet.querySelector('#f_' + f.key).value.trim(); });
      onSubmit(data);
      sheet.remove();
      render();
    }
  });
}

/* ---------- 弹层：记菜（自带图片槽，所以没用通用的 openForm） ---------- *//* ============================================================
   事件绑定
   ============================================================ */

document.addEventListener('click', e => {
  const t = e.target.closest('[data-go],[data-pick],[data-delshop],[data-addshop],[data-visit],[data-delvisit],[data-vsort],[data-cloud-on],[data-cloud-off],[data-sync-now]');
  if (!t) return;

  if (t.dataset.go)        return go(t.dataset.go);
  if (t.dataset.visit)     return openVisitSheet(t.dataset.visit);
  if (t.dataset.delvisit)  return store.removeVisit(t.dataset.delvisit) ?? render();
  if (t.dataset.pick)    { manageShop = t.dataset.pick; return render(); }
  if (t.dataset.delshop)   return store.removeShop(t.dataset.delshop) ?? render();

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
    return openForm('记一家新店', [
      { key: 'name',     label: '店名',     ph: '例：巷口黄焖鸡' },
      { key: 'category', label: '分类',     ph: '例：快餐简餐' },
      { key: 'note',     label: '备注',     ph: '例：配送快 / 别点微辣' },
    ], d => store.addShop(d));
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

/* ============================================================
   公共片段 & 底部导航
   ============================================================ */

function emptyState(title, sub, goPath, btnText, img, extra = '') {
  return `
    <div class="empty">
      ${img ? `<div class="empty-art"><img src="${img}" alt="" class="empty-img"></div>` : ''}
      <h2>${esc(title)}</h2>
      <p>${esc(sub)}</p>
      <button class="btn-primary" data-go="${goPath}">${esc(btnText)}</button>
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
