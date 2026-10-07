// 總後台：團購（網站＋自動回覆共用）與留言自動回覆
// 跟 admin.js 共用 $、S、GB、sb
(function () {
  const { esc, toast, errMsg } = GB;
  const FN = GB_CONFIG.url + "/functions/v1/";
  const H = { camps: [], rules: [], logs: [], settings: null, campFilter: "now", logFilter: "need", sub: "rules", editCamp: null, editRule: null, loaded: {} };
  const today = () => GB.today();
  const WEEK = "日一二三四五六";
  const dlabel = (d) => { if (!d) return ""; const x = new Date(d + "T00:00:00"); return `${x.getMonth() + 1}/${x.getDate()}（${WEEK[x.getDay()]}）`; };
  const lines = (t) => String(t || "").split("\n").map((x) => x.trim()).filter(Boolean);
  const commas = (t) => String(t || "").split(/[,，、\n]/).map((x) => x.trim()).filter(Boolean);
  const imgSrc = (p) => (!p ? "" : /^https?:/i.test(p) ? p : "../" + p.replace(/^\.?\//, ""));
  const TAG_EMOJI = { "生活用品": "🧴", "食品": "🍎", "教材": "📚", "服飾": "👕", "文具": "✏️", "玩具": "🧸" };

  function campState(c) {
    const t = today();
    if (c.start_date && c.start_date > t) return "upcoming";
    if (c.end_date && c.end_date < t) return "ended";
    return "active";
  }
  const STATE_TXT = { active: ["p-ready", "開團中"], upcoming: ["p-part", "即將開團"], ended: ["p-wait", "已結束"] };

  // ========== 團購 ==========
  async function loadCamps() {
    const { data, error } = await sb.from("campaigns").select("*").order("start_date", { ascending: true, nullsFirst: true });
    if (error) { $("campList").innerHTML = `<p class="err">${esc(errMsg(error))}</p>`; return; }
    H.camps = data;
    renderCamps();
    fillCampSelect();
  }
  const CAMP_FILTERS = [["now", "進行中＋即將開團"], ["ended", "已結束"], ["all", "全部"]];
  function renderCamps() {
    $("campFilters").innerHTML = CAMP_FILTERS.map(([k, l]) => `<button class="chipbtn" type="button" data-cf="${k}" aria-pressed="${H.campFilter === k}">${l}</button>`).join("");
    const list = H.camps.filter((c) => {
      const s = campState(c);
      return H.campFilter === "all" || (H.campFilter === "ended" ? s === "ended" : s !== "ended");
    });
    if (!list.length) { $("campList").innerHTML = `<div class="card"><p class="hint" style="margin:0">這裡還沒有團購。按「＋ 新增團購」加第一團。</p></div>`; return; }
    $("campList").innerHTML = list.map((c) => {
      const s = campState(c), [pc, pt] = STATE_TXT[s];
      const range = c.start_date && c.end_date ? `${dlabel(c.start_date)} – ${dlabel(c.end_date)}` : c.end_date ? `即日起 – ${dlabel(c.end_date)}` : c.start_date ? `${dlabel(c.start_date)} 起` : "長期開放";
      const th = c.image ? `<img src="${esc(imgSrc(c.image))}" alt="" loading="lazy">` : (TAG_EMOJI[c.tag] || "🛍️");
      return `<div class="ccard c-${s}">
        <div class="th">${th}</div>
        <div><div class="t">${esc(c.title)}</div>
          <div class="m"><span class="pill ${pc}">${pt}</span><span>${range}</span>${c.tag ? `<span>#${esc(c.tag)}</span>` : ""}
          ${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">團購連結 ↗</a>` : `<span style="color:var(--red)">還沒填連結</span>`}
          ${c.worksheet ? "<span>📝 有學習單</span>" : ""}${c.faq ? "" : `<span title="自動回覆沒有補充資訊可以參考">💬 沒有補充資訊</span>`}</div></div>
        <div class="a"><label class="check" style="margin:0"><input type="checkbox" data-site="${c.id}" ${c.on_site ? "checked" : ""}> 網站顯示</label>
          <button class="btn small" type="button" data-edit="${c.id}">編輯</button></div>
      </div>`;
    }).join("");
  }
  $("campFilters").onclick = (e) => { const b = e.target.closest("[data-cf]"); if (b) { H.campFilter = b.dataset.cf; renderCamps(); } };
  $("campList").onclick = (e) => { const b = e.target.closest("[data-edit]"); if (b) openCamp(H.camps.find((c) => c.id === +b.dataset.edit)); };
  $("campList").onchange = async (e) => {
    const cb = e.target.closest("[data-site]"); if (!cb) return;
    const { error } = await sb.from("campaigns").update({ on_site: cb.checked }).eq("id", +cb.dataset.site);
    if (error) { cb.checked = !cb.checked; return toast(errMsg(error)); }
    H.camps.find((c) => c.id === +cb.dataset.site).on_site = cb.checked;
    toast(cb.checked ? "已顯示在團購網站" : "已從團購網站隱藏");
  };
  $("campNew").onclick = () => openCamp(null);
  $("campCancel").onclick = () => { $("campForm").hidden = true; };
  function openCamp(c) {
    H.editCamp = c ? c.id : null;
    $("campFormTitle").textContent = c ? "編輯團購" : "新增團購";
    $("cfTitle").value = c?.title || ""; $("cfDescr").value = c?.descr || "";
    $("cfStart").value = c?.start_date || ""; $("cfEnd").value = c?.end_date || "";
    $("cfUrl").value = c?.url || ""; $("cfTag").value = c?.tag || ""; $("cfImage").value = c?.image || "";
    $("cfPoints").value = (c?.points || []).join("\n"); $("cfFaq").value = c?.faq || "";
    $("cfOnSite").checked = c ? c.on_site : true; $("cfWorksheet").checked = !!c?.worksheet;
    $("campDel").hidden = !c; $("campErr").hidden = true;
    $("campForm").hidden = false; $("campForm").scrollIntoView({ behavior: "smooth", block: "start" }); $("cfTitle").focus({ preventScroll: true });
  }
  $("campForm").onsubmit = async (e) => {
    e.preventDefault();
    const row = {
      title: $("cfTitle").value.trim(), descr: $("cfDescr").value.trim(),
      start_date: $("cfStart").value || null, end_date: $("cfEnd").value || null,
      url: $("cfUrl").value.trim(), tag: $("cfTag").value.trim(), image: $("cfImage").value.trim(),
      points: lines($("cfPoints").value), faq: $("cfFaq").value.trim(),
      on_site: $("cfOnSite").checked, worksheet: $("cfWorksheet").checked,
    };
    const bad = !row.title ? "請填團購名稱" : row.start_date && row.end_date && row.start_date > row.end_date ? "收團日要在開團日之後" : row.url && !/^https?:\/\//i.test(row.url) ? "團購連結要以 https:// 開頭" : "";
    if (bad) { $("campErr").textContent = bad; $("campErr").hidden = false; return; }
    const q = H.editCamp ? sb.from("campaigns").update(row).eq("id", H.editCamp) : sb.from("campaigns").insert(row);
    const { error } = await q;
    if (error) { $("campErr").textContent = errMsg(error); $("campErr").hidden = false; return; }
    $("campForm").hidden = true;
    toast(H.editCamp ? "已儲存，團購網站已更新" : "已新增，團購網站已更新");
    loadCamps();
  };
  $("campDel").onclick = async () => {
    const c = H.camps.find((x) => x.id === H.editCamp);
    if (!c || !confirm(`確定要刪除「${c.title}」嗎？網站上也會一起拿掉。\n（只是想從網站藏起來的話，取消勾選「網站顯示」就好）`)) return;
    const { error } = await sb.from("campaigns").delete().eq("id", c.id);
    if (error) return toast(errMsg(error));
    $("campForm").hidden = true; toast("已刪除"); loadCamps();
  };

  // ========== 自動回覆 ==========
  async function loadReply() {
    const [st, rules, meta] = await Promise.all([
      sb.from("reply_settings").select("*").eq("id", 1).maybeSingle(),
      sb.from("reply_rules").select("*").order("created_at"),
      sb.rpc("meta_status"),
    ]);
    if (st.error) return toast(errMsg(st.error));
    H.settings = st.data; H.rules = rules.data || [];
    if (!H.camps.length) await loadCamps();
    renderSettings(); renderRules(); renderMeta(meta.data);
    loadLogs();
  }
  function renderMeta(m) {
    if (m && m.page_name) {
      $("metaState").innerHTML = `✅ 已連接粉絲頁「${esc(m.page_name)}」${m.ig_username ? `、IG @${esc(m.ig_username)}` : "（沒有找到連結的 IG 帳號）"}<br><small>${GB.tw(m.connected_at).slice(0, 16)} 連接</small>`;
      $("metaConnect").textContent = "重新連接";
    } else {
      $("metaState").textContent = "還沒連接。按右邊的按鈕，用管理粉絲頁的 Facebook 帳號登入並勾選所有權限。";
    }
  }
  function renderSettings() {
    const s = H.settings; if (!s) return;
    $("rsEnabled").checked = s.enabled; $("rsIg").checked = s.ig_enabled; $("rsFb").checked = s.fb_enabled; $("rsAi").checked = s.ai_enabled;
    $("rsSince").value = s.active_since ? GB.tw(s.active_since).slice(0, 16).replace(" ", "T") : "";
    $("tPublic").value = s.public_reply; $("tPrompt").value = s.follow_prompt; $("tButton").value = s.follow_button;
    $("tNot").value = s.not_following; $("tFb").value = s.fb_like_prompt; $("tStyle").value = s.ai_style;
    $("whUrl").textContent = FN + "meta-webhook"; $("whToken").textContent = s.verify_token;
  }
  async function saveSettings(patch, msg) {
    const { error } = await sb.from("reply_settings").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) { toast(errMsg(error)); return false; }
    Object.assign(H.settings, patch); if (msg) toast(msg); return true;
  }
  $("rsEnabled").onchange = (e) => saveSettings({ enabled: e.target.checked }, e.target.checked ? "自動回覆已開啟" : "自動回覆已暫停");
  $("rsIg").onchange = (e) => saveSettings({ ig_enabled: e.target.checked }, "已儲存");
  $("rsFb").onchange = (e) => saveSettings({ fb_enabled: e.target.checked }, "已儲存");
  $("rsAi").onchange = (e) => saveSettings({ ai_enabled: e.target.checked }, "已儲存");
  $("rsSince").onchange = (e) => { const v = e.target.value; saveSettings({ active_since: v ? new Date(v + ":00+08:00").toISOString() : null }, v ? "已儲存：這個時間之前的貼文不自動回覆" : "已儲存：所有貼文都會自動回覆"); };
  $("rs-texts").onsubmit = (e) => {
    e.preventDefault();
    saveSettings({ public_reply: $("tPublic").value.trim(), follow_prompt: $("tPrompt").value.trim(), follow_button: $("tButton").value.trim().slice(0, 20),
      not_following: $("tNot").value.trim(), fb_like_prompt: $("tFb").value.trim(), ai_style: $("tStyle").value.trim() }, "用語已儲存");
  };
  $("replySub").onclick = (e) => {
    const b = e.target.closest("[data-s]"); if (!b) return;
    H.sub = b.dataset.s;
    document.querySelectorAll("#replySub .segbtn").forEach((x) => x.setAttribute("aria-pressed", x.dataset.s === H.sub));
    ["rules", "log", "texts", "setup"].forEach((k) => { $("rs-" + k).hidden = k !== H.sub; });
    if (H.sub === "log") loadLogs();
  };
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-copy]"); if (!b) return;
    navigator.clipboard.writeText($(b.dataset.copy).textContent).then(() => toast("已複製"));
  });

  // 規則
  function fillCampSelect() {
    if (!$("rfCamp")) return;
    const cur = $("rfCamp").value;
    $("rfCamp").innerHTML = `<option value="">（不指定）</option>` + H.camps.map((c) => `<option value="${c.id}">${esc(c.title)}</option>`).join("");
    $("rfCamp").value = cur;
  }
  function renderRules() {
    if (!H.rules.length) { $("ruleList").innerHTML = `<div class="card"><p class="hint" style="margin:0">還沒有關鍵字規則。例如新增一條「學習單」：有人留言「學習單」，確認追蹤後就私訊下載連結給他。</p></div>`; return; }
    $("ruleList").innerHTML = H.rules.map((r) => {
      const camp = H.camps.find((c) => c.id === r.campaign_id);
      return `<div class="rcard ${r.active ? "" : "off"}"><div>
        <div class="t">${esc(r.name || r.keywords.join("、"))}${r.active ? "" : "（停用中）"}</div>
        <div>${r.keywords.map((k) => `<span class="kw">${esc(k)}</span>`).join("")}</div>
        <div class="hint" style="margin:2px 0 0">${r.require_follow ? "💌 附追蹤提醒" : "直接給連結"}・${r.platforms.map((p) => (p === "ig" ? "IG" : "FB")).join("＋")}${r.all_posts ? "・含舊貼文" : "・只限新貼文"}${camp ? `・${esc(camp.title)}` : ""}${r.link ? "" : `・<span style="color:var(--red)">還沒填連結</span>`}</div>
      </div><button class="btn small" type="button" data-rule="${r.id}">編輯</button></div>`;
    }).join("");
  }
  $("ruleList").onclick = (e) => { const b = e.target.closest("[data-rule]"); if (b) openRule(H.rules.find((r) => r.id === +b.dataset.rule)); };
  $("ruleNew").onclick = () => openRule(null);
  $("ruleCancel").onclick = () => { $("ruleForm").hidden = true; };
  function openRule(r) {
    H.editRule = r ? r.id : null;
    fillCampSelect();
    $("ruleFormTitle").textContent = r ? "編輯關鍵字規則" : "新增關鍵字規則";
    $("rfName").value = r?.name || ""; $("rfKeys").value = (r?.keywords || []).join(", ");
    $("rfCamp").value = r?.campaign_id || ""; $("rfMsg").value = r?.message || ""; $("rfLink").value = r?.link || "";
    $("rfFollow").checked = r ? r.require_follow : true; $("rfActive").checked = r ? r.active : true;
    $("rfIg").checked = r ? r.platforms.includes("ig") : true; $("rfFb").checked = r ? r.platforms.includes("fb") : true; $("rfAll").checked = !!r?.all_posts;
    $("ruleDel").hidden = !r; $("ruleErr").hidden = true;
    $("ruleForm").hidden = false; $("rfKeys").focus();
  }
  $("ruleForm").onsubmit = async (e) => {
    e.preventDefault();
    const row = {
      name: $("rfName").value.trim(), keywords: commas($("rfKeys").value),
      campaign_id: $("rfCamp").value ? +$("rfCamp").value : null,
      message: $("rfMsg").value.trim(), link: $("rfLink").value.trim(),
      require_follow: $("rfFollow").checked, active: $("rfActive").checked, all_posts: $("rfAll").checked,
      platforms: [$("rfIg").checked && "ig", $("rfFb").checked && "fb"].filter(Boolean),
    };
    const bad = !row.keywords.length ? "請至少填一個關鍵字" : !row.platforms.length ? "請至少勾一個平台" : row.link && !/^https?:\/\//i.test(row.link) ? "連結要以 https:// 開頭" : !row.link && !row.message ? "請填私訊內容或連結" : "";
    if (bad) { $("ruleErr").textContent = bad; $("ruleErr").hidden = false; return; }
    const { error } = H.editRule ? await sb.from("reply_rules").update(row).eq("id", H.editRule) : await sb.from("reply_rules").insert(row);
    if (error) { $("ruleErr").textContent = errMsg(error); $("ruleErr").hidden = false; return; }
    $("ruleForm").hidden = true; toast("規則已儲存");
    const { data } = await sb.from("reply_rules").select("*").order("created_at"); H.rules = data || []; renderRules();
  };
  $("ruleDel").onclick = async () => {
    if (!confirm("確定要刪除這條規則嗎？")) return;
    const { error } = await sb.from("reply_rules").delete().eq("id", H.editRule);
    if (error) return toast(errMsg(error));
    $("ruleForm").hidden = true; H.rules = H.rules.filter((r) => r.id !== H.editRule); renderRules(); toast("已刪除");
  };

  // 紀錄
  const LOG_FILTERS = [["need", "要妳處理"], ["done", "已自動回覆"], ["all", "全部"]];
  const ACTION_TXT = { keyword: "關鍵字", gate_ok: "已確認追蹤・送出連結", gate_wait: "請對方追蹤", ai: "AI 回答", skip: "略過" };
  const STATUS_TXT = { done: ["p-ready", "已回覆"], skipped: ["p-wait", "略過"], needs_human: ["p-open", "要妳處理"], error: ["p-part", "出錯"] };
  async function loadLogs() {
    const { data, error } = await sb.from("reply_log").select("*").order("created_at", { ascending: false }).limit(100);
    if (error) return;
    H.logs = data; renderLogs();
  }
  function renderLogs() {
    const need = H.logs.filter((l) => (l.status === "needs_human" || l.status === "error") && !l.handled).length;
    [$("needBadge"), $("replyBadge")].forEach((b) => { b.hidden = !need; b.textContent = need; });
    $("logFilters").innerHTML = LOG_FILTERS.map(([k, l]) => `<button class="chipbtn" type="button" data-lf="${k}" aria-pressed="${H.logFilter === k}">${l}</button>`).join("");
    const list = H.logs.filter((l) => H.logFilter === "all" || (H.logFilter === "need" ? (l.status === "needs_human" || l.status === "error") && !l.handled : l.status === "done"));
    if (!list.length) { $("logList").innerHTML = `<p class="hint">${H.logFilter === "need" ? "目前沒有需要妳處理的留言 🎉" : "還沒有紀錄。"}</p>`; return; }
    $("logList").innerHTML = list.map((l) => {
      const [pc, pt] = STATUS_TXT[l.status] || ["p-wait", l.status];
      return `<div class="lrow ${esc(l.status)}">
        <div class="lh"><span class="pill ${pc}">${pt}</span><b>${l.platform === "ig" ? "IG" : "FB"}${l.kind === "message" ? " 私訊" : " 留言"}</b><span>${esc(l.user_name || "")}</span><span>${GB.tw(l.created_at).slice(5, 16)}</span>${l.action ? `<span>${ACTION_TXT[l.action] || esc(l.action)}</span>` : ""}
          ${(l.status === "needs_human" || l.status === "error") && !l.handled ? `<button class="btn small" type="button" data-done="${l.id}" style="margin-left:auto">已處理</button>` : ""}</div>
        ${l.text ? `<div class="lt">「${esc(l.text)}」</div>` : ""}
        ${l.reply ? `<div class="lr">${esc(l.reply)}</div>` : ""}
        ${l.error ? `<div class="hint" style="margin:4px 0 0;color:var(--ship-ink)">${esc(l.error)}</div>` : ""}
      </div>`;
    }).join("");
  }
  $("logFilters").onclick = (e) => { const b = e.target.closest("[data-lf]"); if (b) { H.logFilter = b.dataset.lf; renderLogs(); } };
  $("logList").onclick = async (e) => {
    const b = e.target.closest("[data-done]"); if (!b) return;
    const { error } = await sb.from("reply_log").update({ handled: true }).eq("id", +b.dataset.done);
    if (error) return toast(errMsg(error));
    H.logs.find((l) => l.id === +b.dataset.done).handled = true; renderLogs();
  };

  // ========== 連接 Meta：到 Facebook 授權「好事丞雙自動回覆」App，伺服器換成粉絲頁長期權杖 ==========
  const META_APP_ID = "1392117529656742";
  const META_SCOPES = "pages_show_list,pages_manage_metadata,pages_read_engagement,pages_manage_engagement,pages_read_user_content,pages_messaging,instagram_basic,instagram_manage_comments,instagram_manage_messages,business_management";
  $("metaConnect").onclick = async () => {
    const { data, error } = await sb.from("meta_oauth_state").insert({}).select("id").single();
    if (error) return toast(errMsg(error));
    const q = new URLSearchParams({ client_id: META_APP_ID, redirect_uri: FN + "meta-connect", state: data.id, scope: META_SCOPES, response_type: "code", auth_type: "rerequest" });
    location.href = "https://www.facebook.com/v23.0/dialog/oauth?" + q.toString();
  };
  // 從 Facebook 授權回來時，網址會帶 ?meta=ok 或 ?meta_error=…
  const backParams = new URLSearchParams(location.search);
  const metaResult = backParams.get("meta") ? "ok" : backParams.get("meta_error");
  if (metaResult) history.replaceState(null, "", location.pathname);

  window.HUB = {
    onTab(k) {
      if (k === "camp" && !H.loaded.camp) { H.loaded.camp = 1; loadCamps(); }
      if (k === "reply") { if (!H.loaded.reply) { H.loaded.reply = 1; loadReply(); } else loadLogs(); }
    },
  };
  // 等後台確認身分後：管理者先讀一次紀錄（分頁紅點）；如果剛從 Facebook 授權回來，就完成連接
  (async () => {
    for (let i = 0; i < 40 && !S.role; i++) await new Promise((r) => setTimeout(r, 250));
    if (S.role !== "admin") return;
    if (metaResult) {
      showTab("reply");
      toast(metaResult === "ok" ? "已連接粉絲頁與 IG 🎉" : "連接失敗：" + metaResult);
    } else loadLogs();
  })();
  // 每 2 分鐘看一下有沒有需要處理的留言（顯示在分頁的紅點）
  setInterval(() => { if (S.role === "admin" && H.loaded.reply) loadLogs(); }, 120000);
})();
