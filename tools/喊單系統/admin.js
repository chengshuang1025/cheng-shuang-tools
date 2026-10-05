// 後台：管理者看全部；夥伴只看商品與訂貨
const $ = (id) => document.getElementById(id);
const { esc, fmt, md, toast, errMsg, ST } = GB;

const S = { role: null, uid: null, myName: "", rounds: [], rid: null, products: [], items: [], customers: [], demand: [], filter: "all", tab: "cust", parsed: [], viewId: null };
const isAdmin = () => S.role === "admin";
const prod = (id) => S.products.find((p) => p.id === id);
const sortCode = (a, b) => String(a.code).localeCompare(String(b.code), "zh-Hant", { numeric: true });

// ---------- 啟動 ----------
let started = false;
sb.auth.onAuthStateChange((_e, session) => {
  if (started && session) return;
  started = true;
  setTimeout(() => boot(session), 0);
});

async function boot(session) {
  if (!session) { $("v-login").hidden = false; return; }
  S.uid = session.user.id;
  const { data: p } = await sb.from("profiles").select("role, display_name").eq("id", S.uid).maybeSingle();
  S.role = p?.role || "customer";
  S.myName = p?.display_name || "";
  $("whoBox").hidden = false;
  $("meName").textContent = S.myName || "我";
  $("meRole").textContent = { admin: "管理者", partner: "夥伴", customer: "客人" }[S.role];
  if (S.role === "customer") { $("v-noperm").hidden = false; return; }
  $("v-app").hidden = false;
  if (!isAdmin()) {
    document.querySelectorAll(".tab").forEach((t) => { t.hidden = !["prod", "order"].includes(t.dataset.p); });
    $("roundAdmin").hidden = true; $("prodAdd").hidden = true;
    S.tab = "order";
  }
  showTab(S.tab);
  await loadRounds();
  if (isAdmin()) { loadShips(); setInterval(loadShips, 60000); }
}
$("logout").onclick = async () => { await sb.auth.signOut(); location.href = "./"; };

// ---------- 團 ----------
async function loadRounds(selectId) {
  const { data, error } = await sb.from("rounds").select("*").order("created_at", { ascending: false });
  if (error) return toast(errMsg(error));
  S.rounds = data;
  if (!data.length) {
    $("roundSel").innerHTML = `<option>還沒有團</option>`;
    $("rows").innerHTML = `<div class="card"><p class="hint" style="margin:0">還沒有建立任何團。按上面的「＋ 開新團」建立第一團，再到「商品」分頁加商品。</p></div>`;
    if (isAdmin()) $("newRoundForm").hidden = false;
    return;
  }
  S.rid = selectId || (S.rounds.some((r) => r.id === S.rid) ? S.rid : data[0].id);
  $("roundSel").innerHTML = data.map((r) => `<option value="${r.id}" ${r.id === S.rid ? "selected" : ""}>${esc(r.title)}${r.close_date ? `（${md(r.close_date)} 收單）` : ""}</option>`).join("");
  await loadRound();
}
$("roundSel").onchange = (e) => { S.rid = +e.target.value; loadRound(); };
$("newRoundBtn").onclick = () => { $("newRoundForm").hidden = false; $("nrTitle").focus(); };
$("nrCancel").onclick = () => { $("newRoundForm").hidden = true; };
$("newRoundForm").onsubmit = async (e) => {
  e.preventDefault();
  const { data, error } = await sb.from("rounds").insert({ title: $("nrTitle").value.trim(), close_date: $("nrClose").value || null }).select().single();
  if (error) return toast(errMsg(error));
  $("newRoundForm").hidden = true; $("nrTitle").value = ""; $("nrClose").value = "";
  toast(`已建立「${data.title}」`);
  await loadRounds(data.id);
};

async function loadRound() {
  const { data: products, error } = await sb.from("products").select("*").eq("round_id", S.rid);
  if (error) return toast(errMsg(error));
  S.products = products.sort(sortCode);
  const { data: demand } = await sb.from("product_demand").select("id, needed_qty").eq("round_id", S.rid);
  S.demand = demand || [];
  if (isAdmin()) {
    const ids = S.products.map((p) => p.id);
    const { data: items } = ids.length ? await sb.from("order_items").select("*").in("product_id", ids) : { data: [] };
    S.items = items || [];
    const { data: customers } = await sb.from("customers").select("*").order("fb_name");
    S.customers = customers || [];
  }
  renderAll();
}

// ---------- 分頁 ----------
function showTab(k) {
  S.tab = k;
  document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", t.dataset.p === k));
  ["ship", "cust", "prod", "order", "imp", "view", "acct"].forEach((x) => { $("p-" + x).hidden = x !== k; });
  if (k === "acct") loadAccounts();
  if (k === "ship") loadShips();
}
$("tabs").onclick = (e) => { const t = e.target.closest(".tab"); if (t) { showTab(t.dataset.p); renderAll(); } };

function renderAll() {
  if (isAdmin()) { renderStats(); renderRows(); renderPreview(); }
  renderProds(); renderOrder();
}

// ---------- 客人總覽 ----------
function custItems(cid) { return S.items.filter((i) => i.customer_id === cid); }
function status(list) {
  const un = list.filter((i) => !i.shipped_at);
  if (!un.length) return ["ship", "已安排出貨"];
  const ar = un.filter((i) => prod(i.product_id)?.status === "arrived");
  if (ar.length === un.length) return ["ready", "可出貨"];
  if (ar.length) return ["part", "部分可出"];
  return ["wait", "等待到貨"];
}
const goods = (list) => list.reduce((s, i) => s + (prod(i.product_id)?.price || 0) * i.qty, 0);
function roundCustomers() {
  const ids = new Set(S.items.map((i) => i.customer_id));
  return S.customers.filter((c) => ids.has(c.id));
}
const FILTERS = [["all", "全部"], ["ready", "可出貨未安排"], ["ship", "已安排出貨"], ["wait", "等待到貨"], ["unbound", "還沒綁定帳號"]];

function renderStats() {
  const cs = roundCustomers();
  const cnt = (k) => cs.filter((c) => status(custItems(c.id))[0] === k).length;
  const due = cs.reduce((s, c) => s + goods(custItems(c.id)) + (c.extra_fee || 0), 0);
  $("stats").innerHTML = `
    <div class="stat"><b>${cs.length}</b><span>喊單客人</span></div>
    <div class="stat"><b>${cnt("ready") + cnt("part")}</b><span>可出貨・還沒安排</span></div>
    <div class="stat"><b>${cnt("ship")}</b><span>已安排出貨</span></div>
    <div class="stat"><b>$${fmt(due)}</b><span>應收合計</span></div>`;
  $("filters").innerHTML = FILTERS.map(([k, l]) => `<button class="chipbtn" type="button" aria-pressed="${S.filter === k}" data-f="${k}">${l}</button>`).join("");
}

function renderRows() {
  const q = $("custq").value.trim().toLowerCase();
  if (!S.products.length) { $("rows").innerHTML = `<div class="card"><p class="hint" style="margin:0">這一團還沒有商品。先到「商品」分頁加商品，再到「匯入社團留言」匯入喊單。</p></div>`; return; }
  const list = roundCustomers().filter((c) => {
    if (q && !c.fb_name.toLowerCase().includes(q)) return false;
    const s = status(custItems(c.id))[0];
    if (S.filter === "ready") return s === "ready" || s === "part";
    if (S.filter === "unbound") return !c.user_id;
    if (S.filter === "all") return true;
    return s === S.filter;
  });
  if (!list.length) { $("rows").innerHTML = `<p class="hint">${q ? `找不到符合「${esc(q)}」的客人。` : roundCustomers().length ? "這個篩選目前沒有客人。" : "這一團還沒有喊單。到「匯入社團留言」貼上留言就會出現。"}</p>`; return; }
  $("rows").innerHTML = list.map((c) => {
    const its = custItems(c.id);
    const [s, l] = status(its);
    const g = goods(its);
    const canShip = its.some((i) => !i.shipped_at && prod(i.product_id)?.status === "arrived");
    const shipped = its.filter((i) => i.shipped_at);
    const chips = its.slice().sort((a, b) => sortCode(prod(a.product_id), prod(b.product_id))).map((i) => {
      const p = prod(i.product_id);
      const cls = i.shipped_at ? "done" : p.status === "arrived" ? "arrived" : "";
      return `<span class="it ${cls}" title="${i.shipped_at ? "出貨 " + md(i.shipped_at) : ST[p.status]}${i.source === "self" ? "・客人自己 +1" : ""}">${esc(p.code)}・${esc(p.name)}×${i.qty}</span>`;
    }).join(" ");
    const act = s === "ship"
      ? `<small>出貨 ${md(shipped[0].shipped_at)}</small><button class="btn small" type="button" data-undo="${c.id}">取消出貨</button>`
      : `<button class="btn ship" type="button" data-ship="${c.id}" ${canShip ? "" : "disabled"}>${s === "part" ? "先出已到貨" : "安排出貨"}</button>${shipped.length ? `<button class="btn small" type="button" data-undo="${c.id}">取消已出部分</button>` : ""}`;
    return `<div class="row ${s === "ship" ? "shipped" : ""}">
      <div class="name">${esc(c.fb_name)}<small>${c.user_id ? "✓ 已綁定帳號" : "還沒綁定帳號"}${S.pendingCust?.has(c.id) ? `・<b style="color:var(--ship-ink)">已申請出貨</b>` : ""}</small></div>
      <div class="items">${chips}</div>
      <div class="money"><div class="tot">$${fmt(g + (c.extra_fee || 0))}</div>${c.extra_fee ? `<div class="ex">商品 ${fmt(g)} + 其他 ${fmt(c.extra_fee)}</div>` : ""}</div>
      <span class="pill p-${s}">${l}</span>
      <div class="act">${act}</div>
      <div class="more">
        <label>其他費用 <input class="ef" type="number" id="ef-${c.id}" data-ef="${c.id}" value="${c.extra_fee || 0}"></label>
        <label>手機 <input class="ph" type="tel" id="ph-${c.id}" data-ph="${c.id}" value="${esc(c.phone || "")}" placeholder="綁定手機帳號用"></label>
        <input class="nt" id="nt-${c.id}" data-nt="${c.id}" value="${esc(c.note || "")}" placeholder="備註，例如：補寄錘子扣環（客人看得到）">
      </div>
    </div>`;
  }).join("");
}
$("custq").oninput = renderRows;

// ---------- 商品 ----------
function renderProds() {
  const tot = (pid) => S.items.filter((i) => i.product_id === pid).reduce((a, i) => a + i.qty, 0);
  const sh = (pid) => S.items.filter((i) => i.product_id === pid && i.shipped_at).reduce((a, i) => a + i.qty, 0);
  const need = (pid) => S.demand.find((d) => d.id === pid)?.needed_qty ?? 0;
  if (!S.products.length) { $("prows").innerHTML = `<tr><td colspan="8" style="white-space:normal">${isAdmin() ? "這一團還沒有商品，用下面的表單加入。" : "這一團還沒有商品。"}</td></tr>`; return; }
  $("prows").innerHTML = S.products.map((p) => isAdmin() ? `<tr>
      <td><input class="qty" style="width:64px;text-align:left" id="pc-${p.id}" data-pf="code" data-pid="${p.id}" value="${esc(p.code)}" aria-label="代碼"></td>
      <td><input class="input" style="padding:3px 8px;min-width:160px" id="pn-${p.id}" data-pf="name" data-pid="${p.id}" value="${esc(p.name)}" aria-label="商品名稱"></td>
      <td class="n"><input class="qty" type="number" min="0" id="pp-${p.id}" data-pf="price" data-pid="${p.id}" value="${p.price ?? ""}" placeholder="待定" aria-label="單價"></td>
      <td class="n">${tot(p.id)}</td><td class="n">${sh(p.id)}</td>
      <td><select id="ps-${p.id}" data-st="${p.id}" aria-label="狀態">${Object.entries(ST).map(([k, l]) => `<option value="${k}" ${p.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></td>
      ${noteCell(p)}
      <td><button class="btn small" type="button" data-delp="${p.id}">刪除</button></td></tr>`
    : `<tr><td><span class="code">${esc(p.code)}</span></td><td>${esc(p.name)}</td><td class="n">${p.price != null ? "$" + fmt(p.price) : "待定"}</td>
      <td class="n">${need(p.id)}</td><td class="n">—</td><td><span class="pill p-${p.status === "arrived" ? "ready" : p.status === "open" ? "open" : "wait"}">${ST[p.status]}</span></td>${noteCell(p)}<td></td></tr>`
  ).join("");
}
const noteCell = (p) => `<td class="wrapcell"><textarea id="note-${p.id}" data-note="${p.id}" aria-label="${esc(p.name)} 備註" placeholder="寫給自己或夥伴的備註">${esc(p.note)}</textarea>${p.note_by ? `<small>最後由 ${esc(p.note_by)} 編輯${p.note_at ? "・" + md(p.note_at.slice(0, 10)) : ""}</small>` : ""}</td>`;

$("addProd").onsubmit = async (e) => {
  e.preventDefault();
  const row = { round_id: S.rid, code: $("apCode").value.trim(), name: $("apName").value.trim(), price: $("apPrice").value === "" ? null : +$("apPrice").value };
  const { error } = await sb.from("products").insert(row);
  if (error) return toast(/duplicate|unique/i.test(error.message) ? `代碼「${row.code}」這一團已經用過了` : errMsg(error));
  $("apCode").value = ""; $("apName").value = ""; $("apPrice").value = ""; $("apCode").focus();
  toast(`已加入 ${row.name}`); loadRound();
};
$("bulkProdBtn").onclick = async () => {
  const rows = $("bulkProd").value.split("\n").map((l) => l.split(/\t|,|，/).map((x) => x.trim())).filter((a) => a[0] && a[1])
    .map(([code, name, price]) => ({ round_id: S.rid, code, name, price: price ? +String(price).replace(/[^\d.]/g, "") || null : null }));
  if (!rows.length) return toast("沒有讀到商品，請確認每行有代碼和名稱");
  const { error } = await sb.from("products").insert(rows);
  if (error) return toast(/duplicate|unique/i.test(error.message) ? "有代碼重複了，請檢查後再試" : errMsg(error));
  $("bulkProd").value = ""; toast(`已加入 ${rows.length} 個商品`); loadRound();
};

// ---------- 訂貨 ----------
function renderOrder() {
  const rows = S.products.map((p) => {
    const n = S.demand.find((d) => d.id === p.id)?.needed_qty ?? 0;
    const left = Math.max(0, n - (p.ordered_qty || 0));
    const [cls, l] = n === 0 ? ["p-wait", "還沒有人喊"] : !p.ordered_qty ? ["p-wait", "未訂貨"] : left ? ["p-part", "部分已訂"] : ["p-ready", "已訂齊"];
    return { p, n, left, cls, l };
  });
  const lack = rows.filter((r) => r.left > 0);
  $("ostats").innerHTML = `
    <div class="stat"><b>${lack.length}</b><span>商品還要訂</span></div>
    <div class="stat"><b>${lack.reduce((s, r) => s + r.left, 0)}</b><span>總共還差幾件</span></div>
    <div class="stat"><b>${rows.filter((r) => r.n && !r.left).length}</b><span>已訂齊</span></div>`;
  $("orows").innerHTML = rows.length ? rows.map(({ p, n, left, cls, l }) => `<tr>
    <td><span class="code">${esc(p.code)}</span></td><td>${esc(p.name)}</td><td class="n">${n}</td>
    <td class="n"><input class="qty" type="number" min="0" id="ord-${p.id}" data-ord="${p.id}" value="${p.ordered_qty || 0}" aria-label="${esc(p.name)} 已訂數量"></td>
    <td class="n ${left ? "need" : ""}">${left || "—"}</td>
    <td><span class="pill ${cls}">${l}</span></td>${noteCell(p)}</tr>`).join("")
    : `<tr><td colspan="7">這一團還沒有商品。</td></tr>`;
}

// ---------- 匯入社團留言 ----------
const RE = /([A-Za-z0-9一-鿿]+?)\s*[+＋]\s*(\d+)/g;
const NOISE = /^(\d+\s*(秒|分鐘|小時|天|週|年).*|讚|回覆|分享|已編輯|查看翻譯|作者|頂尖粉絲|.*·\s*(讚|回覆).*|\d+)$/;
function findP(tok) {
  tok = tok.trim().toLowerCase();
  return S.products.find((p) => String(p.code).toLowerCase() === tok) || S.products.find((p) => p.name.toLowerCase().includes(tok) || tok.includes(p.name.toLowerCase()));
}
$("parse").onclick = () => {
  if (!S.products.length) return toast("這一團還沒有商品，請先到「商品」分頁加入");
  const lines = $("paste").value.split("\n").map((s) => s.trim()).filter((s) => s && !NOISE.test(s));
  const ok = [], bad = []; let cur = null, used = false;
  for (const L of lines) {
    const m = [...L.matchAll(RE)];
    if (m.length) {
      if (!cur) { bad.push(`找不到留言者：「${L}」`); continue; }
      for (const x of m) { const p = findP(x[1]); p ? ok.push({ name: cur, pid: p.id, q: +x[2] }) : bad.push(`${cur}：「${x[0]}」對不到商品代碼`); }
      used = true;
    } else if (cur && !used) { bad.push(`${cur}：「${L}」沒有 +數量，請手動確認`); cur = null; }
    else { cur = L; used = false; }
  }
  S.parsed = ok;
  $("result").innerHTML = `<strong style="font-size:14px">辨識到 ${ok.length} 筆喊單</strong>` +
    ok.map((o) => { const p = prod(o.pid); return `<div class="ok"><span>${esc(o.name)}</span><span><span class="code">${esc(p.code)}</span> ${esc(p.name)} ×${o.q}</span></div>`; }).join("") +
    (bad.length ? `<strong style="font-size:14px;margin-top:8px">需要你確認 ${bad.length} 筆</strong>` + bad.map((b) => `<div class="err" style="margin:0">${esc(b)}</div>`).join("") : "");
  $("addImp").disabled = !ok.length;
};
$("addImp").onclick = async () => {
  $("addImp").disabled = true;
  try {
    const byName = {};
    for (const o of S.parsed) {
      const key = o.name.toLowerCase();
      let c = S.customers.find((x) => x.fb_name.toLowerCase() === key) || byName[key];
      if (!c) {
        const { data, error } = await sb.from("customers").insert({ fb_name: o.name }).select().single();
        if (error) throw error;
        c = data; S.customers.push(c);
      }
      byName[key] = c;
      const ex = S.items.find((i) => i.customer_id === c.id && i.product_id === o.pid && !i.shipped_at);
      if (ex) {
        const { error } = await sb.from("order_items").update({ qty: ex.qty + o.q }).eq("id", ex.id);
        if (error) throw error; ex.qty += o.q;
      } else {
        const { data, error } = await sb.from("order_items").insert({ customer_id: c.id, product_id: o.pid, qty: o.q, source: "import" }).select().single();
        if (error) throw error; S.items.push(data);
      }
    }
    toast(`已加入 ${S.parsed.length} 筆喊單`);
    S.parsed = []; $("paste").value = "";
    $("result").innerHTML = `<span style="color:var(--muted);font-size:14px">已加入。可以到「客人總覽」查看。</span>`;
    await loadRound();
  } catch (e) { toast(errMsg(e)); $("addImp").disabled = false; }
};

// ---------- 客人看到的畫面 ----------
function renderPreview() {
  const q = $("whoq").value.trim().toLowerCase();
  const hits = q ? S.customers.filter((c) => c.fb_name.toLowerCase().includes(q)) : [];
  if (hits.length === 1) S.viewId = hits[0].id;
  $("whores").innerHTML = !q ? "" : hits.length ? hits.slice(0, 12).map((c) => `<button class="chipbtn" type="button" data-who="${c.id}" aria-pressed="${c.id === S.viewId}">${esc(c.fb_name)}</button>`).join("") : `<span class="hint" style="margin:0">找不到這位客人</span>`;
  const c = S.customers.find((x) => x.id === S.viewId);
  if (!c) { $("preview").innerHTML = `<p class="hint" style="text-align:center">在上面輸入客人名字，這裡會顯示他登入後看到的畫面。</p>`; return; }
  const its = custItems(c.id); const [s, l] = status(its); const g = goods(its);
  $("preview").innerHTML = `<div class="envelope">
    <div style="font-size:12px;color:var(--muted)">好事丞雙 團購查詢（預覽：這一團）</div>
    <h3>${esc(c.fb_name)}</h3>
    ${its.length ? `<span class="pill p-${s}" style="margin:4px 0 8px">${l}</span>` : ""}
    ${its.map((i) => { const p = prod(i.product_id);
      const t = i.shipped_at ? [`已安排出貨 ${md(i.shipped_at)}`, "var(--ship-ink)"] : p.status === "arrived" ? ["已到貨・等待出貨", "var(--ready)"] : [ST[p.status], "var(--wait)"];
      return `<div class="li"><div>${esc(p.name)} ×${i.qty}<br><em style="color:${t[1]}">${t[0]}</em></div><div class="money">${p.price != null ? "$" + fmt(p.price * i.qty) : "待定"}</div></div>`; }).join("") || `<p class="hint">這一團沒有他的喊單。</p>`}
    ${c.extra_fee ? `<div class="li"><div>運費／其他費用</div><div class="money">$${fmt(c.extra_fee)}</div></div>` : ""}
    <div class="li total"><div>應付金額</div><div class="money">$${fmt(g + (c.extra_fee || 0))}</div></div>
    ${c.note ? `<p class="hint" style="margin:8px 0 0">團主備註：${esc(c.note)}</p>` : ""}
  </div>`;
}
$("whoq").oninput = renderPreview;

// ---------- 出貨申請 ----------
const SHIP_FEE_TXT = "統一使用全家好賣家 $39 元出貨";
const cp = (text) => `<button class="cp" type="button" data-cp="${esc(text)}">複製</button>`;
async function loadShips() {
  const { data: reqs, error } = await sb.from("ship_requests")
    .select("*, customers(fb_name, phone, note)").in("status", ["pending", "done"])
    .order("created_at", { ascending: true }).limit(200);
  if (error) { $("shipList").innerHTML = `<p class="err">${esc(errMsg(error))}</p>`; return; }
  const ids = [...new Set(reqs.flatMap((r) => r.item_ids))];
  const { data: its } = ids.length ? await sb.from("order_items").select("id, qty, shipped_at, products(code, name, price)").in("id", ids) : { data: [] };
  const byId = Object.fromEntries((its || []).map((i) => [i.id, i]));
  const pending = reqs.filter((r) => r.status === "pending");
  const done = reqs.filter((r) => r.status === "done").sort((a, b) => (b.handled_at || "").localeCompare(a.handled_at || "")).slice(0, 15);
  S.pendingCust = new Set(pending.map((r) => r.customer_id));
  $("shipBadge").hidden = !pending.length; $("shipBadge").textContent = pending.length;
  document.title = (pending.length ? `(${pending.length}) ` : "") + "好事丞雙 喊單後台";

  const card = (r, isDone) => {
    const list = r.item_ids.map((id) => byId[id]).filter(Boolean);
    const sub = list.reduce((s, i) => s + (i.products.price || 0) * i.qty, 0);
    const name = r.customers?.fb_name || "（客人已刪除）";
    const summary = list.map((i) => `${i.products.name} ×${i.qty} $${(i.products.price || 0) * i.qty}`).join("\n") + `\n運費 $${r.shipping_fee}\n合計 $${sub + r.shipping_fee}`;
    return `<div class="req" style="${isDone ? "border-left-color:var(--ready);opacity:.85" : ""}">
      <div class="req-head">
        <span><span class="nm">${esc(name)}</span>${cp(name)}</span>
        <span style="font-size:13px;color:var(--muted)">申請 ${md(r.created_at.slice(0, 10))} ${r.created_at.slice(11, 16)}${isDone ? `・已開單 ${md((r.handled_at || "").slice(0, 10))}` : ""}</span>
      </div>
      ${r.note ? `<div style="font-size:14px;margin-bottom:6px">客人備註：<b>${esc(r.note)}</b>${cp(r.note)}</div>` : ""}
      ${r.customers?.phone ? `<div style="font-size:14px;margin-bottom:6px">手機：${esc(r.customers.phone)}${cp(r.customers.phone)}</div>` : ""}
      <div class="tablewrap"><table>
        <thead><tr><th>商品名稱</th><th style="text-align:right">數量</th><th style="text-align:right">單價</th><th style="text-align:right">金額</th></tr></thead>
        <tbody>${list.map((i) => `<tr>
          <td>${esc(i.products.name)}${cp(i.products.name)}</td>
          <td class="n">${i.qty}${cp(String(i.qty))}</td>
          <td class="n">${i.products.price != null ? "$" + fmt(i.products.price) + cp(String(i.products.price)) : "待定"}</td>
          <td class="n">$${fmt((i.products.price || 0) * i.qty)}${cp(String((i.products.price || 0) * i.qty))}</td></tr>`).join("")}
          <tr><td colspan="3" style="color:var(--muted)">運費（${SHIP_FEE_TXT}）</td><td class="n">$${r.shipping_fee}</td></tr>
          <tr><td colspan="3"><b>合計</b></td><td class="n"><b>$${fmt(sub + r.shipping_fee)}</b>${cp(String(sub + r.shipping_fee))}</td></tr>
        </tbody></table></div>
      <div class="req-foot">
        <button class="btn small" type="button" data-cp="${esc(summary)}">複製整筆明細</button>
        ${isDone ? `<button class="btn small" type="button" data-reopen="${r.id}">改回未處理</button>` : `<button class="btn ship" type="button" data-done="${r.id}">已開單，標記出貨</button>`}
      </div>
    </div>`;
  };
  $("shipList").innerHTML = pending.length ? pending.map((r) => card(r, false)).join("") : `<div class="card"><p class="hint" style="margin:0">目前沒有待處理的出貨申請。</p></div>`;
  $("shipDone").innerHTML = done.length ? done.map((r) => card(r, true)).join("") : `<p class="hint">還沒有處理過的申請。</p>`;
  S.shipReqs = reqs;
  if (S.tab === "cust") renderRows();
}

// ---------- 帳號 ----------
async function loadAccounts() {
  const { data, error } = await sb.from("profiles").select("*").order("created_at", { ascending: false });
  if (error) return toast(errMsg(error));
  $("arows").innerHTML = data.map((p) => `<tr>
    <td>${esc(p.display_name || "（沒有名字）")}${p.id === S.uid ? "（你）" : ""}</td>
    <td>${esc(p.phone || "—")}</td><td>${p.phone ? "手機" : "Facebook"}</td>
    <td>${p.id === S.uid ? "管理者" : `<select id="role-${p.id}" data-role="${p.id}" aria-label="身分">${[["customer", "客人"], ["partner", "夥伴"], ["admin", "管理者"]].map(([k, l]) => `<option value="${k}" ${p.role === k ? "selected" : ""}>${l}</option>`).join("")}</select>`}</td>
    <td>${md(p.created_at.slice(0, 10))}</td></tr>`).join("");
}

// ---------- 事件 ----------
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.cp !== undefined) {
    try { await navigator.clipboard.writeText(b.dataset.cp); toast("已複製"); }
    catch { toast("複製失敗，請手動選取文字"); }
    return;
  }
  if (b.dataset.done) {
    const r = S.shipReqs.find((x) => x.id === +b.dataset.done);
    b.disabled = true;
    const a = await sb.from("order_items").update({ shipped_at: GB.today() }).in("id", r.item_ids).is("shipped_at", null);
    if (a.error) { b.disabled = false; return toast(errMsg(a.error)); }
    const c = await sb.from("ship_requests").update({ status: "done", handled_at: new Date().toISOString() }).eq("id", r.id);
    if (c.error) { b.disabled = false; return toast(errMsg(c.error)); }
    toast(`${r.customers?.fb_name || ""} 已標記出貨`); loadShips(); if (S.rid) loadRound();
    return;
  }
  if (b.dataset.reopen) {
    const r = S.shipReqs.find((x) => x.id === +b.dataset.reopen);
    await sb.from("order_items").update({ shipped_at: null }).in("id", r.item_ids);
    await sb.from("ship_requests").update({ status: "pending", handled_at: null }).eq("id", r.id);
    toast("已改回未處理"); loadShips(); if (S.rid) loadRound();
    return;
  }
  if (b.dataset.f) { S.filter = b.dataset.f; renderStats(); renderRows(); }
  if (b.dataset.who) { S.viewId = +b.dataset.who; renderPreview(); }
  if (b.dataset.ship) {
    const cid = +b.dataset.ship;
    const ids = custItems(cid).filter((i) => !i.shipped_at && prod(i.product_id)?.status === "arrived").map((i) => i.id);
    const { error } = await sb.from("order_items").update({ shipped_at: GB.today() }).in("id", ids);
    if (error) return toast(errMsg(error));
    toast(`已安排出貨 ${ids.length} 項`); loadRound();
  }
  if (b.dataset.undo) {
    const ids = custItems(+b.dataset.undo).filter((i) => i.shipped_at).map((i) => i.id);
    const { error } = await sb.from("order_items").update({ shipped_at: null }).in("id", ids);
    if (error) return toast(errMsg(error));
    toast("已取消出貨標記"); loadRound();
  }
  if (b.dataset.delp) {
    const p = prod(+b.dataset.delp);
    const n = S.items.filter((i) => i.product_id === p.id).length;
    if (!confirm(`確定刪除「${p.name}」？${n ? `\n這個商品有 ${n} 筆喊單，也會一起刪除。` : ""}`)) return;
    const { error } = await sb.from("products").delete().eq("id", p.id);
    if (error) return toast(errMsg(error));
    toast(`已刪除 ${p.name}`); loadRound();
  }
});

document.addEventListener("change", async (e) => {
  const t = e.target, d = t.dataset;
  let res;
  if (d.st) { res = await sb.from("products").update({ status: t.value }).eq("id", +d.st); if (!res.error) toast(`${prod(+d.st).name} 改為「${ST[t.value]}」`); }
  else if (d.pf) {
    const v = d.pf === "price" ? (t.value === "" ? null : +t.value) : t.value.trim();
    res = await sb.from("products").update({ [d.pf]: v }).eq("id", +d.pid); if (!res.error) toast("已儲存");
  }
  else if (d.note) { res = await sb.from("products").update({ note: t.value, note_by: S.myName || (isAdmin() ? "好事丞雙" : "夥伴"), note_at: new Date().toISOString() }).eq("id", +d.note); if (!res.error) toast("備註已儲存"); }
  else if (d.ord) { res = await sb.from("products").update({ ordered_qty: Math.max(0, parseInt(t.value) || 0) }).eq("id", +d.ord); if (!res.error) toast("已訂數量已儲存"); }
  else if (d.ef) { res = await sb.from("customers").update({ extra_fee: parseInt(t.value) || 0 }).eq("id", +d.ef); if (!res.error) toast("其他費用已儲存"); }
  else if (d.ph) { res = await sb.from("customers").update({ phone: GB.normPhone(t.value) || null }).eq("id", +d.ph); if (!res.error) toast("手機已儲存，客人用這支手機登入就會看到喊單"); }
  else if (d.nt) { res = await sb.from("customers").update({ note: t.value.trim() }).eq("id", +d.nt); if (!res.error) toast("備註已儲存"); }
  else if (d.role) { res = await sb.from("profiles").update({ role: t.value }).eq("id", d.role); if (!res.error) toast("身分已更新"); }
  else return;
  if (res.error) { toast(errMsg(res.error)); }
  if (!d.role) loadRound();
});
