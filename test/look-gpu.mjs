// GPU time of one scene render (shadow cascades included, post chain not) from EXT_disjoint_timer_query_webgl2.
// Usage in page.evaluate: `(${GPU_FN})(window.__game)` returns the median in ms.

export const GPU_FN = `async (g, n = 16) => {
  const gl = g.renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return -1;
  const a = [];
  for (let i = 0; i < n; i++) {
    const q = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    g.renderer.render(g.scene, g.camera);
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    let tries = 0;
    await new Promise((r) => setTimeout(r, 4));
    while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && tries++ < 300) await new Promise((r) => setTimeout(r, 3));
    if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) a.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
    gl.deleteQuery(q);
  }
  a.sort((x, y) => x - y);
  return a.length ? +a[Math.floor(a.length / 2)].toFixed(2) : -1;
}`;
