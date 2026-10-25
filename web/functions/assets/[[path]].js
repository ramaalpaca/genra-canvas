// 堵投毒（2026-07-20 事故根治）——作用域仅 /assets/*。
//
// 背景：editor/player 拆成独立 CF Pages 项目后丢了主站 functions/[[path]].js 的 404 兜底。
// 于是缺失的 /assets/<hash>.js（部署窗口期请求了还没就绪的 chunk）走 CF Pages 默认 SPA
// 兜底 → 返回 200 的 index.html（text/html）。浏览器把这份 HTML 按 max-age 缓存在
// 「.js URL」名下 → 之后该 chunk 恒 MIME 错、模块加载崩 → 整个 app 永久 loading，reload
// 也拉不到（磁盘缓存未过期不 revalidate），只能清缓存/等 TTL。
//
// 本 Function 拦截所有 /assets/* 请求：
//  · 命中真实文件 → 原样透传（保留 _headers 的 immutable 长缓存，性能不受影响）
//  · 未命中（被 SPA 兜底成 HTML）→ 一律改判 404 —— 404 不会被当成可用模块缓存，下次
//    部署就绪即拉到真 JS。chunk URL 永远不可能被缓存成 HTML，投毒从根上消失。
//
// app 深链路由（/editor 等非 /assets 路径）不经本 Function，仍走默认 SPA 兜底返回 index.html。
export async function onRequest(context) {
  const res = await context.env.ASSETS.fetch(context.request);
  const ct = res.headers.get('content-type') || '';
  // /assets/ 下只应有 js/css/图片/字体等；出现 text/html = 该文件不存在、被 SPA 兜底了。
  if (ct.includes('text/html')) {
    return new Response('Not Found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  return res;
}
