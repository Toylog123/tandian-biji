import { store, money } from './store.js';
import { compressImage, usage } from './img.js';
import * as backend from './backend.js';

/* 云端拉下来的数据到了就重画；同步状态变了只改那一个小圆点，不整页重画
   ——整页重画会把正在输入的框冲掉，打字打到一半焦点就没了。 */
store.onChange(render);

let syncState = 'local';
backend.onStatus(s => {
  syncState = s;
  paintSync();
});

function syncLabel() {
  if (!store.shared) return '仅本机';
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
  '/order':  renderOrder,
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

/* ============================================================
   去下单：唤起 App，失败回退网页
   ============================================================ */

/**
 * 点一下就去下单。
 *
 * 优先试 scheme 唤起 App（手机上装了美团/饿了么就能直接落到 App 里）。
 * 浏览器没法告诉我们「唤起成功还是失败」，只能靠约定：
 * 唤起成功 → 本页被切到后台（visibilitychange 变 hidden）→ 取消回退；
 * 1.6 秒后本页还在前台 → 大概率没装 App，回退网页版。
 */
function jumpToOrder(shop) {
  const e = store.entryOf(shop);
  if (e.kind === 'none') {
    return alert(`「${shop.name}」既没填店铺链接，平台也没识别到。\n\n` +
                  '去 ⚙️ 管理 → 选这家店 → 「店铺设置」里填一个链接。');
  }

  // 用户自己贴了链接，一律直接开新标签，不做任何自动跳转
  if (e.kind === 'custom') {
    window.open(e.web, '_blank', 'noopener');
    return;
  }

  let left = false;
  const timer = setTimeout(() => {
    if (!left && document.visibilityState === 'visible') window.location.href = e.web;
  }, 1600);

  document.addEventListener('visibilitychange', function onHide() {
    if (document.visibilityState !== 'hidden') return;
    left = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onHide);
  });

  window.location.href = e.app;
}

function platformBtn(shopId, label) {
  const s = store.shop(shopId);
  if (!s) return '';
  const mark = s.link ? '链接' : (s.platform || '平台');
  return `<button class="btn-order" data-jump="${s.id}">${esc(label || '去' + mark + '下单')}</button>`;
}

/** 给人看的「这张店的下单按钮会干什么」 */
function entryLabel(e) {
  if (e.kind === 'custom') return '直接打开你填的链接';
  if (e.kind === 'none')    return '没设置跳转';
  return '先唤起 App，没装就开网页';
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
   页面 1：店铺列表（女朋友最常看的页面）
   ============================================================ */

function renderShops() {
  const shops = store.shops();
  const pending = store.pendingOrder();

  const banner = `
    <div class="banner">
      <img src="assets/lulu-delivering.webp" alt="" class="banner-img">
      <div class="banner-txt">
        <strong>今天想吃点什么？</strong>
        <span>${shops.length ? `已经收录 ${shops.length} 家店` : '还没有店，去「管理」里录一家'}</span>
      </div>
    </div>`;

  const byCat = {};
  shops.forEach(s => { (byCat[s.category || '其他'] ||= []).push(s); });

  const body = Object.keys(byCat).length
    ? Object.entries(byCat).map(([cat, list]) => `
        <section class="block">
          <h2 class="block-title">${esc(cat)} <span class="dim">${list.length} 家</span></h2>
          <div class="shop-list">
            ${list.map(s => {
              const count = store.dishes(s.id).length;
              const avg = store.avgRating(s.id);
              const rc = store.reviewsOf(s.id).length;
              return `
              <button class="shop-card" data-go="/shop/${s.id}">
                <div class="shop-avatar">${esc((s.name || '店').slice(0, 1))}</div>
                <div class="shop-main">
                  <div class="shop-name">${esc(s.name)}</div>
                  <div class="shop-meta">
                    <span class="chip chip-plat">${esc(s.platform)}</span>
                    <span>${count} 道菜</span>
                    ${avg !== null ? `<span class="star">我给 ${avg} ★ · ${rc} 条</span>` : ''}
                  </div>
                  ${s.note ? `<div class="shop-note">${esc(s.note)}</div>` : ''}
                </div>
                <div class="shop-go">›</div>
              </button>`;
            }).join('')}
          </div>
        </section>`).join('')
    : emptyState('还没有收录店铺', '去「管理」里录一家你最爱的外卖', '/manage', '去录店', 'assets/lulu-waiting.webp');

  return `
    ${pending && pending.items.length ? pendingStrip(pending) : ''}
    ${banner}
    ${body}`;
}

function pendingStrip(order) {
  const n = order.items.reduce((s, i) => s + i.qty, 0);
  return `
    <button class="pending-strip" data-go="/order">
      <span>🧾 今天已点了 ${n} 份</span>
      <span class="pending-total">${money(store.total(order))} ›</span>
    </button>`;
}

/* ============================================================
   页面 2：店铺详情 + 点菜
   ============================================================ */

function renderShop([id]) {
  const shop = store.shop(id);
  if (!shop) return emptyState('这家店不见了', '可能已经被删掉了', '/', '回到首页', null);

  const dishes = store.dishes(id);
  const reviews = store.reviewsOf(id);
  const avg = store.avgRating(id);
  const byCat = {};
  dishes.forEach(d => { (byCat[d.tags?.[0] && d.tags[0].startsWith('#') ? d.tags[0] : '全部'] ||= []).push(d); });

  const menu = Object.entries(byCat).map(([cat, list]) => `
    <section class="block">
      <h2 class="block-title">${esc(cat)}</h2>
      ${list.map(d => `
        <div class="dish-row">
          ${dishThumb(d, 'dish-thumb')}
          <div class="dish-main">
            <div class="dish-name">${esc(d.name)}
              ${(d.tags || []).filter(t => !t.startsWith('#')).map(t => `<span class="tag">${esc(t)}</span>`).join('')}
              <span class="dish-price">${money(d.price)}</span>
            </div>
            <div class="dish-rate">${starBar(d)}</div>
            ${d.desc ? `<div class="dish-desc">${esc(d.desc)}</div>` : ''}
          </div>
          <button class="btn-add" data-add="${d.id}">加入</button>
        </div>`).join('')}
    </section>`).join('');

  return `
    <div class="page-head" style="background:var(--yellow)">
      <button class="back" data-go="/">‹</button>
      <div style="flex:1">
        <div class="shop-title">${esc(shop.name)}</div>
        <div class="shop-sub">${esc(shop.platform)} · ${dishes.length} 道菜${avg !== null ? ` · 我给 ${avg} ★（${reviews.length}）` : ''}</div>
      </div>
      ${platformBtn(shop.id)}
    </div>
    ${shop.note ? `<div class="notice">📌 ${esc(shop.note)}</div>` : ''}
    ${dishes.length ? menu : emptyState('这家店还没有菜', '去「管理」里录几道', '/manage', '去录菜', 'assets/lulu-cooking.webp')}
    ${reviewSection(shop)}`;
}

/** 店铺页底部的「我的评价」 */
function reviewSection(shop) {
  const list = store.reviewsOf(shop.id);
  const avg = store.avgRating(shop.id);

  return `
    <section class="block">
      <h2 class="block-title">
        我的评价
        ${avg !== null ? `<span class="avg-chip">${avg} ★</span>` : ''}
        <button class="btn-primary btn-sm" data-review="${shop.id}">
          ${list.length ? '再写一条' : '写评价'}
        </button>
      </h2>

      ${list.length ? list.map(r => {
        const d = new Date(r.createdAt);
        const when = Number.isFinite(d.getFullYear()) && d.getFullYear() > 2000
          ? `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
          : `${d.getMonth() + 1}/${d.getDate()}`;
        return `
        <div class="rev-row">
          <div class="rev-stars">${stars(r.rating)}</div>
          ${r.text ? `<div class="rev-text">${esc(r.text)}</div>` : ''}
          ${(r.tags || []).map(t => `<span class="rev-tag">${esc(t)}</span>`).join('')}
          <div class="rev-when">${when}
            <button class="link-del" data-delrev="${r.id}">删</button>
          </div>
        </div>`;
      }).join('') : `<div class="dim pad">还没评价过。下次吃完顺手写一句，下次就有底了。</div>`}
    </section>`;
}

function stars(n) {
  return Array.from({ length: 5 }, (_, i) =>
    `<span class="${i < n ? 'on' : ''}">★</span>`).join('');
}

/**
 * 菜只认照片：有图就出图，没图给一块中性占位。
 * 之前这里会退回 emoji 图标，但 emoji 看着像菜、点进去不是那家店的菜，
 * 认错了比没有更糟，所以宁可不画。
 */
function dishThumb(d, cls) {
  return d.image
    ? `<img class="${cls}" src="${esc(d.image)}" alt="" loading="lazy">`
    : `<div class="${cls} ph"></div>`;
}

/**
 * 可点的星级条。点第 n 颗 = n 分，再点同一颗取消评分。
 * 两个页面（店铺页、管理页）共用。
 */
function starBar(d) {
  const r = d.rating;
  return `<span class="star-bar" title="点星星打分，再点一次取消">
    ${[1, 2, 3, 4, 5].map(i =>
      `<span class="${r && i <= r ? 'on' : ''}" data-dishstar="${d.id}:${i}">★</span>`).join('')}
    ${r ? '' : '<em class="star-none">未评分</em>'}
  </span>`;
}

/* ============================================================
   页面 3：今日点单清单（我照着这个下单）
   ============================================================ */

function renderOrder() {
  const order = store.pendingOrder();

  if (!order || !order.items.length) {
    const history = store.orders().filter(o => o.status !== 'pending').slice(0, 5);
    return emptyState(
      '今天还没点单',
      '去店铺里挑几道菜',
      '/',
      '去点菜',
      'assets/lulu-waiting.webp',
      history.length ? `
        <section class="block">
          <h2 class="block-title">以前点过</h2>
          ${history.map(o => {
            const n = o.items.reduce((s, i) => s + i.qty, 0);
            const d = new Date(o.createdAt);
            return `<div class="hist-row">
              <div><strong>${n} 份</strong> · ${money(store.total(o))}</div>
              <div class="dim">${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} · ${o.status === 'ordered' ? '已下单' : '已搞定'}</div>
            </div>`;
          }).join('')}
        </section>` : ''
    );
  }

  // 按店铺分组 —— 下单要一家一家来
  const byShop = {};
  order.items.forEach((it, idx) => { (byShop[it.shopName] ||= []).push({ ...it, idx }); });

  const total = store.total(order);

  return `
    <div class="page-head" style="background:var(--yellow)">
      <div>
        <div class="shop-title">今天要点这些</div>
        <div class="shop-sub">${order.items.length} 个菜 · ${order.items.reduce((s, i) => s + i.qty, 0)} 份</div>
      </div>
    </div>

    ${Object.entries(byShop).map(([shopName, items]) => `
      <section class="block">
        <h2 class="block-title">🛵 ${esc(shopName)}</h2>
        ${items.map(it => `
          <div class="order-row">
            ${dishThumb(it, 'order-thumb')}
            <div class="order-main">
              <div class="order-name">${esc(it.name)} ${it.who ? `<span class="who">${esc(it.who)}</span>` : ''}</div>
              <input class="note-edit ${it.note ? 'has' : ''}" placeholder="加个备注：不要辣 / 不要香菜…"
                     value="${esc(it.note)}" data-note="${it.idx}">
            </div>
            <div class="order-right">
              <div class="money">${money(it.price * it.qty)}</div>
              <div class="stepper">
                <button data-minus="${it.idx}">−</button>
                <span>${it.qty}</span>
                <button data-plus="${it.idx}">＋</button>
              </div>
              <button class="link-del" data-del="${it.idx}">删掉</button>
            </div>
          </div>`).join('')}
        <div class="shop-sum">
          <span>这家小计 <strong>${money(items.reduce((s, i) => s + i.price * i.qty, 0))}</strong></span>
          <div class="row-btns">
            ${platformBtn(items[0].shopId)}
            <button class="link-btn" data-review="${items[0].shopId}" data-order="${order.id}">⭐ 评价</button>
          </div>
        </div>
      </section>`).join('')}

    <div class="total-bar">
      <div>
        <div class="dim">合计</div>
        <div class="total-num">${money(total)}</div>
      </div>
      <button class="btn-primary" data-done>去下单了</button>
    </div>
    <button class="btn-ghost" data-clear>全部清空</button>`;
}

/* ============================================================
   页面 4：管理（只有我会用）
   ============================================================ */

function renderManage() {
  const shops = store.shops();
  if (!manageShop || !shops.some(s => s.id === manageShop)) manageShop = shops[0]?.id || '';
  const tab = manageShop;

  return `
    <div class="page-head" style="background:var(--yellow)">
      <div>
        <div class="shop-title">管理</div>
        <div class="shop-sub">录店、录菜，只有你会用到</div>
      </div>
      ${syncChip()}
      <button class="btn-primary btn-sm" data-addshop>＋ 录店</button>
    </div>

    <section class="block">
      <h2 class="block-title">我的店 <span class="dim">${shops.length}</span></h2>
      ${shops.map(s => `
        <div class="mng-row ${s.id === tab ? 'on' : ''}">
          <button class="mng-pick" data-pick="${s.id}">
            <strong>${esc(s.name)}</strong>
            <span class="dim">${esc(s.platform)} · ${store.dishes(s.id).length} 道菜</span>
          </button>
          <button class="link-del" data-delshop="${s.id}">删</button>
        </div>`).join('') || `<div class="dim pad">还没有店</div>`}
    </section>

    ${tab && store.shop(tab) ? shopSettings(store.shop(tab)) : ''}
    ${tab ? dishManager(tab) : ''}`;
}

/**
 * 当前选中店铺的资料，主要是那个「店铺链接」。
 *
 * 链接得自己从美团 App 里拿：店铺页 → 右上角分享 → 复制链接。
 * App 不给网页版暴露稳定的店铺深链，自动拼是拼不出来的，
 * 所以这里做的是「让你贴进来，之后一键直达」。
 */
function shopSettings(shop) {
  return `
    <section class="block">
      <h2 class="block-title">店铺设置 <span class="dim">改完自动保存</span></h2>
      <div class="mng-row col">
        <input class="line-edit" value="${esc(shop.name)}" data-shname="${shop.id}" placeholder="店名">
        <div class="mng-sub">
          <select class="line-edit w-plat" data-shplat="${shop.id}">
            ${['美团', '饿了么', '其他'].map(p =>
              `<option ${p === shop.platform ? 'selected' : ''}>${p}</option>`).join('')}
          </select>
          <input class="line-edit grow" value="${esc(shop.category || '')}"
                 data-shcat="${shop.id}" placeholder="分类">
        </div>
        <input class="line-edit" value="${esc(shop.note || '')}" data-shnote="${shop.id}"
               placeholder="备注：配送快 / 别点微辣">
        <input class="line-edit link-edit" value="${esc(shop.link || '')}" data-shlink="${shop.id}"
               placeholder="店铺链接：从美团 App 店铺页「分享 → 复制链接」粘过来">
        <div class="mng-sub">
          <span class="dim" data-entryhint>下单跳转：${esc(entryLabel(store.entryOf(shop)))}</span>
          <button class="link-btn" data-jump="${shop.id}">试试跳转</button>
        </div>
      </div>
    </section>`;
}

function dishManager(shopId) {
  const shop = store.shop(shopId);
  const dishes = store.allDishes().filter(d => d.shopId === shopId);
  const u = usage();

  return `
    <section class="block">
      <h2 class="block-title">${esc(shop.name)} 的菜
        <button class="btn-primary btn-sm" data-adddish="${shopId}">＋ 录菜</button>
      </h2>
      ${dishes.map(d => `
        <div class="mng-row col">
          <div class="mng-top">
            <div class="img-slot">
              ${dishThumb(d, 'thumb')}
              <label class="img-btn" for="picInput" data-pic="${d.id}" title="换图片">📷</label>
              ${d.image ? `<button class="img-btn clear" data-unpic="${d.id}" title="删掉图片">✕</button>` : ''}
            </div>
            <input class="line-edit" value="${esc(d.name)}" data-dname="${d.id}" placeholder="菜名">
          </div>
          <textarea class="line-edit desc-edit" rows="2" data-ddesc="${d.id}"
                    placeholder="怎么点？什么口味？忌口…（她点菜时会看到）">${esc(d.desc || '')}</textarea>
          <div class="mng-sub">
            <input class="line-edit w-price" type="number" step="0.5" value="${d.price}" data-dprice="${d.id}">
            <label class="chk"><input type="checkbox" ${d.available !== false ? 'checked' : ''} data-davail="${d.id}"> 在售</label>
            <button class="link-del" data-deldish="${d.id}">删</button>
          </div>
          <div class="mng-sub">${starBar(d)}</div>
        </div>`).join('') || `<div class="dim pad">这家还没有菜</div>`}
      <p class="tip">
        已用 ${u.usedMB} MB，还够放大约 ${u.approxLeft} 张图。<br>
        菜名、价格、描述、星级、上下架，直接改就自动保存。
      </p>
    </section>`;
}

/* ============================================================
   添加弹层
   ============================================================ */

function openAddSheet(dishId) {
  const d = store.allDishes().find(x => x.id === dishId);
  if (!d) return;

  const people = store.people();
  const sheet = document.createElement('div');
  sheet.className = 'sheet-mask';
  sheet.innerHTML = `
    <div class="sheet">
      <div class="sheet-head">
        ${dishThumb(d, 'dish-thumb sm')}
        <div>
          <div class="sheet-name">${esc(d.name)}</div>
          <div class="dim">${money(d.price)} · ${esc((store.shop(d.shopId) || {}).name || '')}</div>
        </div>
      </div>

      <div class="field">
        <label>要几份</label>
        <div class="stepper big">
          <button data-q="-1">−</button>
          <span id="qty">1</span>
          <button data-q="1">＋</button>
        </div>
      </div>

      <div class="field">
        <label>谁点的</label>
        <div class="who-pick" id="whoPick">
          ${people.map((p, i) => `<button class="who-opt ${i === 0 ? 'on' : ''}" data-who="${esc(p)}">${esc(p)}</button>`).join('')}
        </div>
      </div>

      <div class="field">
        <label>备注（口味、忌口…）</label>
        <input id="note" placeholder="例：不要辣 / 不要香菜 / 多加辣">
      </div>

      <button class="btn-primary" id="confirmAdd">加入清单</button>
      <button class="btn-ghost" id="cancelAdd">取消</button>
    </div>`;

  document.body.appendChild(sheet);
  let qty = 1, who = people[0];

  sheet.addEventListener('click', e => {
    if (e.target === sheet) sheet.remove();
    const q = e.target.closest('[data-q]');
    if (q) { qty = Math.max(1, qty + Number(q.dataset.q)); sheet.querySelector('#qty').textContent = qty; }
    const w = e.target.closest('[data-who]');
    if (w) {
      who = w.dataset.who;
      sheet.querySelectorAll('.who-opt').forEach(b => b.classList.toggle('on', b === w));
    }
    if (e.target.id === 'cancelAdd') sheet.remove();
    if (e.target.id === 'confirmAdd') {
      store.addToOrder(dishId, qty, sheet.querySelector('#note').value.trim(), who);
      sheet.remove();
      render();
    }
  });
}

/* ---------- 弹层：写评价 ---------- */

const QUICK_TAGS = ['好吃', '量大', '踩雷', '别再点', '送得快', '有点咸', '分量足'];

function openReviewSheet(shopId, orderId) {
  const shop = store.shop(shopId);
  if (!shop) return;

  const sheet = document.createElement('div');
  sheet.className = 'sheet-mask';
  sheet.innerHTML = `
    <div class="sheet">
      <div class="sheet-head">
        <span class="sheet-avatar">${esc((shop.name || '店').slice(0, 1))}</span>
        <div><div class="sheet-name">评价 ${esc(shop.name)}</div>
        <div class="dim">${orderId ? '记在今天这笔单子上' : '补录一条历史评价'}</div></div>
      </div>

      <div class="field">
        <label>这次吃得怎么样</label>
        <div class="star-pick" id="starPick">
          ${[1, 2, 3, 4, 5].map(i => `<button data-star="${i}" class="${i <= 4 ? 'on' : ''}">★</button>`).join('')}
        </div>
        <div class="star-word" id="starWord">还不错</div>
      </div>

      <div class="field">
        <label>快速标签（可多选）</label>
        <div class="tag-pick" id="tagPick">
          ${QUICK_TAGS.map(t => `<button class="tag-opt" data-tag="${t}">${t}</button>`).join('')}
        </div>
      </div>

      <div class="field">
        <label>想说点什么</label>
        <textarea id="revText" rows="3" placeholder="例：汤很足，鸡肉不柴。下次还点这家。"></textarea>
      </div>

      <button class="btn-primary" id="confirmRev">保存评价</button>
      <button class="btn-ghost" id="cancelRev">取消</button>
    </div>`;

  document.body.appendChild(sheet);

  const WORDS = { 1: '难以下咽', 2: '不太行', 3: '一般般', 4: '还不错', 5: '很好吃' };
  let rating = 4;
  const picked = new Set();

  const paintStars = () => {
    sheet.querySelectorAll('[data-star]').forEach(b =>
      b.classList.toggle('on', Number(b.dataset.star) <= rating));
    sheet.querySelector('#starWord').textContent = WORDS[rating];
  };

  sheet.addEventListener('click', e => {
    if (e.target === sheet || e.target.id === 'cancelRev') return sheet.remove();

    const s = e.target.closest('[data-star]');
    if (s) { rating = Number(s.dataset.star); return paintStars(); }

    const g = e.target.closest('[data-tag]');
    if (g) {
      const t = g.dataset.tag;
      picked.has(t) ? picked.delete(t) : picked.add(t);
      g.classList.toggle('on', picked.has(t));
      return;
    }

    if (e.target.id === 'confirmRev') {
      store.addReview({
        shopId,
        orderId: orderId || null,
        rating,
        text: sheet.querySelector('#revText').value.trim(),
        tags: [...picked],
      });
      sheet.remove();
      render();
    }
  });

  paintStars();
}

/* ---------- 弹层：录店 / 录菜 ---------- */

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

/* ---------- 弹层：录菜（自带图片槽，所以没用通用的 openForm） ---------- */

function openDishForm(shopId) {
  const shop = store.shop(shopId);
  if (!shop) return;

  let img = '';           // 先存在弹层里，点「保存」才落库
  let saving = false;

  const sheet = document.createElement('div');
  sheet.className = 'sheet-mask';
  sheet.innerHTML = `
    <div class="sheet">
      <div class="sheet-head">
        <div>
          <div class="sheet-name">在「${esc(shop.name)}」录一道菜</div>
          <div class="dim">图片和描述她会看到</div>
        </div>
      </div>

      <div class="field">
        <label>图片（可选，会自动压到很小再存）</label>
        <div class="img-slot big">
          <span class="thumb ph" id="dfThumb">📷</span>
          <label class="link-btn" for="picInput" id="dfPick">选图片</label>
          <button class="link-btn" id="dfClear" hidden>删掉图片</button>
        </div>
      </div>

      <div class="field"><label>菜名</label><input id="dfName" placeholder="例：黄焖鸡米饭"></div>
      <div class="field"><label>价格</label><input id="dfPrice" type="number" step="0.5" placeholder="22"></div>
      <div class="field">
        <label>描述（她会看到）</label>
        <textarea id="dfDesc" rows="3" placeholder="例：偏咸，备注少盐。米饭管够。"></textarea>
      </div>

      <button class="btn-primary" id="dfOk">保存</button>
      <button class="btn-ghost" id="dfCancel">取消</button>
    </div>`;

  document.body.appendChild(sheet);

  const thumb = sheet.querySelector('#dfThumb');
  const clearBtn = sheet.querySelector('#dfClear');

  const paint = () => {
    if (img) {
      thumb.className = 'thumb';
      thumb.innerHTML = '';
      thumb.style.backgroundImage = `url("${img}")`;
      clearBtn.hidden = false;
    } else {
      thumb.className = 'thumb ph';
      thumb.textContent = '📷';
      thumb.style.backgroundImage = '';
      clearBtn.hidden = true;
    }
  };

  const submit = () => {
    if (saving) return;
    saving = true;
    const name = sheet.querySelector('#dfName').value.trim();
    if (!name) { saving = false; return alert('先给这道菜起个名字'); }
    try {
      store.addDish({
        shopId,
        name,
        price: sheet.querySelector('#dfPrice').value,
        desc: sheet.querySelector('#dfDesc').value.trim(),
        image: img,
      });
      sheet.remove();
      render();
    } catch (e) {
      saving = false;
      toast(e.message, 4500);
    }
  };

  sheet.addEventListener('click', e => {
    if (e.target === sheet || e.target.id === 'dfCancel') return sheet.remove();

    if (e.target.id === 'dfPick') {
      pickImage(r => {
        if (!r) return;                                  // 用户取消了
        if (!r.ok) return toast(r.error, 3000);
        img = r.url;
        paint();
      });
      return;
    }
    if (e.target.id === 'dfClear') { img = ''; return paint(); }
    if (e.target.id === 'dfOk') return submit();
  });
}

/* ============================================================
   事件绑定
   ============================================================ */

document.addEventListener('click', e => {
  const t = e.target.closest('[data-go],[data-add],[data-plus],[data-minus],[data-del],[data-done],[data-clear],[data-pick],[data-delshop],[data-addshop],[data-adddish],[data-deldish],[data-review],[data-delrev],[data-dishstar],[data-jump],[data-pic],[data-unpic]');
  if (!t) return;

  const order = store.pendingOrder();

  if (t.dataset.go)      return go(t.dataset.go);
  if (t.dataset.add)     return openAddSheet(t.dataset.add);
  if (t.dataset.review)  return openReviewSheet(t.dataset.review, t.dataset.order || null);
  if (t.dataset.delrev)  return store.removeReview(t.dataset.delrev) ?? render();
  if (t.dataset.pick)    { manageShop = t.dataset.pick; return render(); }
  if (t.dataset.del && order)   { store.removeItem(order.id, +t.dataset.del); return render(); }
  if (t.dataset.minus && order) { store.updateItem(order.id, +t.dataset.minus, { qty: currentQty(order, +t.dataset.minus) - 1 }); return render(); }
  if (t.dataset.plus && order)  { store.updateItem(order.id, +t.dataset.plus,  { qty: currentQty(order, +t.dataset.plus) + 1 }); return render(); }
  if (t.dataset.delshop) return store.removeShop(t.dataset.delshop) ?? render();
  if (t.dataset.deldish) return store.removeDish(t.dataset.deldish) ?? render();

  if (t.dataset.jump) {
    const s = store.shop(t.dataset.jump);
    return s ? jumpToOrder(s) : null;
  }

  if (t.dataset.unpic) {
    try {
      store.setDishImage(t.dataset.unpic, '');
      render();
      toast('图片已删');
    } catch (err) { toast(err.message, 4000); }
    return;
  }

  if (t.dataset.pic) {
    const id = t.dataset.pic;
    pickImage(r => {
      if (!r) return;
      if (!r.ok) return toast(r.error, 3000);
      try {
        store.setDishImage(id, r.url);
        render();
        toast(`图片已存 · 约 ${Math.max(1, Math.round(r.bytes / 1024))} KB`);
      } catch (err) {
        toast(err.message, 4500);
      }
    });
    return;
  }

  if (t.dataset.done) {
    if (!order) return;
    store.setOrderStatus(order.id, 'ordered');
    const pending = store.unratedShops(order);
    alert(pending.length
      ? '已标记为「去下单了」。\n\n吃完别忘了在清单里给这几家写个评价，下次就有底了：\n' +
        pending.map(s => '· ' + ((store.shop(s) || {}).name || '')).join('\n')
      : '已标记为「去下单了」。');
    return render();
  }
  if (t.dataset.clear) {
    if (!order || !confirm('清空今天的点单？')) return;
    store.clearPending();
    return render();
  }

  if (t.dataset.addshop) {
    return openForm('录一家新店', [
      { key: 'name',     label: '店名',     ph: '例：巷口黄焖鸡' },
      { key: 'platform', label: '在哪点',   options: ['美团', '饿了么', '其他'] },
      { key: 'category', label: '分类',     ph: '例：快餐简餐' },
      { key: 'note',     label: '备注',     ph: '例：配送快 / 别点微辣' },
      { key: 'link',     label: '店铺链接（可留空，之后也能在「店铺设置」里补）',
                          ph: '美团 App 店铺页 → 分享 → 复制链接' },
    ], d => store.addShop(d));
  }

  if (t.dataset.adddish) return openDishForm(t.dataset.adddish);

  // 点菜品星级：星号和编号拼在 data 里
  if (t.dataset.dishstar) {
    const [id, n] = t.dataset.dishstar.split(':');
    store.rateDish(id, Number(n));
    return render();
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
    const order = store.pendingOrder();
    if (t.dataset.note && order)  store.updateItem(order.id, +t.dataset.note, { note: t.value });
    if (t.dataset.dname)          store.updateDish(t.dataset.dname, { name: t.value });
    if (t.dataset.ddesc)          store.updateDish(t.dataset.ddesc, { desc: t.value });
    if (t.dataset.dprice)         store.updateDish(t.dataset.dprice, { price: t.value });
    if (t.dataset.shname)         store.updateShop(t.dataset.shname, { name: t.value });
    if (t.dataset.shcat)          store.updateShop(t.dataset.shcat, { category: t.value });
    if (t.dataset.shnote)         store.updateShop(t.dataset.shnote, { note: t.value });
    if (t.dataset.shlink) {
      store.updateShop(t.dataset.shlink, { link: t.value.trim() });
      // 就地改这一行提示，不整页重画——重画会把正在输入的框冲掉、失焦。
      const hint = t.closest('.mng-row').querySelector('[data-entryhint]');
      const shop = store.shop(t.dataset.shlink);
      if (hint && shop) hint.textContent = '下单跳转：' + entryLabel(store.entryOf(shop));
    }
  }, 400));
});

/* 复选框（上下架）和下拉框（平台）用 change —— 它们会改变页面结构，必须重画 */
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.davail) {
    store.updateDish(t.dataset.davail, { available: t.checked });
    return render();
  }
  if (t.dataset.shplat) {
    store.updateShop(t.dataset.shplat, { platform: t.value });
    return render();
  }
});

function currentQty(order, idx) { return order.items[idx].qty; }

/* ============================================================
   公共片段 & 底部导航
   ============================================================ */

function emptyState(title, sub, goPath, btnText, img, extra = '') {
  return `
    <div class="empty">
      ${img ? `<img src="${img}" alt="" class="empty-img">` : ''}
      <h2>${esc(title)}</h2>
      <p>${esc(sub)}</p>
      <button class="btn-primary" data-go="${goPath}">${esc(btnText)}</button>
    </div>
    ${extra}`;
}

function paintTabbar() {
  const active = current.path === '/' || current.path === '/shop' ? 'shops'
               : current.path === '/order' ? 'order'
               : 'manage';
  document.querySelectorAll('.tabbar a').forEach(a => {
    a.classList.toggle('on', a.dataset.tab === active);
  });
  const pending = store.pendingOrder();
  const badge = document.getElementById('cartBadge');
  if (badge) badge.textContent = pending ? pending.items.reduce((s, i) => s + i.qty, 0) : '';
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

window.addEventListener('hashchange', render);
render();
