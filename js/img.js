/**
 * 图片处理：上传 → 压缩 → dataURL
 *
 * 为什么压缩：localStorage 一般只有 5MB，而且存的是 base64（比原图大 33%）。
 * 手机随手拍一张 3~5MB 的图直接存进去，两三张就爆。
 * 压到最长边 400px 的 JPEG，一张大约 30~45KB，能存一百多张。
 *
 * 接后端之后可以把这里换成上传到对象存储，存 URL 就行，体积能再小一个量级。
 */

const MAX_EDGE = 400;
const QUALITY = 0.72;
const KEY_PREFIX = 'lulu';

/** 压缩成 dataURL。返回 {ok:true,url,bytes,w,h} 或 {ok:false,error} */
export async function compressImage(file) {
  if (!file || !file.type.startsWith('image/')) {
    return { ok: false, error: '这不是图片文件' };
  }

  let src;
  try {
    src = await decode(file);
  } catch {
    return { ok: false, error: '这张图浏览器解不开，换一张 jpg / png 试试' };
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(src, 0, 0, w, h);

  // PNG 透明图转 JPEG 会变黑底，先铺一层白
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);

  // src 可能是 ImageBitmap（要 close）也可能是 <img>（要 revoke 它用的 blob URL）
  src.close?.();
  if (src.__objectUrl) URL.revokeObjectURL(src.__objectUrl);

  const url = canvas.toDataURL('image/jpeg', QUALITY);
  return { ok: true, url, bytes: url.length, w, h };
}

/**
 * 把 File 变成能画进 canvas 的东西。
 *
 * 优先 createImageBitmap（快、不占主线程），但 iOS 15 以前的 Safari 没有这个 API，
 * 而这页面大概率就是拿 Safari 打开的，所以留一条 <img> 回退路。
 */
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // HEIC 之类浏览器不支持的格式会走到这里，下面再试一次
    }
  }

  const objectUrl = URL.createObjectURL(file);
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('decode failed'));
    el.src = objectUrl;
  });
  img.__objectUrl = objectUrl;
  return img;
}

/** 估算已用/还剩多少空间，给用户一个直观提示 */
export function usage() {
  let chars = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(KEY_PREFIX)) chars += (localStorage.getItem(k) || '').length;
    }
  } catch { /* 隐私模式下可能读不到，忽略 */ }

  const LIMIT = 5 * 1024 * 1024;   // 浏览器普遍给 5MB
  const PER_IMG = 45000;           // 一张 400px JPEG 的实测中位数约 45KB
  return {
    used: chars,
    usedMB: (chars / 1024 / 1024).toFixed(2),
    approxLeft: Math.max(0, Math.floor((LIMIT - chars) / PER_IMG)),
  };
}
