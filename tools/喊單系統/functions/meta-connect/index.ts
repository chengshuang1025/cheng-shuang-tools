// meta-connect：團主在總後台按「用 Facebook 連接」→ 到 Facebook 授權 → Facebook 帶著 code 回到這裡
// 這裡把 code 換成粉絲頁長期權杖、訂閱留言與私訊通知，存好後把團主送回總後台
// 用的是「好事丞雙自動回覆」這個 Meta App（跟 +1 系統登入用的「好事丞雙團購」分開）
// 需要的 Secrets：META_APP_SECRET（「好事丞雙自動回覆」的應用程式密鑰）
import { createClient } from "npm:@supabase/supabase-js@2";

const GV = Deno.env.get("GRAPH_VERSION") ?? "v23.0";
const G = `https://graph.facebook.com/${GV}`;
const APP_ID = Deno.env.get("META_APP_ID") ?? "1392117529656742";
const APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const ADMIN_URL = "https://chengshuang1025.github.io/cheng-shuang-tools/order/admin.html";
const SELF_URL = Deno.env.get("SUPABASE_URL") + "/functions/v1/meta-connect";

const back = (params: Record<string, string>) =>
  new Response(null, { status: 302, headers: { Location: ADMIN_URL + "?" + new URLSearchParams(params).toString() + "#reply" } });

async function graph(path: string, params: Record<string, string>, method = "GET") {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${G}/${path}?${qs}`, { method });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error?.message || `Graph API ${r.status}`);
  return j;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") || "";
  if (url.searchParams.get("error")) return back({ meta_error: "妳在 Facebook 取消了授權" });
  if (!code) return back({ meta_error: "沒有收到 Facebook 授權" });
  try {
    if (!APP_SECRET) throw new Error("伺服器還沒設定 META_APP_SECRET");
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // 確認狀態碼是團主剛剛在後台產生的（15 分鐘內有效、用過就刪）
    if (!/^[0-9a-f-]{36}$/i.test(state)) throw new Error("連接逾時，請回後台再按一次");
    const { data: st } = await db.from("meta_oauth_state").delete().eq("id", state).select("created_at").maybeSingle();
    if (!st || Date.now() - Date.parse(st.created_at) > 15 * 60e3) throw new Error("連接逾時，請回後台再按一次");

    // 1. code → 短期權杖 → 長期權杖（用長期權杖拿到的粉絲頁權杖不會過期）
    const short = await graph("oauth/access_token", { client_id: APP_ID, client_secret: APP_SECRET, redirect_uri: SELF_URL, code });
    const long = await graph("oauth/access_token", { grant_type: "fb_exchange_token", client_id: APP_ID, client_secret: APP_SECRET, fb_exchange_token: short.access_token });
    // 2. 找粉絲頁（優先選有連 IG 的那一個）
    const pages = await graph("me/accounts", { fields: "id,name,access_token,instagram_business_account{id,username}", access_token: long.access_token });
    const list = pages.data || [];
    if (!list.length) throw new Error("沒有找到粉絲頁，授權時請勾選妳的粉絲頁");
    const page = list.find((p: any) => p.instagram_business_account) || list[0];
    // 3. 讓粉絲頁把留言、私訊通知送到 webhook
    await graph(`${page.id}/subscribed_apps`, { subscribed_fields: "feed,messages,messaging_postbacks", access_token: page.access_token }, "POST");

    const ig = page.instagram_business_account || null;
    const { error } = await db.from("meta_connection").upsert({
      id: 1, page_id: page.id, page_name: page.name, page_token: page.access_token,
      ig_user_id: ig?.id ?? null, ig_username: ig?.username ?? null, connected_at: new Date().toISOString(),
    });
    if (error) throw error;
    return back({ meta: "ok" });
  } catch (e) {
    return back({ meta_error: (e as Error).message });
  }
});
