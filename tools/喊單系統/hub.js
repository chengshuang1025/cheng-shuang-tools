// 總後台：團購（網站＋自動回覆共用）與留言自動回覆
// 跟 admin.js 共用 $、S、GB、sb
(function () {
  const { esc, toast, errMsg } = GB;
  const FN = GB_CONFIG.url + "/functions/v1/";
  const H = { camps: [], rules: [], logs: [], settings: null, campFilter: "now", logFilter: "all", sub: "rules", editCamp: null, editRule: null, loaded: {} };
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

  // ========== 📋 文案（每團的開團文案，手機一鍵複製）==========
  const LINK_PH = "（團購連結）";
  const CP_KEY = "cs-copy-camp";
  Object.assign(H, { copyCamp: null, copyEdit: null, copyOpen: {} });
  try { H.copyCamp = +localStorage.getItem(CP_KEY) || null; } catch (e) {}
  const copyList = (c) => (Array.isArray(c?.copies) ? c.copies : []);
  // 複製時把「（團購連結）」換成這團的連結
  const finalText = (c, t) => (c.url ? String(t).split(LINK_PH).join(c.url) : String(t));
  function copyCamps() {
    const showEnded = $("copyEnded").checked;
    return H.camps.filter((c) => showEnded || campState(c) !== "ended");
  }
  function renderCopy() {
    const camps = copyCamps();
    if (!camps.length) { $("copyPick").innerHTML = ""; $("copyBody").innerHTML = `<div class="card"><p class="hint" style="margin:0">目前沒有進行中或即將開團的團購。</p></div>`; return; }
    if (!camps.some((c) => c.id === H.copyCamp)) {
      H.copyCamp = (camps.find((c) => campState(c) === "active" && copyList(c).length) || camps.find((c) => campState(c) === "active") || camps[0]).id;
    }
    $("copyPick").innerHTML = camps.map((c) => {
      const s = campState(c);
      const d = c.start_date && c.end_date ? `${dlabel(c.start_date).replace(/（.）/, "")}–${dlabel(c.end_date).replace(/（.）/, "")}` : STATE_TXT[s][1];
      return `<button class="cpick" type="button" role="option" data-cpk="${c.id}" aria-selected="${c.id === H.copyCamp}">${esc(c.title)}<small>${s === "active" ? "🟢 " : s === "upcoming" ? "🕒 " : ""}${d}・${copyList(c).length} 則</small></button>`;
    }).join("");
    const sel = $("copyPick").querySelector('[aria-selected="true"]');
    if (sel) sel.scrollIntoView({ block: "nearest", inline: "nearest" });
    renderCopyBody();
  }
  function renderCopyBody() {
    const c = H.camps.find((x) => x.id === H.copyCamp); if (!c) return;
    if (!("copies" in c)) { $("copyBody").innerHTML = `<div class="card"><p class="err" style="margin:0">資料庫還沒加上「文案」欄位，請先在 Supabase 執行 sql/12_開團文案.sql。</p></div>`; return; }
    const [pc, pt] = STATE_TXT[campState(c)];
    const range = c.start_date && c.end_date ? `${dlabel(c.start_date)} – ${dlabel(c.end_date)}` : "";
    const list = copyList(c);
    const head = `<div class="chead"><div style="min-width:0"><div class="t">${esc(c.title)}</div>
        <div class="m"><span class="pill ${pc}">${pt}</span>${range ? `<span>${range}</span>` : ""}${c.url ? "" : `<span style="color:var(--red)">還沒填團購連結</span>`}</div></div>
        ${c.url ? `<button class="btn small" type="button" data-cpurl="1">複製團購連結</button>` : ""}</div>`;
    const blocks = list.map((it, i) => {
      if (H.copyEdit === i) return `<div class="cblock"><div class="ed">
          <input id="ceLabel" value="${esc(it.label || "")}" placeholder="標題，例如：💚 LINE 社群文" aria-label="標題">
          <textarea id="ceText" aria-label="文案內容">${esc(it.text || "")}</textarea>
          <div class="row2"><button class="btn primary" type="button" data-ce="save">儲存</button><button class="btn" type="button" data-ce="cancel">取消</button>
          ${i > 0 ? `<button class="btn small" type="button" data-ce="up">往上移</button>` : ""}
          <button class="btn red small" type="button" data-ce="del" style="margin-left:auto">刪除這則</button></div></div></div>`;
      const t = String(it.text || "");
      const warns = [];
      if (t.includes(LINK_PH) && !c.url) warns.push("還沒有團購連結：先到「🧺 團購」填連結，複製時就會自動換上");
      const other = (t.match(/（[^（）]*連結）/g) || []).filter((x) => x !== LINK_PH);
      if (other.length) warns.push(`還有要自己換掉的地方：${[...new Set(other)].join("、")}`);
      const short = t.split("\n").length <= 6 && t.length < 160;
      const open = H.copyOpen[c.id + ":" + i];
      return `<div class="cblock">
        <div class="bh"><b>${esc(it.label || "文案")}</b><span class="cnt">${t.length} 字</span>
          ${short ? "" : `<button class="btn small" type="button" data-cx="${i}">${open ? "收合" : "展開"}</button>`}</div>
        <pre class="txt${open ? " open" : ""}${short ? " short" : ""}" data-cx="${i}">${esc(finalText(c, t))}</pre>
        ${warns.map((w) => `<p class="warn">⚠️ ${esc(w)}</p>`).join("")}
        <div class="bf"><button class="btn primary copybtn" type="button" data-cc="${i}">📋 複製</button><button class="btn" type="button" data-cedit="${i}">編輯</button></div>
      </div>`;
    }).join("");
    $("copyBody").innerHTML = head + `<div class="clist">${blocks || `<div class="card"><p class="hint" style="margin:0">這團還沒有文案，按下面的「＋ 新增文案」加一則。</p></div>`}</div>
      <div class="cadd"><button class="btn" type="button" data-cadd="1">＋ 新增文案</button></div>`;
    if (H.copyEdit !== null) { const ta = $("ceText"); if (ta) ta.focus({ preventScroll: true }); }
  }
  async function writeClip(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
      let ok = false; try { ok = document.execCommand("copy"); } catch (e2) {}
      ta.remove(); return ok;
    }
  }
  async function saveCopies(c, list, msg) {
    const { error } = await sb.from("campaigns").update({ copies: list }).eq("id", c.id);
    if (error) { toast(errMsg(error)); return false; }
    c.copies = list; toast(msg); return true;
  }
  $("copyEnded").onchange = renderCopy;
  $("copyPick").onclick = (e) => {
    const b = e.target.closest("[data-cpk]"); if (!b) return;
    H.copyCamp = +b.dataset.cpk; H.copyEdit = null;
    try { localStorage.setItem(CP_KEY, H.copyCamp); } catch (e2) {}
    renderCopy();
  };
  $("copyBody").onclick = async (e) => {
    const c = H.camps.find((x) => x.id === H.copyCamp); if (!c) return;
    const list = copyList(c).slice();
    const t = e.target;
    let b;
    if ((b = t.closest("[data-cc]"))) {
      const it = list[+b.dataset.cc];
      const ok = await writeClip(finalText(c, it.text || ""));
      if (!ok) return toast("複製失敗，請按住文字自己選取複製");
      b.classList.add("done"); b.textContent = "✓ 已複製";
      setTimeout(() => { b.classList.remove("done"); b.textContent = "📋 複製"; }, 1800);
      toast(`已複製「${it.label || "文案"}」`);
    } else if ((b = t.closest("[data-cpurl]"))) {
      if (await writeClip(c.url)) toast("已複製團購連結");
    } else if ((b = t.closest("[data-cx]"))) {
      const k = c.id + ":" + b.dataset.cx; H.copyOpen[k] = !H.copyOpen[k]; renderCopyBody();
    } else if ((b = t.closest("[data-cedit]"))) {
      H.copyEdit = +b.dataset.cedit; renderCopyBody();
    } else if ((b = t.closest("[data-cadd]"))) {
      list.push({ label: "", text: "" });
      c.copies = list; H.copyEdit = list.length - 1; renderCopyBody();
      $("ceLabel").focus();
    } else if ((b = t.closest("[data-ce]"))) {
      const i = H.copyEdit, act = b.dataset.ce;
      if (act === "cancel") {
        if (!list[i].label && !list[i].text) c.copies = list.filter((_, j) => j !== i); // 新增到一半取消
        H.copyEdit = null; renderCopyBody(); return;
      }
      if (act === "save") {
        const label = $("ceLabel").value.trim(), text = $("ceText").value.replace(/\s+$/, "");
        if (!text) return toast("內容是空的");
        list[i] = { label: label || "文案", text };
        if (await saveCopies(c, list, "已儲存")) { H.copyEdit = null; renderCopy(); }
      } else if (act === "up" && i > 0) {
        [list[i - 1], list[i]] = [list[i], list[i - 1]];
        if (await saveCopies(c, list, "已往上移")) { H.copyEdit = i - 1; renderCopyBody(); }
      } else if (act === "del") {
        if (!confirm(`確定刪除「${list[i].label || "這則文案"}」？`)) return;
        list.splice(i, 1);
        if (await saveCopies(c, list, "已刪除")) { H.copyEdit = null; renderCopy(); }
      }
    }
  };

  // ========== 自動回覆（觸發規則／需要妳回／公開回覆庫／紀錄／設定）==========
  const SRC = { comment: ["💬", "貼文留言"], story: ["📱", "限動回覆"], dm: ["✉️", "私訊"] };
  const BTN_DEFAULT = "我想更了解這產品！";
  const toLocal = (iso) => (iso ? GB.tw(iso).slice(0, 16).replace(" ", "T") : "");
  const fromLocal = (v) => (v ? new Date(v + ":00+08:00").toISOString() : null);
  const pickOne = (a) => a[Math.floor(Math.random() * a.length)];
  Object.assign(H, { stats: {}, ruleFilter: "all", edit: null, media: null, mediaErr: "", pvClicked: false, sub: "rules" });

  async function loadReply() {
    const [st, rules, meta, stats] = await Promise.all([
      sb.from("reply_settings").select("*").eq("id", 1).maybeSingle(),
      sb.from("reply_rules").select("*").order("created_at"),
      sb.rpc("meta_status"),
      sb.rpc("reply_rule_stats"),
    ]);
    if (st.error) return toast(errMsg(st.error));
    H.settings = st.data; H.rules = rules.data || [];
    H.stats = Object.fromEntries((stats.data || []).map((x) => [x.rule_id, x]));
    if (!H.camps.length) await loadCamps();
    renderMaster(); renderRules(); renderMeta(meta.data); renderSettings(); renderPool();
    loadLogs();
  }
  async function reloadRules() {
    const [{ data }, stats] = await Promise.all([sb.from("reply_rules").select("*").order("created_at"), sb.rpc("reply_rule_stats")]);
    H.rules = data || []; H.stats = Object.fromEntries((stats.data || []).map((x) => [x.rule_id, x]));
    renderRules(); renderPool();
  }
  function renderMeta(m) {
    if (m && m.page_name) {
      $("metaState").innerHTML = `✅ 已連接粉絲頁「${esc(m.page_name)}」${m.ig_username ? `、IG @${esc(m.ig_username)}` : "（沒有找到連結的 IG 帳號）"}<br><small>${GB.tw(m.connected_at).slice(0, 16)} 連接</small>`;
      $("metaConnect").textContent = "重新連接";
    } else {
      $("metaState").textContent = "還沒連接。按右邊的按鈕，用管理粉絲頁的 Facebook 帳號登入並勾選所有權限。";
    }
  }
  function renderMaster() {
    const s = H.settings; if (!s) return;
    $("rsEnabled").checked = s.enabled; $("rsIg").checked = s.ig_enabled; $("rsFb").checked = s.fb_enabled;
    $("dmFlag").className = "dmflag " + (s.dm_ready ? "on" : "off");
    $("dmFlag").textContent = s.dm_ready ? "✅ 私訊按鈕、限動、私訊規則運作中" : "⏳ Meta 私訊權限審核中：目前只有貼文留言會動，按鈕先改成直接給";
  }
  async function saveSettings(patch, msg) {
    const { error } = await sb.from("reply_settings").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) { toast(errMsg(error)); return false; }
    Object.assign(H.settings, patch); renderMaster(); if (msg) toast(msg); return true;
  }
  $("rsEnabled").onchange = (e) => saveSettings({ enabled: e.target.checked }, e.target.checked ? "自動回覆已開啟" : "自動回覆已暫停");
  $("rsIg").onchange = (e) => saveSettings({ ig_enabled: e.target.checked }, "已儲存");
  $("rsFb").onchange = (e) => saveSettings({ fb_enabled: e.target.checked }, "已儲存");

  function setSub(k) {
    H.sub = k;
    document.querySelectorAll("#replySub [data-s]").forEach((x) => x.setAttribute("aria-pressed", x.dataset.s === k));
    ["rules", "need", "pool", "log", "settings"].forEach((x) => { $("rs-" + x).hidden = x !== k; });
    $("ruleForm").hidden = true;
    if (k === "log" || k === "need") loadLogs();
  }
  $("replySub").onclick = (e) => { const b = e.target.closest("[data-s]"); if (b) setSub(b.dataset.s); };
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-copy]"); if (!b) return;
    navigator.clipboard.writeText($(b.dataset.copy).textContent).then(() => toast("已複製"));
  });

  // ---------- 觸發規則列表 ----------
  const RULE_FILTERS = [["all", "全部"], ["comment", "💬 貼文留言"], ["story", "📱 限動回覆"], ["dm", "✉️ 私訊"], ["archived", "🗄 已封存"]];
  function thumbHtml(r) {
    if (r.post_id && r.post_thumb) return `<img src="${esc(r.post_thumb)}" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode('${r.source === "story" ? "那則限動" : "那篇貼文"}'))">`;
    if (r.post_id) return r.source === "story" ? "那則限動" : "那篇貼文";
    return r.source === "story" ? "全部限動" : r.source === "dm" ? "私訊" : "全部貼文";
  }
  function renderRules() {
    const live = H.rules.filter((r) => !r.archived);
    const cnt = { all: live.length, archived: H.rules.length - live.length };
    live.forEach((r) => { cnt[r.source || "comment"] = (cnt[r.source || "comment"] || 0) + 1; });
    $("ruleFilters").innerHTML = RULE_FILTERS.map(([k, l]) => `<button class="chipbtn" type="button" data-rf="${k}" aria-pressed="${H.ruleFilter === k}">${l}<span class="n">${cnt[k] || 0}</span></button>`).join("");
    const list = H.ruleFilter === "archived" ? H.rules.filter((r) => r.archived) : live.filter((r) => H.ruleFilter === "all" || (r.source || "comment") === H.ruleFilter);
    if (!list.length) {
      $("ruleGrid").innerHTML = `<div class="rc" style="grid-column:1/-1"><p class="hint" style="margin:0">${H.ruleFilter === "archived" ? "沒有封存的規則。" : "這裡還沒有規則。按右上角「＋ 新增規則」，例如：留言「草莓」→ 公開回一句 → 私訊招呼＋『我想更了解這產品！』按鈕。"}</p></div>`;
      return;
    }
    const now = Date.now();
    $("ruleGrid").innerHTML = list.map((r) => {
      const s = H.stats[r.id] || {}, src = r.source || "comment";
      const waitDm = src !== "comment" && !H.settings?.dm_ready;
      const tags = [
        `<span class="tg">${SRC[src][1]}</span>`,
        r.platforms.length === 2 ? "" : `<span class="tg">${r.platforms[0] === "ig" ? "IG" : "FB"}</span>`,
        r.mode === "button" ? `<span class="tg">按鈕後給</span>` : `<span class="tg g">直接給連結</span>`,
        r.allow_repeat ? `<span class="tg r">🧪 可重複觸發</span>` : "",
        !r.active ? `<span class="tg w">⏸ 暫停中</span>` : "",
        r.ends_at && Date.parse(r.ends_at) < now ? `<span class="tg w">已過期</span>` : r.starts_at && Date.parse(r.starts_at) > now ? `<span class="tg y">⏰ ${GB.tw(r.starts_at).slice(5, 16)} 開始</span>` : "",
        waitDm ? `<span class="tg y">等 Meta 核准</span>` : "",
      ].join("");
      const rate = r.mode === "button" && s.greeted ? Math.round((s.clicks / s.greeted) * 100) + "%" : "—";
      return `<div class="rc ${r.active && !r.archived ? "" : "off"}">
        <div class="top"><div class="thumb">${thumbHtml(r)}</div>
          <div style="min-width:0"><div class="t">${esc(r.name || r.keywords.join("、") || "（未命名）")}</div><div class="tags">${tags}</div></div></div>
        <div class="kwl">關鍵字：${r.any_text ? (src === "dm" ? "任何私訊" : "任何內容") : esc(r.keywords.join("、")) + (r.fuzzy ? " <small>（含同音字）</small>" : "")}</div>
        <div class="st"><span>觸發 <b>${s.triggered || 0}</b></span><span>已送 <b>${s.sent || 0}</b></span><span title="按了按鈕的人數 ÷ 收到按鈕的人數">點擊率 <b>${rate}</b></span></div>
        ${s.errors ? `<div class="bad">⚠️ 有 ${s.errors} 筆送出失敗，到「紀錄」看原因</div>` : ""}
        <div class="acts">
          ${r.archived ? `<button class="btn small" type="button" data-ra="unarchive" data-id="${r.id}">還原</button>` : `<button class="btn small" type="button" data-ra="toggle" data-id="${r.id}">${r.active ? "暫停" : "啟用"}</button>`}
          <button class="btn small" type="button" data-ra="copy" data-id="${r.id}">複製</button>
          <button class="btn small" type="button" data-ra="edit" data-id="${r.id}">編輯</button>
          ${r.archived ? "" : `<button class="btn small" type="button" data-ra="archive" data-id="${r.id}">封存</button>`}
          <button class="btn small red" type="button" data-ra="delete" data-id="${r.id}">刪除</button>
        </div></div>`;
    }).join("");
  }
  $("ruleFilters").onclick = (e) => { const b = e.target.closest("[data-rf]"); if (b) { H.ruleFilter = b.dataset.rf; renderRules(); } };
  $("ruleGrid").onclick = async (e) => {
    const b = e.target.closest("[data-ra]"); if (!b) return;
    const r = H.rules.find((x) => x.id === +b.dataset.id); if (!r) return;
    const upd = async (patch, msg) => { const { error } = await sb.from("reply_rules").update(patch).eq("id", r.id); if (error) return toast(errMsg(error)); toast(msg); reloadRules(); };
    switch (b.dataset.ra) {
      case "toggle": return upd({ active: !r.active }, r.active ? "已暫停" : "已啟用");
      case "archive": return upd({ archived: true, active: false }, "已封存（在「🗄 已封存」裡可以還原）");
      case "unarchive": return upd({ archived: false }, "已還原，記得按「啟用」");
      case "edit": return openRule(r);
      case "copy": {
        const { id, created_at, ...rest } = r;
        const { error } = await sb.from("reply_rules").insert({ ...rest, name: (r.name || "規則") + "（複製）", active: false, archived: false });
        if (error) return toast(errMsg(error));
        toast("已複製（先暫停，改好再啟用）"); return reloadRules();
      }
      case "delete": {
        if (!confirm(`確定要刪除「${r.name || r.keywords.join("、")}」嗎？\n（只是先不用的話，可以按「封存」）`)) return;
        const { error } = await sb.from("reply_rules").delete().eq("id", r.id);
        if (error) return toast(errMsg(error));
        toast("已刪除"); return reloadRules();
      }
    }
  };

  // ---------- 規則編輯 ----------
  function blankRule() {
    return { name: "", source: "comment", platforms: ["ig", "fb"], post_id: null, post_thumb: "", post_caption: "", keywords: [], fuzzy: true, any_text: false,
      public_replies: [], mode: "button", greeting: "", button_label: BTN_DEFAULT, message: "", link_buttons: [], follow_invite: true,
      starts_at: null, ends_at: null, allow_repeat: false, all_posts: false, campaign_id: null, active: true };
  }
  function fillCampSelect() {
    if (!$("rfCamp")) return;
    const cur = $("rfCamp").value;
    $("rfCamp").innerHTML = `<option value="">（不指定）</option>` + H.camps.map((c) => `<option value="${c.id}">${esc(c.title)}</option>`).join("");
    $("rfCamp").value = cur;
  }
  function openRule(r) {
    const d = r ? JSON.parse(JSON.stringify(r)) : blankRule();
    if (!d.source) d.source = "comment";
    if (!Array.isArray(d.link_buttons)) d.link_buttons = [];
    if (d.link) { d.link_buttons.push({ title: "🔗 點我打開", url: d.link }); d.link = ""; }
    H.edit = d; H.editId = r ? r.id : null; H.pvClicked = false;
    fillCampSelect();
    $("ruleFormTitle").textContent = r ? "編輯規則" : "新增規則";
    $("rfName").value = d.name || ""; $("rfKeys").value = (d.keywords || []).join(", ");
    $("rfFuzzy").checked = d.fuzzy !== false; $("rfAny").checked = !!d.any_text;
    $("rfIg").checked = d.platforms.includes("ig"); $("rfFb").checked = d.platforms.includes("fb");
    $("rfGreet").value = d.greeting || ""; $("rfGreet").placeholder = H.settings?.default_greeting || "";
    $("rfBtn").value = d.button_label || BTN_DEFAULT; $("rfMsg").value = d.message || ""; $("rfInvite").checked = d.follow_invite !== false;
    $("rfStart").value = toLocal(d.starts_at); $("rfEnd").value = toLocal(d.ends_at);
    $("rfCamp").value = d.campaign_id || ""; $("rfAll").checked = !!d.all_posts; $("rfRepeat").checked = !!d.allow_repeat;
    $("rfAdv").open = !!(d.starts_at || d.ends_at || d.allow_repeat || d.all_posts || d.campaign_id);
    $("rfActive").checked = d.active !== false; $("rfActiveTxt").textContent = $("rfActive").checked ? "開啟中" : "暫停中";
    $("ruleDel").hidden = !r; $("ruleErr").hidden = true;
    $("rs-rules").hidden = true; $("ruleForm").hidden = false;
    renderSource(); renderPub(); renderLinks(); renderMode();
    $("ruleForm").scrollIntoView({ behavior: "smooth", block: "start" });
    if (d.source !== "dm" && !H.media) loadMedia(); else renderPicker();
  }
  function closeRule() { $("ruleForm").hidden = true; $("rs-rules").hidden = false; H.edit = null; }
  $("ruleNew").onclick = () => openRule(null);
  $("ruleBack").onclick = closeRule; $("ruleCancel").onclick = closeRule;
  $("rfActive").onchange = (e) => { $("rfActiveTxt").textContent = e.target.checked ? "開啟中" : "暫停中"; };

  function pressSeg(id, v) { document.querySelectorAll(`#${id} [data-v]`).forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === v)); }
  function renderSource() {
    const d = H.edit, src = d.source;
    pressSeg("rfSource", src);
    $("rfFbWrap").hidden = src === "story";
    if (src === "story") { $("rfIg").checked = true; $("rfFb").checked = false; }
    $("rfPostWrap").hidden = src === "dm";
    $("rfPostLabel").textContent = src === "story" ? "哪一則限動（限動 24 小時後就看不到，選「全部限動」比較方便）" : "哪一篇貼文";
    $("rfAnyTxt").textContent = src === "dm" ? "不用關鍵字，有私訊就回" : src === "story" ? "不用關鍵字，有回覆就回" : "不用關鍵字，有留言就回";
    $("rfAnyWarn").hidden = !(src === "dm" && $("rfAny").checked);
    $("rfPubStep").hidden = src !== "comment"; $("rfDmNo").textContent = src === "comment" ? "3" : "2";
    $("rfAllWrap").hidden = src !== "comment";
    renderPicker(); renderPreview();
  }
  $("rfSource").onclick = (e) => {
    const b = e.target.closest("[data-v]"); if (!b || H.edit.source === b.dataset.v) return;
    H.edit.source = b.dataset.v; H.edit.post_id = null; H.edit.post_thumb = ""; H.edit.post_caption = "";
    if (b.dataset.v !== "story" && !$("rfFb").checked && !$("rfIg").checked) $("rfIg").checked = true;
    renderSource();
    if (b.dataset.v !== "dm" && !H.media) loadMedia();
  };
  $("rfAny").onchange = () => { $("rfAnyWarn").hidden = !(H.edit.source === "dm" && $("rfAny").checked); };
  ["rfIg", "rfFb"].forEach((id) => $(id).addEventListener("change", () => {
    // 挑了某一篇但把那個平台取消勾 → 改回全部
    const sel = H.edit.post_id && (H.media?.ig || []).concat(H.media?.fb || []).find((m) => m.id === H.edit.post_id);
    if (sel && !$(sel.p === "ig" ? "rfIg" : "rfFb").checked) { H.edit.post_id = null; H.edit.post_thumb = ""; H.edit.post_caption = ""; }
    renderPicker();
  }));

  // 挑貼文
  async function loadMedia() {
    if (!H.settings?.verify_token) return;
    $("rfPicker").innerHTML = `<p class="loading">讀取貼文中…</p>`;
    try {
      const r = await fetch(`${FN}meta-webhook?hub.mode=media&hub.verify_token=${encodeURIComponent(H.settings.verify_token)}`);
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      H.media = { ig: (j.ig || []).map((m) => ({ ...m, p: "ig" })), fb: (j.fb || []).map((m) => ({ ...m, p: "fb" })), stories: (j.stories || []).map((m) => ({ ...m, p: "ig" })) };
      H.mediaErr = [j.ig_error && "IG 貼文", j.fb_error && "FB 貼文", j.stories_error && "IG 限動"].filter(Boolean).join("、");
    } catch (e) { H.media = null; H.mediaErr = "讀不到貼文（" + (e.message || e) + "）"; }
    renderPicker();
  }
  $("rfReload").onclick = loadMedia;
  function renderPicker() {
    const d = H.edit; if (!d || d.source === "dm") return;
    const story = d.source === "story";
    let items = [];
    if (H.media) items = story ? H.media.stories : [...($("rfIg").checked ? H.media.ig : []), ...($("rfFb").checked ? H.media.fb : [])].sort((a, b) => String(b.time).localeCompare(String(a.time)));
    if (d.post_id && !items.some((m) => m.id === d.post_id)) items.unshift({ id: d.post_id, thumb: d.post_thumb, caption: d.post_caption || "（之前選的）", p: d.platforms[0] });
    const all = `<button type="button" class="pk" data-pid="" aria-pressed="${!d.post_id}"><span class="im">${story ? "全部限動" : "全部貼文"}</span><span class="cap">不限定</span></button>`;
    const cards = items.map((m) => `<button type="button" class="pk" data-pid="${esc(m.id)}" aria-pressed="${d.post_id === m.id}" title="${esc(m.caption)}">
      <span class="im">${m.thumb ? `<img src="${esc(m.thumb)}" alt="" loading="lazy">` : esc((m.caption || "").slice(0, 24) || "（沒有圖）")}${story ? "" : `<span class="pf">${m.p === "ig" ? "IG" : "FB"}</span>`}</span>
      <span class="cap">${esc(m.caption || (m.time ? GB.tw(m.time).slice(5, 16) : ""))}</span></button>`).join("");
    const note = !H.media ? `<p class="hint" style="grid-column:1/-1;margin:4px">${esc(H.mediaErr || "讀取貼文中…")}</p>`
      : H.mediaErr ? `<p class="hint" style="grid-column:1/-1;margin:4px">⚠️ ${esc(H.mediaErr)}讀取失敗，可以按「重新讀取」</p>`
      : story && !items.length ? `<p class="hint" style="grid-column:1/-1;margin:4px">現在沒有 24 小時內的限動。</p>` : "";
    $("rfPicker").innerHTML = all + cards + note;
  }
  $("rfPicker").onclick = (e) => {
    const b = e.target.closest("[data-pid]"); if (!b) return;
    const d = H.edit, id = b.dataset.pid;
    if (!id) { d.post_id = null; d.post_thumb = ""; d.post_caption = ""; }
    else {
      const m = [...(H.media?.ig || []), ...(H.media?.fb || []), ...(H.media?.stories || [])].find((x) => x.id === id) || { id, thumb: d.post_thumb, caption: d.post_caption, p: d.platforms[0] };
      d.post_id = m.id; d.post_thumb = m.thumb || ""; d.post_caption = (m.caption || "").slice(0, 120);
      $("rfIg").checked = m.p === "ig"; $("rfFb").checked = m.p === "fb";
    }
    renderPicker();
  };

  // 公開回一句
  function renderPub() {
    const d = H.edit, pool = H.settings?.public_pool || [];
    const extra = (d.public_replies || []).filter((t) => !pool.includes(t));
    const all = [...pool, ...extra];
    $("rfPub").innerHTML = all.length ? all.map((t, i) => `<label class="check"><input type="checkbox" data-pub="${i}" ${d.public_replies.includes(t) ? "checked" : ""}> ${esc(t)}</label>`).join("")
      : `<p class="hint">公開回覆庫是空的，到「💬 公開回覆庫」新增幾句。</p>`;
    $("rfPub").dataset.all = JSON.stringify(all);
  }
  $("rfPub").onchange = () => {
    const all = JSON.parse($("rfPub").dataset.all || "[]");
    H.edit.public_replies = [...$("rfPub").querySelectorAll("[data-pub]:checked")].map((c) => all[+c.dataset.pub]);
    renderPreview();
  };

  // 私訊方式、連結按鈕
  function renderMode() {
    const m = H.edit.mode;
    pressSeg("rfMode", m);
    $("rfGreetBox").hidden = m !== "button";
    $("rfModeWarn").hidden = !(m === "button" && !H.settings?.dm_ready);
    $("rfMsgLabel").textContent = m === "button" ? "客人按了按鈕後收到的內容" : "客人會收到的內容";
    renderPreview();
  }
  $("rfMode").onclick = (e) => { const b = e.target.closest("[data-v]"); if (b) { H.edit.mode = b.dataset.v; H.pvClicked = false; renderMode(); } };
  $("rfBtnPresets").onclick = (e) => { const b = e.target.closest("[data-p]"); if (b) { $("rfBtn").value = b.dataset.p; renderPreview(); } };
  function renderLinks() {
    const L = H.edit.link_buttons;
    $("rfLinks").innerHTML = L.map((b, i) => `<div class="lk"><input class="input" data-li="${i}" data-k="title" maxlength="20" value="${esc(b.title)}" placeholder="按鈕字，例如：🛒 團購連結" aria-label="按鈕上的字">
      <input class="input" data-li="${i}" data-k="url" type="url" value="${esc(b.url)}" placeholder="https://…" aria-label="網址"><button type="button" data-lrm="${i}" aria-label="拿掉這顆">✕</button></div>`).join("");
    $("rfLinkAdd").hidden = L.length >= 3;
    renderPreview();
  }
  $("rfLinkAdd").onclick = () => { H.edit.link_buttons.push({ title: "", url: "" }); renderLinks(); const ins = $("rfLinks").querySelectorAll('[data-k="title"]'); ins[ins.length - 1]?.focus(); };
  $("rfLinks").addEventListener("input", (e) => { const i = e.target.dataset.li; if (i === undefined) return; H.edit.link_buttons[+i][e.target.dataset.k] = e.target.value; renderPreview(); });
  $("rfLinks").addEventListener("click", (e) => { const b = e.target.closest("[data-lrm]"); if (b) { H.edit.link_buttons.splice(+b.dataset.lrm, 1); renderLinks(); } });
  ["rfGreet", "rfBtn", "rfMsg", "rfInvite", "rfIg", "rfFb"].forEach((id) => $(id).addEventListener("input", renderPreview));
  $("rfInvite").addEventListener("change", renderPreview);

  // 預覽：客人會看到
  function renderPreview() {
    const d = H.edit; if (!d) return;
    const s = H.settings || {};
    const ig = $("rfIg").checked || d.source === "story";
    const invite = $("rfInvite").checked ? (ig ? s.invite_ig : s.invite_fb) : "";
    const content = [$("rfMsg").value.trim(), invite].filter(Boolean).join("\n\n");
    const links = d.link_buttons.filter((b) => b.title || b.url);
    const card = (text, btns) => `<div class="card2"><div class="tx">${esc(text) || '<span style="color:#999">（還沒寫內容）</span>'}</div>${btns.join("")}</div>`;
    let h = "";
    if (d.source === "comment") {
      h += `<div class="sec">💬 妳在留言底下回（每次隨機挑一句）</div>`;
      h += d.public_replies.length ? `<div class="bub pub">${esc(pickOne(d.public_replies))}</div>` : `<div class="bub pub empty">（沒有勾公開回覆）</div>`;
    }
    const btnMode = d.mode === "button";
    h += `<div class="sec">✉️ 私訊${btnMode ? "（觸發後先收到招呼）" : "（觸發後直接收到）"}</div>`;
    if (btnMode) {
      const label = $("rfBtn").value.trim() || BTN_DEFAULT;
      h += card($("rfGreet").value.trim() || s.default_greeting || "", [`<button type="button" class="cb" data-pvclick>${esc(label)}</button>`]);
      if (H.pvClicked) {
        h += `<div class="bub me">${esc(label)}</div>`;
        h += card(content, links.map((b) => `<span class="cb">${esc(b.title || "🔗 連結")}</span>`));
      } else h += `<div class="sec">↑ 點按鈕看看客人按了之後收到什麼</div>`;
      if (!s.dm_ready) h += `<div class="sec">⏳ Meta 核准前：客人會跳過按鈕這一步，直接收到「按了之後」的那則內容</div>`;
    } else {
      h += card(content, links.map((b) => `<span class="cb">${esc(b.title || "🔗 連結")}</span>`));
    }
    h += `<div class="sec">卡片文字最多 640 字，太長會改成純文字＋網址。</div>`;
    $("rfPreview").innerHTML = h;
  }
  $("rfPreview").onclick = (e) => { if (e.target.closest("[data-pvclick]")) { H.pvClicked = !H.pvClicked; renderPreview(); } };

  $("ruleForm").onsubmit = async (e) => {
    e.preventDefault();
    const d = H.edit;
    const links = d.link_buttons.map((b) => ({ title: (b.title || "").trim().slice(0, 20), url: (b.url || "").trim() })).filter((b) => b.title || b.url);
    const row = {
      name: $("rfName").value.trim(), source: d.source, keywords: commas($("rfKeys").value), fuzzy: $("rfFuzzy").checked, any_text: $("rfAny").checked,
      platforms: d.source === "story" ? ["ig"] : [$("rfIg").checked && "ig", $("rfFb").checked && "fb"].filter(Boolean),
      post_id: d.source === "dm" ? null : d.post_id, post_thumb: d.source === "dm" ? "" : d.post_thumb || "", post_caption: d.source === "dm" ? "" : d.post_caption || "",
      public_replies: d.source === "comment" ? d.public_replies : [],
      mode: d.mode, greeting: $("rfGreet").value.trim(), button_label: ($("rfBtn").value.trim() || BTN_DEFAULT).slice(0, 20),
      message: $("rfMsg").value.trim(), link: "", link_buttons: links, follow_invite: $("rfInvite").checked,
      starts_at: fromLocal($("rfStart").value), ends_at: fromLocal($("rfEnd").value),
      allow_repeat: $("rfRepeat").checked, all_posts: $("rfAll").checked, campaign_id: $("rfCamp").value ? +$("rfCamp").value : null,
      active: $("rfActive").checked, require_follow: false,
    };
    const bad = !row.any_text && !row.keywords.length ? "請填關鍵字，或勾「不用關鍵字」"
      : !row.platforms.length ? "請至少勾一個平台"
      : links.some((b) => !b.title) ? "連結按鈕要寫按鈕上的字"
      : links.some((b) => !/^https?:\/\//i.test(b.url)) ? "連結按鈕的網址要以 https:// 開頭"
      : !row.message && !links.length ? "請寫客人會收到的內容，或加連結按鈕"
      : row.starts_at && row.ends_at && row.starts_at > row.ends_at ? "結束時間要在開始之後" : "";
    if (bad) { $("ruleErr").textContent = bad; $("ruleErr").hidden = false; return; }
    const { error } = H.editId ? await sb.from("reply_rules").update(row).eq("id", H.editId) : await sb.from("reply_rules").insert(row);
    if (error) { $("ruleErr").textContent = errMsg(error); $("ruleErr").hidden = false; return; }
    toast("規則已儲存"); closeRule(); reloadRules();
  };
  $("ruleDel").onclick = async () => {
    if (!confirm("確定要刪除這條規則嗎？（只是先不用的話，可以在列表按「封存」）")) return;
    const { error } = await sb.from("reply_rules").delete().eq("id", H.editId);
    if (error) return toast(errMsg(error));
    toast("已刪除"); closeRule(); reloadRules();
  };

  // ---------- 公開回覆庫 ----------
  function renderPool() {
    const pool = H.settings?.public_pool || [];
    const used = (t) => H.rules.filter((r) => (r.public_replies || []).includes(t)).length;
    $("poolList").innerHTML = pool.length ? pool.map((t, i) => `<div class="prow"><input class="input" data-pool="${i}" value="${esc(t)}" aria-label="公開回覆第 ${i + 1} 句">
      <span class="used">${used(t) ? `用在 ${used(t)} 條規則` : "沒在用"}</span><button class="btn small red" type="button" data-pdel="${i}">刪除</button></div>`).join("")
      : `<p class="hint">還沒有句子，在下面新增。</p>`;
  }
  async function replaceInRules(oldT, newT) {
    const hits = H.rules.filter((r) => (r.public_replies || []).includes(oldT));
    for (const r of hits) {
      const list = r.public_replies.map((t) => (t === oldT ? newT : t)).filter((t) => t !== null);
      await sb.from("reply_rules").update({ public_replies: list }).eq("id", r.id);
      r.public_replies = list;
    }
  }
  $("poolList").addEventListener("change", async (e) => {
    const i = e.target.dataset.pool; if (i === undefined) return;
    const pool = [...H.settings.public_pool], oldT = pool[+i], newT = e.target.value.trim();
    if (!newT || newT === oldT) { e.target.value = oldT; return; }
    pool[+i] = newT;
    if (await saveSettings({ public_pool: pool })) { await replaceInRules(oldT, newT); renderPool(); toast("已更新"); }
  });
  $("poolList").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-pdel]"); if (!b) return;
    const pool = [...H.settings.public_pool], t = pool[+b.dataset.pdel];
    const n = H.rules.filter((r) => (r.public_replies || []).includes(t)).length;
    if (n && !confirm(`這句用在 ${n} 條規則，刪除後那些規則就不會再用這句。確定刪除？`)) return;
    pool.splice(+b.dataset.pdel, 1);
    if (await saveSettings({ public_pool: pool })) { await replaceInRules(t, null); renderPool(); toast("已刪除"); }
  });
  $("poolAdd").onclick = async () => {
    const t = $("poolNew").value.trim(); if (!t) return;
    const pool = [...(H.settings.public_pool || [])]; if (pool.includes(t)) return toast("已經有這句了");
    pool.push(t);
    if (await saveSettings({ public_pool: pool }, "已新增")) { $("poolNew").value = ""; renderPool(); }
  };
  $("poolNew").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("poolAdd").click(); } });

  // ---------- 紀錄、需要妳回 ----------
  const LOG_FILTERS = [["all", "全部"], ["done", "已送出"], ["click", "按了按鈕"], ["problem", "失敗／略過"]];
  const ACTION_TXT = { greet: "送出招呼＋按鈕", sent: "送出內容", click: "按了按鈕・送出內容", thanks: "回謝謝", ai: "AI 回答", skip: "略過",
    keyword: "關鍵字", gate_ok: "送出內容", gate_wait: "請對方追蹤", flow: "按鈕選單" };
  const KIND_TXT = { comment: "留言", message: "私訊", story: "限動回覆" };
  const STATUS_TXT = { done: ["p-ready", "已回覆"], skipped: ["p-wait", "略過"], needs_human: ["p-open", "要妳處理"], error: ["p-part", "出錯"] };
  const isNeed = (l) => (l.status === "needs_human" || l.status === "error") && !l.handled;
  async function loadLogs() {
    const { data, error } = await sb.from("reply_log").select("*").order("created_at", { ascending: false }).limit(200);
    if (error) return;
    H.logs = data; renderLogs();
  }
  function logRow(l, withDone) {
    const [pc, pt] = STATUS_TXT[l.status] || ["p-wait", l.status];
    const rule = l.rule_id && H.rules.find((r) => r.id === l.rule_id);
    return `<div class="lrow ${esc(l.status)}">
      <div class="lh"><span class="pill ${pc}">${pt}</span><b>${l.platform === "ig" ? "IG" : "FB"} ${KIND_TXT[l.kind] || ""}</b><span>${esc(l.user_name || "")}</span><span>${GB.tw(l.created_at).slice(5, 16)}</span>${l.action ? `<span>${ACTION_TXT[l.action] || esc(l.action)}</span>` : ""}${rule ? `<span>⚡ ${esc(rule.name || rule.keywords.join("、"))}</span>` : ""}
        ${withDone && isNeed(l) ? `<button class="btn small" type="button" data-done="${l.id}" style="margin-left:auto">已處理</button>` : ""}</div>
      ${l.text ? `<div class="lt">「${esc(l.text)}」</div>` : ""}
      ${l.reply ? `<div class="lr">${esc(l.reply)}</div>` : ""}
      ${l.error ? `<div class="hint" style="margin:4px 0 0;color:var(--ship-ink)">${esc(l.error)}</div>` : ""}
    </div>`;
  }
  function renderLogs() {
    const need = H.logs.filter(isNeed);
    [$("needBadge"), $("replyBadge")].forEach((b) => { b.hidden = !need.length; b.textContent = need.length; });
    $("needList").innerHTML = need.length ? need.map((l) => logRow(l, true)).join("") : `<p class="hint">目前沒有需要妳處理的留言 🎉</p>`;
    $("logFilters").innerHTML = LOG_FILTERS.map(([k, l]) => `<button class="chipbtn" type="button" data-lf="${k}" aria-pressed="${H.logFilter === k}">${l}</button>`).join("");
    const f = H.logFilter;
    const list = H.logs.filter((l) => f === "all" || (f === "done" ? l.status === "done" : f === "click" ? l.action === "click" : l.status !== "done"));
    $("logList").innerHTML = list.length ? list.map((l) => logRow(l, true)).join("") : `<p class="hint">還沒有紀錄。</p>`;
  }
  if (H.logFilter === "need") H.logFilter = "all";
  $("logFilters").onclick = (e) => { const b = e.target.closest("[data-lf]"); if (b) { H.logFilter = b.dataset.lf; renderLogs(); } };
  const markDone = async (e) => {
    const b = e.target.closest("[data-done]"); if (!b) return;
    const { error } = await sb.from("reply_log").update({ handled: true }).eq("id", +b.dataset.done);
    if (error) return toast(errMsg(error));
    H.logs.find((l) => l.id === +b.dataset.done).handled = true; renderLogs();
  };
  $("needList").onclick = markDone; $("logList").onclick = markDone;

  // ---------- 設定 ----------
  function renderSettings() {
    const s = H.settings; if (!s) return;
    $("sDmReady").checked = !!s.dm_ready; $("sTyping").checked = s.typing !== false; $("sDelay").value = s.delay_sec ?? 1.3;
    $("sThanks").checked = s.thanks_enabled !== false; $("sThanksTxt").value = (s.thanks_replies || []).join("\n");
    $("sGreet").value = s.default_greeting || ""; $("sInviteIg").value = s.invite_ig || ""; $("sInviteFb").value = s.invite_fb || "";
    $("sAi").checked = !!s.ai_enabled; $("sStyle").value = s.ai_style || "";
    $("sSince").value = toLocal(s.active_since);
    $("whUrl").textContent = FN + "meta-webhook"; $("whToken").textContent = s.verify_token;
  }
  $("sDmReady").onchange = (e) => {
    if (e.target.checked && !confirm("確定 Meta 已經核准私訊權限了嗎？\n打開後，「先按按鈕再給」的規則會先送招呼＋按鈕；如果其實還沒核准，客人按了按鈕會沒反應。")) { e.target.checked = false; return; }
    saveSettings({ dm_ready: e.target.checked }, e.target.checked ? "已打開：按鈕、限動、私訊規則開始運作" : "已關閉：先按按鈕的規則改成直接給");
  };
  $("sTyping").onchange = (e) => saveSettings({ typing: e.target.checked }, "已儲存");
  $("sThanks").onchange = (e) => saveSettings({ thanks_enabled: e.target.checked }, "已儲存");
  $("sAi").onchange = (e) => saveSettings({ ai_enabled: e.target.checked }, "已儲存");
  $("sSince").onchange = (e) => { const v = e.target.value; saveSettings({ active_since: fromLocal(v) }, v ? "已儲存：這個時間之前的貼文不自動回覆" : "已儲存：所有貼文都會自動回覆"); };
  $("rs-settings").onsubmit = (e) => {
    e.preventDefault();
    const delay = Math.min(5, Math.max(0, Number($("sDelay").value) || 0));
    saveSettings({ delay_sec: delay, thanks_replies: lines($("sThanksTxt").value), default_greeting: $("sGreet").value.trim(),
      invite_ig: $("sInviteIg").value.trim(), invite_fb: $("sInviteFb").value.trim(), ai_style: $("sStyle").value.trim() }, "設定已儲存");
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
      if (k === "copy") { H.copyEdit = null; loadCamps().then(renderCopy); }
      if (k === "reply") { if (!H.loaded.reply) { H.loaded.reply = 1; loadReply(); } else loadLogs(); }
    },
  };
  // 等後台確認身分後：管理者先讀一次紀錄（分頁紅點）；如果剛從 Facebook 授權回來，就完成連接
  (async () => {
    for (let i = 0; i < 40 && !S.role; i++) await new Promise((r) => setTimeout(r, 250));
    if (S.role !== "admin") return;
    if (metaResult) {
      showTab("reply"); setSub("settings");
      toast(metaResult === "ok" ? "已連接粉絲頁與 IG 🎉" : "連接失敗：" + metaResult);
    } else loadLogs();
  })();
  // 每 2 分鐘看一下有沒有需要處理的留言（顯示在分頁的紅點）
  setInterval(() => { if (S.role === "admin" && H.loaded.reply) loadLogs(); }, 120000);
})();
