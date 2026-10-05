// 喊單系統的連線設定（publishable key 是公開用的金鑰，資料安全由資料庫權限規則保護）
window.GB_CONFIG = {
  url: "https://swfpfnvnydekyuwcagdy.supabase.co",
  key: "sb_publishable_1dorLitRmxPW2mXqOURLqA_-881MPuO",
  // 手機帳號：用「手機號碼」組成一個內部帳號名稱，客人不會看到
  phoneDomain: "phone.haoshi-groupbuy.tw",
};
window.sb = supabase.createClient(GB_CONFIG.url, GB_CONFIG.key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
});

// 共用小工具
window.GB = {
  esc: (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])),
  fmt: (n) => Number(n || 0).toLocaleString("zh-TW"),
  today: () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" }),
  tw: (iso) => new Date(iso).toLocaleString("sv-SE", { timeZone: "Asia/Taipei" }), // "2026-10-05 13:58:00"
  md: (d) => (d ? `${+d.slice(5, 7)}/${+d.slice(8, 10)}` : ""),
  normPhone: (p) => String(p || "").replace(/[^\d]/g, "").replace(/^886/, "0"),
  phoneEmail: (p) => `${GB.normPhone(p)}@${GB_CONFIG.phoneDomain}`,
  toast(msg) {
    let t = document.getElementById("toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("on");
    clearTimeout(GB._tt); GB._tt = setTimeout(() => t.classList.remove("on"), 2200);
  },
  errMsg(e) {
    const m = (e && (e.message || e.error_description || e)) + "";
    if (/Invalid login credentials/i.test(m)) return "手機號碼或密碼不對，請再試一次";
    if (/already registered|already been registered/i.test(m)) return "這個手機號碼已經註冊過了，請直接登入";
    if (/Password should be at least/i.test(m)) return "密碼至少要 6 個字";
    if (/rate limit/i.test(m)) return "嘗試太多次了，請稍等一下再試";
    if (/permission denied|JWT expired|not authenticated/i.test(m)) return "登入狀態已改變，請重新整理頁面";
    return m.replace(/^.*?ERROR:\s*/, "");
  },
  ST: { open: "收單中", closed: "已結單・未到貨", arrived: "已到貨" },
};
