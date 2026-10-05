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
  $("phoneBtn").textContent = m === "login" ? "登入" : "建立帳號";
  $("pw").autocomplete = m === "login" ? "current-password" : "new-password";
  $("pwHint").textContent = m === "login" ? "忘記密碼請私訊團主幫你重設" : "至少 6 個字，請記下來";
  $("phoneErr").hidden = true;
}
$("mLogin").onclick = () => setMode("login");
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

function itemState(it) {
  const p = it.products;
  if (it.shipped_at) return [`已安排出貨 ${md(it.shipped_at)}`, "var(--ship-ink)"];
  if (p.status === "arrived") return ["已到貨・等待出貨", "var(--ready)"];
  return [ST[p.status], "var(--wait)"];
}

async function loadMine() {
  const uid = (await sb.auth.getUser()).data.user?.id;
  const { data: cust, error } = await sb.from("customers")
    .select("id, fb_name, extra_fee, note, order_items(id, qty, shipped_at, products(id, code, name, price, status, rounds(title)))")
    .eq("user_id", uid).maybeSingle();
  if (error) { $("mine").innerHTML = `<p class="err">${esc(errMsg(error))}</p>`; return; }
  const items = cust?.order_items || [];
  if (!items.length) {
    $("mine").innerHTML = `<div class="card"><p class="hint" style="margin:0">目前還沒有你的喊單。<br>在社團喊單後，團主匯入就會出現在這裡；也可以直接在下面「正在收單」按 +1。</p></div>`;
    return;
  }
  const byRound = {};
  items.forEach((it) => { const r = it.products.rounds?.title || "團購"; (byRound[r] ||= []).push(it); });
  const goods = items.reduce((s, it) => s + (it.products.price || 0) * it.qty, 0);
  const unshipped = items.filter((i) => !i.shipped_at);
  const ready = unshipped.filter((i) => i.products.status === "arrived");
  const [cls, label] = !unshipped.length ? ["p-ship", "已安排出貨"]
    : ready.length === unshipped.length ? ["p-ready", "可出貨"]
    : ready.length ? ["p-part", "部分可出"] : ["p-wait", "等待到貨"];
  $("mine").innerHTML = `<div class="envelope">
    <div style="font-size:12px;color:var(--muted)">好事丞雙 團購查詢</div>
    <h3>${esc(cust.fb_name)}</h3>
    <span class="pill ${cls}" style="margin:4px 0 8px">${label}</span>
    ${Object.entries(byRound).map(([r, list]) => `
      <div style="margin-top:10px;font-family:var(--f-latin);letter-spacing:.14em;font-size:12px;color:var(--red)">${esc(r)}</div>
      ${list.sort((a, b) => a.products.code.localeCompare(b.products.code, "zh-Hant", { numeric: true })).map((it) => {
        const [t, c] = itemState(it);
        return `<div class="li"><div>${esc(it.products.name)} ×${it.qty}<br><em style="color:${c}">${esc(t)}</em></div>
          <div class="money">${it.products.price != null ? "$" + fmt(it.products.price * it.qty) : "價格待公布"}</div></div>`;
      }).join("")}`).join("")}
    ${cust.extra_fee ? `<div class="li"><div>運費／其他費用</div><div class="money">$${fmt(cust.extra_fee)}</div></div>` : ""}
    <div class="li total"><div>應付金額</div><div class="money">$${fmt(goods + (cust.extra_fee || 0))}</div></div>
    ${cust.note ? `<p class="hint" style="margin:8px 0 0">團主備註：${esc(cust.note)}</p>` : ""}
  </div>`;
}

async function loadOpen() {
  const { data, error } = await sb.from("products")
    .select("id, code, name, price, note, rounds(title, close_date)")
    .eq("status", "open").order("round_id").order("code");
  if (error) { $("openProds").innerHTML = `<p class="err">${esc(errMsg(error))}</p>`; return; }
  if (!data.length) { $("openProds").innerHTML = `<p class="hint">目前沒有正在收單的商品，開團時會出現在這裡。</p>`; return; }
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

let shownFor;
sb.auth.onAuthStateChange((_ev, session) => {
  const key = session?.user?.id || "none";
  if (key === shownFor) return;
  shownFor = key;
  setTimeout(() => show(session), 0);
});
