// 客人頁：登入、認領喊單、我的喊單、收單中商品 +1
const $ = (id) => document.getElementById(id);
const { esc, fmt, md, toast, errMsg, ST } = GB;
let mode = "login";
let me = null;

// ---------- 登入 ----------
$("fbLogin").onclick = async () => {
  const { error } = await sb.auth.signInWithOAuth({
    provider: "facebook",
    options: { redirectTo: location.origin + location.pathname },
  });
  if (error) toast(errMsg(error));
};

function setMode(m) {
  mode = m;
  $("mLogin").setAttribute("aria-pressed", m === "login");
  $("mSignup").setAttribute("aria-pressed", m === "signup");
  $("nameField").hidden = m !== "signup";
  $("phoneBtn").textContent = m === "login" ? "登入" : "註冊並登入";
  $("pw").autocomplete = m === "login" ? "current-password" : "new-password";
  $("pwHint").textContent = m === "login" ? "忘記密碼請私訊團主幫你重設" : "至少 6 個字，請記下來";
  $("phoneErr").hidden = true;
}
$("mLogin").onclick = () => setMode("login");
$("showAdminFb").onclick = (e) => { e.preventDefault(); $("adminFb").hidden = false; $("adminFb").scrollIntoView({ behavior: "smooth" }); };
$("mSignup").onclick = () => setMode("signup");

$("phoneForm").onsubmit = async (e) => {
  e.preventDefault();
  const phone = GB.normPhone($("ph").value);
  const pw = $("pw").value;
  const showErr = (m) => { $("phoneErr").textContent = m; $("phoneErr").hidden = false; };
  if (!/^09\d{8}$/.test(phone)) return showErr("請輸入 09 開頭的 10 碼手機號碼");
  if (pw.length < 6) return showErr("密碼至少要 6 個字");
  $("phoneBtn").disabled = true;
  try {
    if (mode === "signup") {
      const name = $("nm").value.trim();
      if (!name) { showErr("請填你在社團的 FB 名字"); return; }
      const { error } = await sb.auth.signUp({
        email: GB.phoneEmail(phone), password: pw,
        options: { data: { phone, display_name: name } },
      });
      if (error) throw error;
      // 關閉 Email 驗證時，註冊完就會直接登入；保險起見再登入一次
      const s = await sb.auth.getSession();
      if (!s.data.session) {
        const r = await sb.auth.signInWithPassword({ email: GB.phoneEmail(phone), password: pw });
        if (r.error) throw r.error;
      }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email: GB.phoneEmail(phone), password: pw });
      if (error) throw error;
    }
  } catch (err) {
    showErr(errMsg(err));
  } finally {
    $("phoneBtn").disabled = false;
  }
};

$("logout").onclick = async () => { await sb.auth.signOut(); };

// ---------- 畫面 ----------
async function show(session) {
  if (!session) { $("v-login").hidden = false; $("v-me").hidden = true; return; }
  $("v-login").hidden = true; $("v-me").hidden = false;
  const { data: prof } = await sb.from("profiles").select("display_name, role, phone").eq("id", session.user.id).maybeSingle();
  me = prof || {};
  const meta = session.user.user_metadata || {};
  $("meName").textContent = me.display_name || meta.full_name || meta.display_name || "客人";
  $("adminLink").hidden = !(me.role === "admin" || me.role === "partner");
  await Promise.all([loadClaims(), loadMine(), loadOpen()]);
}

async function loadClaims() {
  const { data, error } = await sb.rpc("preview_claim");
  if (error || !data || !data.length) { $("claimBox").hidden = true; return; }
  $("claimBox").hidden = false;
  $("claimList").innerHTML = data.map((c) => `
    <label class="li" style="cursor:pointer">
      <span style="display:flex;gap:10px;align-items:flex-start">
        <input type="checkbox" checked data-cid="${c.customer_id}" style="margin-top:5px">
        <span><b>${esc(c.fb_name)}</b><br><span style="font-size:13px;color:var(--muted)">${esc(c.items)}</span></span>
      </span>
      <span class="money">$${fmt(c.total)}</span>
    </label>`).join("") +
    `<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
       <button class="btn red" id="claimOk" type="button">是我的，加進我的帳戶</button>
       <button class="btn" id="claimNo" type="button">不是我的</button>
     </div>
     <p class="hint" style="margin:10px 0 0">如果有不是你的單，取消勾選再確認就好。</p>`;
  $("claimOk").onclick = async () => {
    const ids = [...document.querySelectorAll("[data-cid]:checked")].map((x) => +x.dataset.cid);
    if (!ids.length) return toast("請至少勾選一筆");
    const { data: n, error } = await sb.rpc("confirm_claim", { ids });
    if (error) return toast(errMsg(error));
    toast(`已加入 ${n} 筆喊單`);
    await Promise.all([loadClaims(), loadMine()]);
  };
  $("claimNo").onclick = () => { $("claimBox").hidden = true; toast("好的，有問題可以私訊團主"); };
}

const SHIP_FEE = 39;
let pendingIds = new Set();

function itemState(it) {
  const p = it.products;
  if (it.shipped_at) return [`已安排出貨 ${md(it.shipped_at)}`, "var(--ship-ink)"];
  if (pendingIds.has(it.id)) return ["已申請出貨・等待團主開單", "var(--navy)"];
  if (p.status === "arrived") return ["已到貨・可以申請出貨", "var(--ready)"];
  return [ST[p.status], "var(--wait)"];
}
const lineOf = (it) => `<div class="li"><div>${esc(it.products.name)} ×${it.qty}<br><em style="color:${itemState(it)[1]}">${esc(itemState(it)[0])}</em></div>
  <div class="money">${it.products.price != null ? "$" + fmt(it.products.price * it.qty) : "價格待公布"}</div></div>`;
const sumOf = (list) => list.reduce((s, it) => s + (it.products.price || 0) * it.qty, 0);

async function loadMine() {
  const uid = (await sb.auth.getUser()).data.user?.id;
  const { data: cust, error } = await sb.from("customers")
    .select("id, fb_name, extra_fee, note, order_items(id, qty, shipped_at, products(id, code, name, price, status, rounds(title))), ship_requests(id, item_ids, status, note, created_at, shipping_fee)")
    .eq("user_id", uid).maybeSingle();
  if (error) { $("mine").innerHTML = `<p class="err">${esc(errMsg(error))}</p>`; return; }
  const items = cust?.order_items || [];
  if (!items.length) {
    const user = (await sb.auth.getUser()).data.user;
    const isPhone = user?.app_metadata?.provider === "email";
    $("mine").innerHTML = isPhone && !cust
      ? `<div class="card dashed" style="background:var(--mustard-soft)"><b>帳號已建立，等團主確認中</b>
          <p class="hint" style="margin:6px 0 0">團主確認你是社團裡的「${esc(me?.display_name || "")}」之後，你在社團喊的單就會出現在這裡，通常不用等太久。<br>也可以先在下面「正在收單」直接按 +1。</p></div>`
      : `<div class="card"><p class="hint" style="margin:0">目前還沒有你的喊單。<br>在社團喊單後，團主匯入就會出現在這裡；也可以直接在下面「正在收單」按 +1。</p></div>`;
    return;
  }
  const reqs = (cust.ship_requests || []).filter((r) => r.status !== "cancelled");
  const pending = reqs.filter((r) => r.status === "pending");
  pendingIds = new Set(pending.flatMap((r) => r.item_ids));
  const shipFees = reqs.reduce((s, r) => s + (r.shipping_fee || 0), 0);
  const canShip = items.filter((i) => !i.shipped_at && i.products.status === "arrived" && !pendingIds.has(i.id));

  const byRound = {};
  items.forEach((it) => { const r = it.products.rounds?.title || "團購"; (byRound[r] ||= []).push(it); });
  const goods = sumOf(items);
  const unshipped = items.filter((i) => !i.shipped_at);
  const ready = unshipped.filter((i) => i.products.status === "arrived");
  const [cls, label] = !unshipped.length ? ["p-ship", "已安排出貨"]
    : pending.length ? ["p-part", "已申請出貨"]
    : ready.length === unshipped.length ? ["p-ready", "可以出貨"]
    : ready.length ? ["p-part", "部分可出"] : ["p-wait", "等待到貨"];

  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const pendingBox = pending.map((r) => {
    const list = r.item_ids.map((id) => byId[id]).filter(Boolean);
    return `<div class="card" style="margin:12px 0;border-color:var(--navy);background:var(--navy-soft)">
      <b>已申請出貨・${md(GB.tw(r.created_at).slice(0, 10))}</b>
      <p class="hint" style="margin:4px 0 6px">團主開單後就會寄出，運費統一使用全家好賣家 $${r.shipping_fee} 元出貨。</p>
      <div style="font-size:14px">${list.map((i) => `${esc(i.products.name)} ×${i.qty}`).join("、")}</div>
      <div class="money" style="margin-top:4px">商品 $${fmt(sumOf(list))} ＋ 運費 $${r.shipping_fee} ＝ <b>$${fmt(sumOf(list) + r.shipping_fee)}</b></div>
      ${r.note ? `<div style="font-size:13px;color:var(--muted);margin-top:4px">你的備註：${esc(r.note)}</div>` : ""}
      <button class="btn small" type="button" data-cancelreq="${r.id}" style="margin-top:8px">取消申請</button>
    </div>`;
  }).join("");

  const askBox = canShip.length ? `<div class="card dashed" style="margin:12px 0;background:var(--ready-soft)" id="askBox">
      <b>有 ${canShip.length} 項商品已到貨，可以出貨了</b>
      <div id="askForm" hidden style="margin-top:8px">
        ${canShip.map(lineOf).join("")}
        <div class="li"><div>運費<br><em style="color:var(--muted)">統一使用全家好賣家 $${SHIP_FEE} 元出貨</em></div><div class="money">$${SHIP_FEE}</div></div>
        <div class="li total"><div>這次出貨要付</div><div class="money">$${fmt(sumOf(canShip) + SHIP_FEE)}</div></div>
        <div class="field" style="margin-top:8px">
          <label for="shipNote">備註（選填）</label>
          <input class="input" id="shipNote" maxlength="200" placeholder="例如：取貨門市、想等其他商品一起寄">
        </div>
        <button class="btn red big" type="button" id="shipConfirm">確認申請出貨</button>
      </div>
      <button class="btn ship big" type="button" id="shipAsk" style="margin-top:8px">我想要出貨</button>
    </div>` : "";

  $("mine").innerHTML = `<div class="envelope">
    <div style="font-size:12px;color:var(--muted)">好事丞雙 團購查詢</div>
    <h3>${esc(cust.fb_name)}</h3>
    <span class="pill ${cls}" style="margin:4px 0 8px">${label}</span>
    ${askBox}${pendingBox}
    ${Object.entries(byRound).map(([r, list]) => `
      <div style="margin-top:10px;font-family:var(--f-latin);letter-spacing:.14em;font-size:12px;color:var(--red)">${esc(r)}</div>
      ${list.sort((a, b) => a.products.code.localeCompare(b.products.code, "zh-Hant", { numeric: true })).map(lineOf).join("")}`).join("")}
    ${shipFees ? `<div class="li"><div>全家好賣家運費<br><em style="color:var(--muted)">$${SHIP_FEE} × ${reqs.length} 次出貨</em></div><div class="money">$${fmt(shipFees)}</div></div>` : ""}
    ${cust.extra_fee ? `<div class="li"><div>其他費用</div><div class="money">$${fmt(cust.extra_fee)}</div></div>` : ""}
    <div class="li total"><div>應付金額</div><div class="money">$${fmt(goods + shipFees + (cust.extra_fee || 0))}</div></div>
    ${!shipFees ? `<p class="hint" style="margin:6px 0 0">運費：統一使用全家好賣家 $${SHIP_FEE} 元出貨，申請出貨時才會加上。</p>` : ""}
    ${cust.note ? `<p class="hint" style="margin:8px 0 0">團主備註：${esc(cust.note)}</p>` : ""}
  </div>`;

  if (canShip.length) {
    $("shipAsk").onclick = () => { $("askForm").hidden = false; $("shipAsk").hidden = true; $("shipNote").focus(); };
    $("shipConfirm").onclick = async () => {
      $("shipConfirm").disabled = true;
      const { error } = await sb.rpc("request_shipping", { p_note: $("shipNote").value });
      $("shipConfirm").disabled = false;
      if (error) return toast(errMsg(error));
      toast("已送出出貨申請，團主開單後就會寄出");
      loadMine();
    };
  }
}

async function loadOpen() {
  const { data, error } = await sb.from("products")
    .select("id, round_id, code, name, price, note, rounds(title, close_date)")
    .eq("status", "open").order("round_id").order("code");
  if (error) { $("openProds").innerHTML = `<p class="err">${esc(errMsg(error))}</p>`; return; }
  if (!data.length) { $("openProds").innerHTML = `<p class="hint">目前沒有正在收單的商品，開團時會出現在這裡。</p>`; return; }
  // 依喊單代碼「自然順序」排：0、1、2…9、10、11（不是 0、1、10、11、2）
  data.sort((a, b) => (a.round_id - b.round_id) || String(a.code).localeCompare(String(b.code), "zh-Hant", { numeric: true }));
  $("openProds").innerHTML = data.map((p) => `
    <div class="prod">
      <div><span class="code">${esc(p.code)}</span> <span class="nm">${esc(p.name)}</span></div>
      <div style="font-size:13px;color:var(--muted)">${esc(p.rounds?.title || "")}${p.rounds?.close_date ? `・${md(p.rounds.close_date)} 收單` : ""}</div>
      <div class="money" style="font-size:18px">${p.price != null ? "$" + fmt(p.price) : "價格待公布"}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div class="stepper"><button type="button" data-dec="${p.id}" aria-label="減少">−</button><span id="q-${p.id}">1</span><button type="button" data-inc="${p.id}" aria-label="增加">+</button></div>
        <button class="btn red" type="button" data-plus="${p.id}">+1 喊單</button>
      </div>
    </div>`).join("");
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  const q = (id) => $("q-" + id);
  if (b.dataset.inc) q(b.dataset.inc).textContent = Math.min(99, +q(b.dataset.inc).textContent + 1);
  if (b.dataset.dec) q(b.dataset.dec).textContent = Math.max(1, +q(b.dataset.dec).textContent - 1);
  if (b.dataset.cancelreq) {
    if (!confirm("確定取消這次的出貨申請？")) return;
    const { error } = await sb.rpc("cancel_ship_request", { p_id: +b.dataset.cancelreq });
    if (error) return toast(errMsg(error));
    toast("已取消出貨申請"); loadMine();
  }
  if (b.dataset.plus) {
    const id = +b.dataset.plus, qty = +q(id).textContent;
    b.disabled = true;
    const { error } = await sb.rpc("plus_one", { p_product: id, p_qty: qty });
    b.disabled = false;
    if (error) return toast(errMsg(error));
    toast(`已喊單 ×${qty}`);
    q(id).textContent = 1;
    loadMine();
  }
});

// FB 登入失敗時，網址會帶回錯誤原因：顯示出來並清掉網址
(() => {
  const qs = new URLSearchParams(location.search + "&" + location.hash.slice(1));
  const err = qs.get("error_description");
  if (!err) return;
  const msg = /exchange external code/i.test(err) ? "Facebook 登入沒有成功（系統設定問題），請稍後再試或私訊團主"
    : /email/i.test(err) ? "Facebook 沒有提供 Email，請改用手機號碼登入，或私訊團主"
    : "登入沒有成功：" + err;
  $("phoneErr").textContent = msg; $("phoneErr").hidden = false;
  history.replaceState(null, "", location.pathname);
})();

let shownFor;
sb.auth.onAuthStateChange((_ev, session) => {
  const key = session?.user?.id || "none";
  if (key === shownFor) return;
  shownFor = key;
  setTimeout(() => show(session), 0);
});
