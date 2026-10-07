// meta-webhook：接收 IG／FB 粉絲頁的留言與私訊通知，自動回覆
// 流程：
//   留言含關鍵字 → 公開回一句「已私訊妳囉」→ 私訊對方
//     要先追蹤：私訊附「我追蹤好了，領取」按鈕 → 對方按下後，IG 查是否真的有追蹤，有才送連結；FB 無法查，按了就送
//     不用追蹤：私訊直接送連結
//   沒有關鍵字 → 交給 Gemini 判斷是不是團購問題，資料裡有答案就私訊回答，沒有就留給團主處理
// 需要的 Secrets：META_APP_SECRET、GEMINI_API_KEY（GEMINI_MODEL、GRAPH_VERSION 可不設）
import { createClient } from "npm:@supabase/supabase-js@2";

const GV = Deno.env.get("GRAPH_VERSION") ?? "v23.0";
const G = `https://graph.facebook.com/${GV}`;
const APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.8-flash";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

type Ctx = { settings: any; conn: any; rules: any[] };
type Platform = "ig" | "fb";

// 要不要「先確認追蹤才給連結」：Meta 核准 instagram_manage_messages／pages_messaging 進階權限後，
// 在 Secrets 加 VERIFY_FOLLOW=1 就會改回按鈕＋確認追蹤的流程
const VERIFY_FOLLOW = Deno.env.get("VERIFY_FOLLOW") === "1";

// ---------- 小工具 ----------
const norm = (s: string) => String(s || "").toLowerCase().replace(/\s+/g, "");
const todayTW = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

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

// 公開回覆在留言底下
async function publicReply(p: Platform, commentId: string, text: string, ctx: Ctx) {
  if (!text) return;
  if (p === "ig") await graphPost(`${commentId}/replies`, { message: text }, ctx.conn.page_token);
  else await graphPost(`${commentId}/comments`, { message: text }, ctx.conn.page_token);
}
// 私訊：recipient 可以是 {comment_id}（從留言私訊，只能一次）或 {id}（對方已經傳過訊息）
async function sendDM(recipient: Record<string, string>, text: string, ctx: Ctx, button?: { title: string; payload: string }) {
  const message: Record<string, unknown> = { text };
  if (button) message.quick_replies = [{ content_type: "text", title: button.title.slice(0, 20), payload: button.payload }];
  try {
    await graphPost(`${ctx.conn.page_id}/messages`, { recipient, message, ...(recipient.id ? { messaging_type: "RESPONSE" } : {}) }, ctx.conn.page_token);
  } catch (e) {
    if (!button) throw e;
    // 有些情況不能帶按鈕：改成請對方回覆一句話
    await graphPost(`${ctx.conn.page_id}/messages`, { recipient, message: { text: `${text}\n\n（按鈕不見的話，直接回覆我「好了」也可以領取 🎁）` } }, ctx.conn.page_token);
  }
}

// 先寫一筆紀錄佔位，重複的通知就不會回兩次
async function claim(row: Record<string, unknown>) {
  const { data, error } = await db.from("reply_log").insert({ ...row, status: "skipped" }).select("id").single();
  if (error) return null; // event_id 重複
  return data.id as number;
}
const finish = (id: number, patch: Record<string, unknown>) => db.from("reply_log").update(patch).eq("id", id);

function matchRule(p: Platform, text: string, ctx: Ctx, oldPost = false) {
  const t = norm(text);
  return ctx.rules.find((r) => r.active && (!oldPost || r.all_posts) && r.platforms.includes(p) && r.keywords.some((k: string) => k && t.includes(norm(k))));
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
// 私訊內容像是在說「我追蹤好了／按讚了，要領取」
const looksLikeClaim = (t: string) => /好了|好囉|好喔|領取|追蹤|按讚|已讚|ok|OK|完成|\+1|要/.test(String(t || ""));
const linkMessage = (rule: any) => [rule.message, rule.link].filter(Boolean).join("\n\n");

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

// ---------- 留言 ----------
async function onComment(p: Platform, c: { id: string; userId: string; userName: string; text: string; postId?: string }, ctx: Ctx) {
  if (!c.text) return;
  const logId = await claim({ platform: p, kind: "comment", event_id: `${p}:c:${c.id}`, post_id: c.postId, user_id: c.userId, user_name: c.userName, text: c.text });
  if (!logId) return;
  try {
    const oldPost = await isOldPost(p, c.postId, ctx);
    const rule = matchRule(p, c.text, ctx, oldPost);
    if (rule) {
      let dm: string, button: { title: string; payload: string } | undefined, action: string;
      if (rule.require_follow && !VERIFY_FOLLOW) {
        // 信任制：直接給連結，附一句請對方追蹤／按讚
        // （Meta 還沒核准進階權限前，一般人的私訊回覆收不到，按鈕流程會卡住）
        const ask = p === "ig" ? "喜歡的話記得追蹤 @cheng.shuang1025 喔 🥰 之後還有更多好玩的學習單！" : "喜歡的話記得幫好事丞雙的粉絲頁按個讚喔 🥰 之後還有更多好玩的學習單！";
        dm = [linkMessage(rule), ask].filter(Boolean).join("\n\n");
        action = "keyword";
      } else if (rule.require_follow) {
        dm = p === "ig" ? ctx.settings.follow_prompt : ctx.settings.fb_like_prompt;
        button = { title: ctx.settings.follow_button, payload: `GATE:${rule.id}` };
        action = "gate_wait";
      } else { dm = linkMessage(rule); action = "keyword"; }
      await publicReply(p, c.id, ctx.settings.public_reply, ctx);
      await sendDM({ comment_id: c.id }, dm, ctx, button);
      await finish(logId, { rule_id: rule.id, action, reply: dm, status: "done" });
      return;
    }
    if (oldPost) { await finish(logId, { action: "skip", status: "skipped", error: "舊貼文，交給 FB／IG 內建的自動回覆" }); return; }
    if (!ctx.settings.ai_enabled) return;
    // 只有「看起來在發問」的留言才問 AI（免費額度一天只有少量次數，像「吹風機」「謝謝分享」這類留言直接略過）
    if (!looksLikeQuestion(c.text)) { await finish(logId, { action: "skip", status: "skipped" }); return; }
    let ai;
    try { ai = await askGemini(c.text, ctx); }
    catch (e) { await finish(logId, { action: "ai", status: "needs_human", error: "AI 暫時無法回答（" + String((e as Error).message).slice(0, 80) + "），請團主回覆" }); return; }
    if (!ai) return;
    if (ai.intent === "groupbuy" && ai.can_answer && ai.answer) {
      await publicReply(p, c.id, ctx.settings.public_reply, ctx);
      await sendDM({ comment_id: c.id }, ai.answer, ctx);
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

// ---------- 私訊（按下領取按鈕、或回覆「好了」）----------
async function onMessage(p: Platform, m: any, ctx: Ctx) {
  const sender = m.sender?.id;
  if (!sender || m.message?.is_echo || sender === ctx.conn.page_id || sender === ctx.conn.ig_user_id) return;
  const payload: string = m.message?.quick_reply?.payload || m.postback?.payload || "";
  const text: string = m.message?.text || m.postback?.title || "";
  let ruleId = payload.startsWith("GATE:") ? +payload.slice(5) : 0;
  if (!ruleId && looksLikeClaim(text) && !matchRule(p, text, ctx)) {
    // 按鈕不見了、改打字「好了」：先找這個人最近在等領取的規則
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const { data } = await db.from("reply_log").select("rule_id").eq("platform", p).eq("user_id", sender).eq("action", "gate_wait")
      .not("rule_id", "is", null).gte("created_at", since).order("created_at", { ascending: false }).limit(1);
    ruleId = data?.[0]?.rule_id || 0;
    if (!ruleId) {
      // 留言和私訊的帳號編號有時對不上：改用這個平台最近 2 小時內有人在等的規則
      const { data: d2 } = await db.from("reply_log").select("rule_id").eq("platform", p).eq("action", "gate_wait")
        .not("rule_id", "is", null).gte("created_at", new Date(Date.now() - 2 * 3600e3).toISOString()).order("created_at", { ascending: false }).limit(1);
      ruleId = d2?.[0]?.rule_id || 0;
    }
  }
  if (!ruleId) {
    {
      // 直接私訊關鍵字：跟留言一樣，要先追蹤的話先請對方追蹤／按讚，再按按鈕領取
      const r = matchRule(p, text, ctx);
      if (!r) return; // 一般私訊交給團主自己看
      const mid = m.message?.mid || crypto.randomUUID();
      const id0 = await claim({ platform: p, kind: "message", event_id: `${p}:m:${mid}`, user_id: sender, text, rule_id: r.id });
      if (!id0) return;
      try {
        if (r.require_follow && VERIFY_FOLLOW) {
          const dm = p === "ig" ? ctx.settings.follow_prompt : ctx.settings.fb_like_prompt;
          await sendDM({ id: sender }, dm, ctx, { title: ctx.settings.follow_button, payload: `GATE:${r.id}` });
          await finish(id0, { action: "gate_wait", reply: dm, status: "done" });
        } else {
          const dm = linkMessage(r);
          await sendDM({ id: sender }, dm, ctx);
          await finish(id0, { action: "keyword", reply: dm, status: "done" });
        }
      } catch (e) {
        await finish(id0, { status: "error", error: (e as Error).message });
      }
      return;
    }
  }
  const rule = ctx.rules.find((r) => r.id === ruleId && r.active);
  if (!rule) return;
  const logId = await claim({ platform: p, kind: "message", event_id: `${p}:m:${m.message?.mid || m.postback?.mid || crypto.randomUUID()}`, user_id: sender, text, rule_id: rule.id });
  if (!logId) return;
  try {
    let ok = true, name = "";
    if (rule.require_follow && p === "ig") {
      const prof = await graphGet(sender, { fields: "username,is_user_follow_business" }, ctx.conn.page_token);
      ok = !!prof.is_user_follow_business; name = prof.username || "";
    }
    if (ok) {
      const dm = linkMessage(rule);
      await sendDM({ id: sender }, dm, ctx);
      await finish(logId, { action: "gate_ok", reply: dm, status: "done", user_name: name || null });
    } else {
      await sendDM({ id: sender }, ctx.settings.not_following, ctx, { title: ctx.settings.follow_button, payload: `GATE:${rule.id}` });
      await finish(logId, { action: "gate_wait", reply: ctx.settings.not_following, status: "done", user_name: name || null });
    }
  } catch (e) {
    await finish(logId, { status: "error", error: (e as Error).message });
  }
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

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    // Meta 設定 webhook 時的驗證
    const { data } = await db.from("reply_settings").select("verify_token").eq("id", 1).single();
    if (url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === data?.verify_token) {
      return new Response(url.searchParams.get("hub.challenge") || "", { status: 200 });
    }
    // 檢查連線狀態（只回報訂閱與權限，不含權杖），要帶驗證權杖才能看
    if (url.searchParams.get("hub.mode") === "check" && url.searchParams.get("hub.verify_token") === data?.verify_token) {
      const { data: conn } = await db.from("meta_connection").select("*").eq("id", 1).maybeSingle();
      const out: Record<string, unknown> = { page: conn?.page_name, ig: conn?.ig_username };
      try {
        const appToken = `${Deno.env.get("META_APP_ID") ?? "1392117529656742"}|${APP_SECRET}`;
        out.subscribed_apps = (await graphGet(`${conn.page_id}/subscribed_apps`, {}, conn.page_token)).data;
        const dbg = await graphGet("debug_token", { input_token: conn.page_token }, appToken);
        out.token = { type: dbg.data?.type, valid: dbg.data?.is_valid, expires: dbg.data?.expires_at, scopes: dbg.data?.scopes };
      } catch (e) { out.error = (e as Error).message; }
      return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" } });
    }
    return new Response("forbidden", { status: 403 });
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
