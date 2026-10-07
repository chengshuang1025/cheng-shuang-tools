// meta-webhook：接收 IG／FB 粉絲頁的留言、限動回覆、私訊，自動回覆
// 規則分三種來源：貼文留言（comment）／限動回覆（story，只有 IG）／私訊（dm）
//   可以鎖定某一篇貼文或某一則限動；關鍵字可設「同音錯字也算」或「不用關鍵字，有留言就回」
// 回覆方式：
//   貼文留言 → 先在留言底下公開回一句（從勾選的句子隨機挑）→ 再私訊
//   私訊「第一則就給連結」：直接送內容＋連結按鈕＋邀請追蹤的一句
//   私訊「先按按鈕再給」：先送招呼語＋按鈕（例如『我想更了解這產品！』『我想索取連結』），
//     客人按了才送內容＋連結按鈕＋邀請追蹤的一句
//   ※ Meta 還沒核准私訊權限前，一般人按按鈕、回限動、傳私訊都不會送到這裡，
//      所以後台「Meta 私訊權限已核准」沒打開時，「先按按鈕再給」會自動改成第一則就給
//   沒有符合的規則、但像在發問的留言 → 交給 Gemini 回答團購問題，答不出來留給團主
//   客人在自動回覆後 30 分鐘內說謝謝 → 隨機回一句（同一個人一天一次）
// 後台挑貼文用：GET ?hub.mode=media&hub.verify_token=… 回傳最近的 IG 貼文、限動、FB 貼文
// 需要的 Secrets：META_APP_SECRET、GEMINI_API_KEY（GEMINI_MODEL、GRAPH_VERSION 可不設）
import { createClient } from "npm:@supabase/supabase-js@2";
import { pinyin } from "npm:pinyin-pro@3";

const GV = Deno.env.get("GRAPH_VERSION") ?? "v23.0";
const G = `https://graph.facebook.com/${GV}`;
const APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.8-flash";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

type Ctx = { settings: any; conn: any; rules: any[] };
type Platform = "ig" | "fb";
type Source = "comment" | "story" | "dm";

// ---------- 小工具 ----------
const norm = (s: string) => String(s || "").toLowerCase().replace(/\s+/g, "");
const todayTW = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const py = (s: string) => " " + pinyin(String(s || ""), { toneType: "none", type: "array", nonZh: "consecutive" }).join(" ").toLowerCase().replace(/\s+/g, " ").trim() + " ";

async function verifySignature(raw: string, header: string | null) {
  if (!APP_SECRET) return true; // 還沒設定密鑰時先不檢查（測試用）
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const hex = [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === header.slice(7);
}

async function graphPost(path: string, body: Record<string, unknown>, token: string) {
  const r = await fetch(`${G}/${path}?access_token=${encodeURIComponent(token)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error?.message || `Graph API ${r.status}`);
  return j;
}
async function graphGet(path: string, params: Record<string, string>, token: string) {
  const qs = new URLSearchParams({ ...params, access_token: token }).toString();
  const r = await fetch(`${G}/${path}?${qs}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error?.message || `Graph API ${r.status}`);
  return j;
}

// ---------- 送出 ----------
// 公開回覆在留言底下
async function publicReply(p: Platform, commentId: string, text: string, ctx: Ctx) {
  if (!text) return;
  if (p === "ig") await graphPost(`${commentId}/replies`, { message: text }, ctx.conn.page_token);
  else await graphPost(`${commentId}/comments`, { message: text }, ctx.conn.page_token);
}
type Btn = { type: "url"; title: string; url: string } | { type: "postback"; title: string; payload: string };
// recipient：{comment_id}（從留言私訊，只能送一則）或 {id}（對方傳過訊息、按過按鈕）
async function send(recipient: Record<string, string>, text: string, ctx: Ctx, buttons: Btn[] = []) {
  const page = ctx.conn.page_id, token = ctx.conn.page_token;
  const extra = recipient.id ? { messaging_type: "RESPONSE" } : {};
  if (recipient.id && ctx.settings.typing) {
    // 先顯示「輸入中…」，停一下再送，比較像真人
    try { await graphPost(`${page}/messages`, { recipient, sender_action: "typing_on" }, token); } catch (_) { /* 有些情況不支援，略過 */ }
    await sleep(Math.min(5, Math.max(0, Number(ctx.settings.delay_sec) || 0)) * 1000);
  }
  const body = String(text || "").trim() || "👇";
  const btns = buttons.slice(0, 3);
  if (btns.length && body.length <= 640) {
    try {
      await graphPost(`${page}/messages`, {
        recipient, ...extra,
        message: { attachment: { type: "template", payload: { template_type: "button", text: body,
          buttons: btns.map((b) => b.type === "url" ? { type: "web_url", url: b.url, title: b.title.slice(0, 20) } : { type: "postback", title: b.title.slice(0, 20), payload: b.payload }) } } },
      }, token);
      return;
    } catch (_) { /* 卡片送不出去：改成純文字（按鈕改用快速回覆、連結直接寫在文字裡）*/ }
  }
  const urls = btns.filter((b) => b.type === "url") as { title: string; url: string }[];
  const posts = btns.filter((b) => b.type === "postback") as { title: string; payload: string }[];
  const plain = [body, ...urls.map((b) => `${b.title}：${b.url}`)].join("\n\n").slice(0, 1000);
  const message: Record<string, unknown> = { text: posts.length ? `${plain}\n\n（按鈕不見的話，直接回覆「${posts[0].title}」也可以 😊）`.slice(0, 1000) : plain };
  if (posts.length) message.quick_replies = posts.map((b) => ({ content_type: "text", title: b.title.slice(0, 20), payload: b.payload }));
  try {
    await graphPost(`${page}/messages`, { recipient, ...extra, message }, token);
  } catch (e) {
    if (!posts.length) throw e;
    await graphPost(`${page}/messages`, { recipient, ...extra, message: { text: message.text } }, token);
  }
}

// 規則的內容：文字＋邀請追蹤的一句＋連結按鈕
const linkButtons = (rule: any): Btn[] =>
  (Array.isArray(rule.link_buttons) ? rule.link_buttons : []).filter((b: any) => b?.url).slice(0, 3)
    .map((b: any) => ({ type: "url", title: b.title || "🔗 點我打開", url: b.url }));
const contentText = (rule: any, p: Platform, ctx: Ctx) =>
  [rule.message, rule.link, rule.follow_invite ? (p === "ig" ? ctx.settings.invite_ig : ctx.settings.invite_fb) : ""].filter(Boolean).join("\n\n");
const useButton = (rule: any, ctx: Ctx) => rule.mode === "button" && !!ctx.settings.dm_ready;
const greetText = (rule: any, ctx: Ctx) => rule.greeting || ctx.settings.default_greeting || "嗨嗨～謝謝妳 🥰 按下面的按鈕，我馬上傳給妳 👇";
const clickButton = (rule: any): Btn => ({ type: "postback", title: rule.button_label || "我想更了解這產品！", payload: `CLICK:${rule.id}` });

// 觸發後的私訊：先按按鈕再給 → 招呼語＋按鈕；第一則就給 → 內容＋連結按鈕
async function deliver(recipient: Record<string, string>, rule: any, p: Platform, ctx: Ctx) {
  if (useButton(rule, ctx)) {
    const t = greetText(rule, ctx);
    await send(recipient, t, ctx, [clickButton(rule)]);
    return { action: "greet", reply: `${t}\n［按鈕］${rule.button_label}` };
  }
  const t = contentText(rule, p, ctx);
  await send(recipient, t, ctx, linkButtons(rule));
  return { action: "sent", reply: t };
}

// ---------- 紀錄 ----------
// 先寫一筆紀錄佔位，重複的通知就不會回兩次
async function claim(row: Record<string, unknown>) {
  const { data, error } = await db.from("reply_log").insert({ ...row, status: "skipped" }).select("id").single();
  if (error) return null; // event_id 重複
  return data.id as number;
}
const finish = (id: number, patch: Record<string, unknown>) => db.from("reply_log").update(patch).eq("id", id);
// 同一個人在這條規則已經收過了嗎？（測試用的規則可以重複）
async function alreadyGot(rule: any, userId: string) {
  if (rule.allow_repeat || !userId) return false;
  const { data } = await db.from("reply_log").select("id").eq("rule_id", rule.id).eq("user_id", userId)
    .in("action", ["greet", "sent"]).eq("status", "done").limit(1);
  return !!data?.length;
}

// ---------- 找規則 ----------
function keywordHit(rule: any, text: string) {
  if (rule.any_text) return true;
  const kws: string[] = (rule.keywords || []).filter(Boolean);
  if (!kws.length) return false;
  const t = norm(text);
  if (kws.some((k) => t.includes(norm(k)))) return true;
  if (!rule.fuzzy) return false;
  const tp = py(text);
  return kws.some((k) => { const kp = py(k); return kp.trim().length >= 2 && tp.includes(kp); });
}
function inTime(rule: any) {
  const now = Date.now();
  if (rule.starts_at && Date.parse(rule.starts_at) > now) return false;
  if (rule.ends_at && Date.parse(rule.ends_at) < now) return false;
  return true;
}
// 鎖定某一篇的規則優先；有關鍵字的優先於「有留言就回」
function findRule(src: Source, p: Platform, text: string, postId: string | undefined, ctx: Ctx, oldPost = false) {
  const ok = ctx.rules.filter((r) =>
    r.active && !r.archived && (r.source || "comment") === src && (r.platforms || []).includes(p) && inTime(r) &&
    (r.post_id ? r.post_id === postId : (!oldPost || r.all_posts)) && keywordHit(r, text));
  const score = (r: any) => (r.post_id ? 2 : 0) + (r.any_text ? 0 : 1);
  return ok.sort((a, b) => score(b) - score(a))[0];
}

// 這則留言所在的貼文，是不是在「開始自動回覆」之前發的？舊貼文交給 FB／IG 內建的自動回覆
async function isOldPost(p: Platform, postId: string | undefined, ctx: Ctx) {
  const since = ctx.settings.active_since ? Date.parse(ctx.settings.active_since) : 0;
  if (!since || !postId) return false;
  const { data: hit } = await db.from("post_times").select("created_at").eq("post_id", postId).maybeSingle();
  let created = hit?.created_at ? Date.parse(hit.created_at) : NaN;
  if (!hit) {
    try {
      const j = await graphGet(postId, { fields: p === "ig" ? "timestamp" : "created_time" }, ctx.conn.page_token);
      const iso = p === "ig" ? j.timestamp : j.created_time;
      created = iso ? Date.parse(iso) : NaN;
      await db.from("post_times").upsert({ post_id: postId, created_at: isNaN(created) ? null : new Date(created).toISOString() });
    } catch (_) { return false; }
  }
  return !isNaN(created) && created < since;
}
// 看起來像在問問題（問號、疑問詞、或提到團購相關字）
const looksLikeQuestion = (t: string) =>
  /[?？]|嗎|呢|什麼|甚麼|何時|幾號|幾點|多少|怎麼|如何|哪裡|哪邊|可以.{0,6}(買|訂|寄|用)|連結|開團|收團|價格|價錢|運費|免運|出貨|團購|還有|截止/.test(String(t || ""));
const looksLikeThanks = (t: string) => /謝謝|感謝|謝啦|謝囉|3q|thx|thank|🙏/i.test(String(t || ""));

// ---------- Gemini：判斷團購問題並回答 ----------
async function askGemini(text: string, ctx: Ctx) {
  if (!GEMINI_KEY) return null;
  const t = todayTW();
  const { data: camps } = await db.from("campaigns").select("title,descr,points,url,start_date,end_date,faq");
  const info = (camps || [])
    .filter((c: any) => !c.end_date || c.end_date >= t || (Date.parse(t) - Date.parse(c.end_date)) / 864e5 <= 7)
    .map((c: any) => {
      const st = c.start_date && c.start_date > t ? "即將開團" : c.end_date && c.end_date < t ? "已結束" : "開團中";
      return `■ ${c.title}（${st}；開團 ${c.start_date || "已開賣"}，收團 ${c.end_date || "長期"}）\n介紹：${c.descr}\n賣點：${(c.points || []).join("；")}\n連結：${c.url || "（連結還沒公布）"}\n補充：${c.faq || "無"}`;
    }).join("\n\n");
  const prompt = `你是 IG/FB 創作者「好事丞雙」的留言小幫手。今天是 ${t}（台灣時間）。
下面是目前的團購資料，只能根據這些資料回答，資料沒寫的（例如價格、運費沒寫）絕對不可以自己猜。

${info || "（目前沒有團購資料）"}

粉絲留言：「${text}」

請判斷並只輸出 JSON：
{"intent":"groupbuy"|"question"|"chat","can_answer":true|false,"answer":"..."}
- intent：groupbuy＝在問團購（開團時間、連結、怎麼買、商品內容…）；question＝其他需要回答的問題；chat＝稱讚、心得、打招呼、表情符號等不需要回答的留言
- can_answer：intent 是 groupbuy 而且上面資料足以完整回答時才是 true
- answer：can_answer 為 true 時，寫要私訊給對方的回答（3～5 句，附上相關團購連結；如果還沒開團，告訴對方開團日期）。語氣要求：${ctx.settings.ai_style}`;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.3 } }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Gemini：" + (j.error?.message || r.status));
  const out = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") || "{}";
  return JSON.parse(out) as { intent: string; can_answer: boolean; answer: string };
}

// ---------- 貼文留言 ----------
async function onComment(p: Platform, c: { id: string; userId: string; userName: string; text: string; postId?: string }, ctx: Ctx) {
  if (!c.text) return;
  const logId = await claim({ platform: p, kind: "comment", event_id: `${p}:c:${c.id}`, post_id: c.postId, user_id: c.userId, user_name: c.userName, text: c.text });
  if (!logId) return;
  try {
    const oldPost = await isOldPost(p, c.postId, ctx);
    const rule = findRule("comment", p, c.text, c.postId, ctx, oldPost);
    if (rule) {
      if (await alreadyGot(rule, c.userId)) { await finish(logId, { rule_id: rule.id, action: "skip", status: "skipped", error: "這個人已經收過這條規則的私訊" }); return; }
      const pub = (rule.public_replies || []).filter(Boolean);
      if (pub.length) await publicReply(p, c.id, pick(pub), ctx);
      const r = await deliver({ comment_id: c.id }, rule, p, ctx);
      await finish(logId, { rule_id: rule.id, ...r, status: "done" });
      return;
    }
    if (oldPost) { await finish(logId, { action: "skip", status: "skipped", error: "舊貼文，交給 FB／IG 內建的自動回覆" }); return; }
    if (!ctx.settings.ai_enabled) return;
    // 只有「看起來在發問」的留言才問 AI（免費額度一天只有少量次數）
    if (!looksLikeQuestion(c.text)) { await finish(logId, { action: "skip", status: "skipped" }); return; }
    let ai;
    try { ai = await askGemini(c.text, ctx); }
    catch (e) { await finish(logId, { action: "ai", status: "needs_human", error: "AI 暫時無法回答（" + String((e as Error).message).slice(0, 80) + "），請團主回覆" }); return; }
    if (!ai) return;
    if (ai.intent === "groupbuy" && ai.can_answer && ai.answer) {
      const pool = (ctx.settings.public_pool || []).filter(Boolean);
      await publicReply(p, c.id, pool.length ? pick(pool) : ctx.settings.public_reply, ctx);
      await send({ comment_id: c.id }, ai.answer, ctx);
      await finish(logId, { action: "ai", reply: ai.answer, status: "done" });
    } else if (ai.intent === "groupbuy" || ai.intent === "question") {
      await finish(logId, { action: "ai", status: "needs_human", error: "資料裡沒有答案，請團主回覆" });
    } else {
      await finish(logId, { action: "skip", status: "skipped" });
    }
  } catch (e) {
    await finish(logId, { status: "error", error: (e as Error).message });
  }
}

// ---------- 私訊（按按鈕、回限動、傳私訊、說謝謝）----------
async function onMessage(p: Platform, m: any, ctx: Ctx) {
  const sender = m.sender?.id;
  if (!sender || m.message?.is_echo || sender === ctx.conn.page_id || sender === ctx.conn.ig_user_id) return;
  if (m.read || m.delivery || m.reaction) return;
  const payload: string = m.postback?.payload || m.message?.quick_reply?.payload || "";
  const text: string = m.message?.text || m.postback?.title || "";
  const eventId = `${p}:m:${m.message?.mid || m.postback?.mid || crypto.randomUUID()}`;
  const storyId: string | undefined = m.message?.reply_to?.story?.id;
  const me = { id: sender };

  // 1. 按了『我想更了解這產品！』之類的按鈕（或按鈕不見、直接打按鈕上的字）
  let ruleId = payload.startsWith("CLICK:") ? +payload.slice(6) : 0;
  if (!ruleId && !payload && text && !storyId) {
    const { data } = await db.from("reply_log").select("rule_id").eq("platform", p).eq("user_id", sender).eq("action", "greet")
      .not("rule_id", "is", null).gte("created_at", new Date(Date.now() - 7 * 864e5).toISOString()).order("created_at", { ascending: false }).limit(1);
    const r = data?.[0] && ctx.rules.find((x) => x.id === data[0].rule_id);
    const t = norm(text), lab = norm(r?.button_label || "");
    if (r && t.length >= 2 && !looksLikeThanks(text) && (lab.includes(t) || t.includes(lab) || /了解|瞭解|索取|連結|想要|\+1/.test(text))) ruleId = r.id;
  }
  if (ruleId) {
    const rule = ctx.rules.find((r) => r.id === ruleId);
    if (!rule) return;
    const logId = await claim({ platform: p, kind: "message", event_id: eventId, user_id: sender, text, rule_id: rule.id });
    if (!logId) return;
    try {
      const t = contentText(rule, p, ctx);
      await send(me, t, ctx, linkButtons(rule));
      await finish(logId, { action: "click", reply: t, status: "done" });
    } catch (e) { await finish(logId, { action: "click", status: "error", error: (e as Error).message }); }
    return;
  }

  // 2. 限動回覆／私訊關鍵字
  const src: Source = storyId ? "story" : "dm";
  const rule = text || storyId ? findRule(src, p, text, storyId, ctx) : null;
  if (rule) {
    const logId = await claim({ platform: p, kind: src === "story" ? "story" : "message", event_id: eventId, post_id: storyId || null, user_id: sender, text, rule_id: rule.id });
    if (!logId) return;
    try {
      if (await alreadyGot(rule, sender)) { await finish(logId, { action: "skip", status: "skipped", error: "這個人已經收過這條規則的私訊" }); return; }
      const r = await deliver(me, rule, p, ctx);
      await finish(logId, { ...r, status: "done" });
    } catch (e) { await finish(logId, { status: "error", error: (e as Error).message }); }
    return;
  }

  // 3. 自動回覆後 30 分鐘內說謝謝 → 回一句（同一個人一天一次）
  if (ctx.settings.thanks_enabled && looksLikeThanks(text) && (ctx.settings.thanks_replies || []).length) {
    const [{ data: recent }, { data: thanked }] = await Promise.all([
      db.from("reply_log").select("id").eq("platform", p).eq("user_id", sender).in("action", ["greet", "sent", "click"]).eq("status", "done")
        .gte("created_at", new Date(Date.now() - 30 * 60e3).toISOString()).limit(1),
      db.from("reply_log").select("id").eq("platform", p).eq("user_id", sender).eq("action", "thanks")
        .gte("created_at", new Date(Date.now() - 24 * 3600e3).toISOString()).limit(1),
    ]);
    if (recent?.length && !thanked?.length) {
      const logId = await claim({ platform: p, kind: "message", event_id: eventId, user_id: sender, text });
      if (!logId) return;
      try {
        const t = pick((ctx.settings.thanks_replies as string[]).filter(Boolean));
        await send(me, t, ctx);
        await finish(logId, { action: "thanks", reply: t, status: "done" });
      } catch (e) { await finish(logId, { action: "thanks", status: "error", error: (e as Error).message }); }
    }
  }
  // 其他私訊交給團主自己看
}

// ---------- 分派 ----------
async function handle(body: any) {
  const [{ data: settings }, { data: conn }, { data: rules }] = await Promise.all([
    db.from("reply_settings").select("*").eq("id", 1).single(),
    db.from("meta_connection").select("*").eq("id", 1).maybeSingle(),
    db.from("reply_rules").select("*"),
  ]);
  // 偶爾清掉 90 天前的回覆紀錄（隱私權政策承諾最多保存 90 天）
  if (Math.random() < 0.05) await db.from("reply_log").delete().lt("created_at", new Date(Date.now() - 90 * 864e5).toISOString());
  if (!settings?.enabled || !conn?.page_token) return;
  const ctx: Ctx = { settings, conn, rules: rules || [] };
  const p: Platform | null = body.object === "instagram" ? "ig" : body.object === "page" ? "fb" : null;
  if (!p || (p === "ig" && !settings.ig_enabled) || (p === "fb" && !settings.fb_enabled)) return;

  // 除錯用：只記事件種類，不記內容（到 Supabase → meta-webhook → Logs 看）
  try {
    console.log("evt", body.object, JSON.stringify((body.entry || []).map((e: any) => ({
      changes: (e.changes || []).map((c: any) => c.field),
      messaging: (e.messaging || []).map((m: any) => Object.keys(m).concat(Object.keys(m.message || {}).map((k) => "message." + k))),
    }))));
  } catch (_) { /* 忽略 */ }

  for (const entry of body.entry || []) {
    for (const ch of entry.changes || []) {
      const v = ch.value || {};
      // 有些帳號的 IG 私訊會用 changes 格式送來
      if ((ch.field === "messages" || ch.field === "messaging_postbacks") && v.sender) {
        await onMessage(p, v, ctx);
        continue;
      }
      if (p === "ig" && ch.field === "comments") {
        if (!v.from?.id || v.from.id === conn.ig_user_id || v.from.id === entry.id) continue; // 自己的回覆不處理
        await onComment("ig", { id: v.id, userId: v.from.id, userName: v.from.username, text: v.text, postId: v.media?.id }, ctx);
      }
      if (p === "fb" && ch.field === "feed" && v.item === "comment" && v.verb === "add") {
        if (!v.from?.id || v.from.id === conn.page_id) continue;
        await onComment("fb", { id: v.comment_id, userId: v.from.id, userName: v.from.name, text: v.message, postId: v.post_id }, ctx);
      }
    }
    for (const m of entry.messaging || []) await onMessage(p, m, ctx);
  }
}

// ---------- 後台挑貼文：最近的 IG 貼文、限動、FB 貼文 ----------
async function listMedia() {
  const { data: conn } = await db.from("meta_connection").select("*").eq("id", 1).maybeSingle();
  if (!conn?.page_token) return { error: "還沒連接粉絲頁" };
  const tok = conn.page_token;
  const out: Record<string, unknown> = { ig: [], stories: [], fb: [] };
  const jobs: Promise<void>[] = [];
  if (conn.ig_user_id) {
    jobs.push(graphGet(`${conn.ig_user_id}/media`, { fields: "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp", limit: "36" }, tok)
      .then((j) => { out.ig = (j.data || []).map((x: any) => ({ id: x.id, caption: x.caption || "", thumb: x.thumbnail_url || x.media_url || "", link: x.permalink, time: x.timestamp })); })
      .catch((e) => { out.ig_error = e.message; }));
    jobs.push(graphGet(`${conn.ig_user_id}/stories`, { fields: "id,media_type,media_url,thumbnail_url,permalink,timestamp" }, tok)
      .then((j) => { out.stories = (j.data || []).map((x: any) => ({ id: x.id, caption: "", thumb: x.thumbnail_url || x.media_url || "", link: x.permalink, time: x.timestamp })); })
      .catch((e) => { out.stories_error = e.message; }));
  }
  jobs.push(graphGet(`${conn.page_id}/posts`, { fields: "id,message,full_picture,permalink_url,created_time", limit: "24" }, tok)
    .then((j) => { out.fb = (j.data || []).map((x: any) => ({ id: x.id, caption: x.message || "", thumb: x.full_picture || "", link: x.permalink_url, time: x.created_time })); })
    .catch((e) => { out.fb_error = e.message; }));
  await Promise.all(jobs);
  return out;
}

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type" };
const json = (o: unknown) => new Response(JSON.stringify(o, null, 2), { headers: { "Content-Type": "application/json", ...CORS } });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const { data } = await db.from("reply_settings").select("verify_token").eq("id", 1).single();
    const okToken = !!data?.verify_token && url.searchParams.get("hub.verify_token") === data.verify_token;
    // Meta 設定 webhook 時的驗證
    if (mode === "subscribe" && okToken) return new Response(url.searchParams.get("hub.challenge") || "", { status: 200 });
    // 後台挑貼文
    if (mode === "media" && okToken) return json(await listMedia());
    // 檢查連線狀態（只回報訂閱與權限，不含權杖），要帶驗證權杖才能看
    if (mode === "check" && okToken) {
      const { data: conn } = await db.from("meta_connection").select("*").eq("id", 1).maybeSingle();
      const out: Record<string, unknown> = { page: conn?.page_name, ig: conn?.ig_username };
      try {
        const appToken = `${Deno.env.get("META_APP_ID") ?? "1392117529656742"}|${APP_SECRET}`;
        out.subscribed_apps = (await graphGet(`${conn.page_id}/subscribed_apps`, {}, conn.page_token)).data;
        const dbg = await graphGet("debug_token", { input_token: conn.page_token }, appToken);
        out.token = { type: dbg.data?.type, valid: dbg.data?.is_valid, expires: dbg.data?.expires_at, scopes: dbg.data?.scopes };
      } catch (e) { out.error = (e as Error).message; }
      return json(out);
    }
    return new Response("forbidden", { status: 403, headers: CORS });
  }
  if (req.method !== "POST") return new Response("ok");
  const raw = await req.text();
  if (!(await verifySignature(raw, req.headers.get("x-hub-signature-256")))) return new Response("bad signature", { status: 401 });
  let body: any;
  try { body = JSON.parse(raw); } catch { return new Response("ok"); }
  // 先回 200 給 Meta，回覆在背景處理
  // @ts-ignore EdgeRuntime 由 Supabase 提供
  EdgeRuntime.waitUntil(handle(body).catch((e) => console.error("handle", e)));
  return new Response("EVENT_RECEIVED");
});
