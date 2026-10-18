/**
 * 日期怎么显示给人看。
 *
 * 单独一个模块，是因为这些全是纯函数——不碰 DOM、不碰存储，
 * 于是可以扔进 node 里直接跑断言。留在 app.js 里就只能靠手点，
 * 而「上个月同一天」「跨年」「夏令时那 23 小时」这几个分支手点根本点不出来。
 *
 * 记账的日期一律是本地日历上的 'YYYY-MM-DD'，没有时分秒。
 */

/** 'YYYY-MM-DD' -> '10/12'；今年的就省去年份，不是今年的补两位年份 */
export function prettyDate(iso) {
  const y = year(iso), m = month(iso), d = day(iso);
  if (!y) return '';
  return (y === new Date().getFullYear()) ? `${m}/${d}` : `${String(y).slice(2)}/${m}/${d}`;
}

/**
 * 'YYYY-MM-DD' -> 当天零点的**本地**时间戳。
 *
 * 千万不能写 new Date(iso)：那样这个字符串会被当成 UTC 解析，
 * 东八区就变成当天早上八点，算出来凭空少一天。
 */
export function dayStart(iso) {
  const y = year(iso), m = month(iso), d = day(iso);
  if (!y) return NaN;
  return new Date(y, m - 1, d).getTime();
}

/**
 * 'YYYY-MM-DD' -> 「今天 / 昨天 / 前天 / N 天前 / 10/12」。
 *
 * 档案卡片回答的是「这家我多久没去了」，这个问题上相对时间更好用：
 * 「10/12」得自己心算，「6 天前」直接就是答案。
 *
 * 超过两周就换回日期——「40 天前」不如「8/9」有信息量，
 * 半年前那次翻出来是想确认具体哪天去的，相对说法反而添乱。
 *
 * 差值用 Math.round：夏令时切换那天只有 23 或 25 小时，
 * 直接除会算出 0.96 或 1.04 天，round 掉那点误差。
 */
export function fromNow(iso, todayIso) {
  const t = dayStart(iso);
  const now = dayStart(todayIso || todayLocal());
  if (!Number.isFinite(t) || !Number.isFinite(now)) return '';
  const days = Math.round((now - t) / 86400000);
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days === 2) return '前天';
  if (days > 2 && days <= 13) return `${days} 天前`;
  return prettyDate(iso);   // 超过两周；或者日期在未来（不该出现，兜住别显示负数）
}

/** 本地日历的今天，形如 'YYYY-MM-DD' */
export function todayLocal() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ---------- 私有的解析小工具 ---------- */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
function parts(iso) {
  const m = ISO.exec(String(iso || ''));
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}
const year  = iso => { const p = parts(iso); return p ? p.y : 0; };
const month = iso => { const p = parts(iso); return p ? p.m : 0; };
const day   = iso => { const p = parts(iso); return p ? p.d : 0; };
