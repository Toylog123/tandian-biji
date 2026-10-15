/**
 * 后端配置 —— 你自己的 Supabase 项目
 *
 * 默认是空的 = 纯单机版，数据只存在这台设备的浏览器里。
 * 想让两个人共用一份数据，按 docs/接入后端.md 填下面两行。
 *
 * ⚠️ 这两个值会打进公开的网页里，任何打开页面的人都能看到。
 *    所以只能填 Supabase 的 anon / publishable key，
 *    **绝对不要填 service_role key**，那个等于数据库管理员权限。
 */

export const SUPABASE = {
  url: '',   // 例：https://abcdefghijklm.supabase.co
  key: '',   // 例：sb_publishable_xxxxxxxxxxxxxxxxxxxx
};
