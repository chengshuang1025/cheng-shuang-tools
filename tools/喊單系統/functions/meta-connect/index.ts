// meta-connect：團主在總後台按「用 Facebook 連接」後，把 FB 給的短期權杖換成粉絲頁長期權杖並存起來
// 需要的 Secrets：META_APP_SECRET（Meta App 的應用程式密鑰）；META_APP_ID 沒設就用「好事丞雙團購」的 ID
import { createClient } from "npm:@supabase/supabase-js@2";

const GV = Deno.env.get("GRAPH_VERSION") ?? "v23.0";
const G = `https://graph.facebook.com/${GV}`;
const APP_ID = Deno.env.get("META_APP_ID") ?? "1618683120034433";
const APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function graph(path: string, params: Record<string, string>, method = "GET") {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${G}/${path}?${qs}`, { method });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error?.message || `Graph API ${r.status}`);
  return j;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (!APP_SECRET) return json({ error: "伺服器還沒設定 META_APP_SECRET" }, 500);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // 只有管理者可以連接
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await db.auth.getUser(jwt);
    if (!u?.user) return json({ error: "請重新登入後台" }, 401);
    const { data: prof } = await db.from("profiles").select("role").eq("id", u.user.id).maybeSingle();
    if (prof?.role !== "admin") return json({ error: "只有團主可以連接粉絲頁" }, 403);

    const { user_token } = await req.json();
    if (!user_token) return json({ error: "沒有收到 Facebook 授權" }, 400);

    // 1. 換成長期使用者權杖（用它拿到的粉絲頁權杖不會過期）
    const long = await graph("oauth/access_token", { grant_type: "fb_exchange_token", client_id: APP_ID, client_secret: APP_SECRET, fb_exchange_token: user_token });
    // 2. 找粉絲頁（優先選有連 IG 的那一個）
    const pages = await graph("me/accounts", { fields: "id,name,access_token,instagram_business_account{id,username}", access_token: long.access_token });
    const list = pages.data || [];
    if (!list.length) return json({ error: "這個 Facebook 帳號底下沒有找到粉絲頁，或授權時沒有勾選粉絲頁" }, 400);
    const page = list.find((p: any) => p.instagram_business_account) || list[0];
    // 3. 讓粉絲頁把留言、私訊通知送到我們的 webhook
    await graph(`${page.id}/subscribed_apps`, { subscribed_fields: "feed,messages,messaging_postbacks", access_token: page.access_token }, "POST");

    const ig = page.instagram_business_account || null;
    const { error } = await db.from("meta_connection").upsert({
      id: 1, page_id: page.id, page_name: page.name, page_token: page.access_token,
      ig_user_id: ig?.id ?? null, ig_username: ig?.username ?? null, connected_at: new Date().toISOString(),
    });
    if (error) throw error;
    return json({ page_name: page.name, ig_username: ig?.username ?? null });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
