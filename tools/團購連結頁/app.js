(function () {
  "use strict";

  /* ---------- 小工具 ---------- */
  const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
  const TAG_EMOJI = { "生活用品": "🧴", "食品": "🍎", "教材": "📚", "服飾": "👕", "文具": "✏️", "玩具": "🧸" };

  const SVG = {
    instagram: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="17.3" cy="6.7" r="1.2" fill="currentColor"/></svg>',
    facebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.5-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H7.8v3h2.6V21h3.1z"/></svg>',
    group: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8.5" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="16.5" cy="9.5" r="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M16 14.6c2.4 0 4 1.3 4.6 3.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    threads: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M16.5 8.5C15.8 6 14 4.5 11.8 4.5 8 4.5 6 7.6 6 12s2 7.5 6 7.5c3 0 5.3-1.8 5.3-4.6 0-2.4-1.9-3.8-4.6-3.8-2 0-3.3 1-3.3 2.4 0 1.3 1.1 2.2 2.6 2.2 2.4 0 3.4-2 3.4-4.7"/></svg>',
    line: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M12 4c-4.7 0-8.5 3-8.5 6.8 0 3.4 3 6.2 7.1 6.7l-.4 2.5 3.6-2.5c3.7-.6 6.7-3.3 6.7-6.7C20.5 7 16.7 4 12 4z"/></svg>',
    youtube: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10.5 9.5v5l4.2-2.5z" fill="currentColor"/></svg>'
  };

  const pad = (n) => String(n).padStart(2, "0");
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function toDate(str) {
    const [y, m, d] = str.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  function daysBetween(fromStr, toStr) {
    return Math.round((toDate(toStr) - toDate(fromStr)) / 86400000);
  }
  function fmtDate(str) {
    if (!str) return "";
    const d = toDate(str);
    return `${d.getMonth() + 1}/${pad(d.getDate())}（${WEEK[d.getDay()]}）`;
  }
  function shortDate(str) {
    const d = toDate(str);
    return `${d.getMonth() + 1}/${pad(d.getDate())}`;
  }
  function isLink(url) {
    return typeof url === "string" && /^https?:\/\//i.test(url.trim());
  }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function classify(item, today) {
    if (item.start && item.start > today) return "upcoming";
    if (item.end && item.end < today) return "ended";
    return "active";
  }

  function badgeFor(item, status, today) {
    if (status === "upcoming") {
      const n = daysBetween(today, item.start);
      return { text: n === 1 ? "明天開團" : `${n} 天後開團`, cls: "badge-soon" };
    }
    if (status === "ended") return { text: "已結束", cls: "badge-ended" };
    if (!item.end) return { text: "長期開放", cls: "badge-live" };
    const n = daysBetween(today, item.end);
    if (n === 0) return { text: "今天截止", cls: "badge-urgent" };
    if (n <= 3) return { text: `倒數 ${n} 天`, cls: "badge-urgent" };
    return { text: "開團中", cls: "badge-live" };
  }

  function dateRange(item) {
    if (item.start && item.end) return `${fmtDate(item.start)} – ${fmtDate(item.end)}`;
    if (item.end) return `即日起 – ${fmtDate(item.end)}`;
    if (item.start) return `${fmtDate(item.start)} 起`;
    return "";
  }

  /* ---------- 團購卡片 ---------- */
  function renderCard(item, status, today) {
    const card = el("article", `card card-${status}`);

    const thumb = el("div", "card-thumb");
    if (item.image) {
      const img = el("img");
      img.src = item.image;
      img.alt = item.title || "";
      img.loading = "lazy";
      thumb.appendChild(img);
    } else {
      thumb.classList.add("no-img");
      thumb.appendChild(el("span", "card-emoji", TAG_EMOJI[item.tag] || "🛍️"));
    }
    card.appendChild(thumb);

    const body = el("div", "card-body");

    const top = el("div", "card-top");
    if (item.tag) top.appendChild(el("span", "card-tag", item.tag));
    const badge = badgeFor(item, status, today);
    top.appendChild(el("span", `badge ${badge.cls}`, badge.text));
    body.appendChild(top);

    body.appendChild(el("h3", "card-title", item.title || "未命名團購"));
    if (item.desc) body.appendChild(el("p", "card-desc", item.desc));

    const points = (item.points || []).filter((p) => p && p !== item.desc);
    if (points.length && status !== "ended") {
      const det = el("details", "card-points");
      det.appendChild(el("summary", null, "看推薦重點"));
      const ul = el("ul");
      points.forEach((p) => ul.appendChild(el("li", null, p)));
      det.appendChild(ul);
      body.appendChild(det);
    }

    const foot = el("div", "card-foot");
    const range = dateRange(item);
    if (range) foot.appendChild(el("span", "card-date", range));

    if (status === "active" && isLink(item.url)) {
      const a = el("a", "btn btn-primary", "前往下單");
      a.href = item.url.trim();
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.appendChild(el("span", "btn-arrow", "→"));
      foot.appendChild(a);
    } else if (status === "active") {
      foot.appendChild(el("span", "btn btn-muted", "連結準備中"));
    } else if (status === "upcoming") {
      foot.appendChild(el("span", "btn btn-ghost", `${shortDate(item.start)} 開團`));
    }
    body.appendChild(foot);

    card.appendChild(body);
    return card;
  }

  /* ---------- 自我介紹 ---------- */
  function renderProfile() {
    const P = typeof PROFILE !== "undefined" ? PROFILE : {};

    const avatar = document.getElementById("avatar");
    if (P.avatar) {
      const img = el("img");
      img.src = P.avatar;
      img.alt = P.name || "";
      avatar.appendChild(img);
      avatar.classList.add("has-photo");
    } else {
      avatar.textContent = "丞";
    }

    document.getElementById("title").textContent = P.title || "";
    document.getElementById("name").textContent = P.name || P.brand || "";
    document.getElementById("tagline").textContent = P.tagline || "";
    if (P.brand || P.title) document.getElementById("footer-brand").textContent = [P.brand, P.title].filter(Boolean).join(" x ");

    const intro = document.getElementById("intro");
    (P.intro || []).forEach((t) => intro.appendChild(el("p", null, t)));

    const promises = document.getElementById("promises");
    (P.promises || []).forEach((p) => {
      const li = el("li");
      li.appendChild(el("span", "promise-icon", p.icon || "✓"));
      li.appendChild(el("span", null, p.text));
      promises.appendChild(li);
    });
    if (!promises.children.length) promises.hidden = true;

    const ig = document.getElementById("ig-link");
    if (P.instagram && isLink(P.instagram.url)) {
      ig.href = P.instagram.url;
      ig.innerHTML = SVG.instagram;
      ig.appendChild(el("span", null, P.instagram.handle || "Instagram"));
      ig.hidden = false;
    }

    const social = document.getElementById("social");
    (P.links || []).filter((l) => isLink(l.url)).forEach((link) => {
      const a = el("a", "social-btn");
      a.href = link.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.setAttribute("aria-label", link.label || "");
      a.innerHTML = SVG[link.icon] || "🔗";
      a.appendChild(el("span", null, link.label || ""));
      social.appendChild(a);
    });
  }

  /* ---------- 團購清單 ---------- */
  /* ---------- 從總後台（資料庫）讀團購；讀不到就用 data.js 備份 ---------- */
  const DB = {
    url: "https://swfpfnvnydekyuwcagdy.supabase.co/rest/v1/site_campaigns?select=*&order=sort",
    key: "sb_publishable_1dorLitRmxPW2mXqOURLqA_-881MPuO"
  };
  async function loadGroupBuys() {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(DB.url, { headers: { apikey: DB.key }, cache: "no-store", signal: ctrl.signal });
      clearTimeout(timer);
      if (!r.ok) throw new Error(r.status);
      const rows = await r.json();
      if (!Array.isArray(rows) || !rows.length) throw new Error("empty");
      return rows.map((c) => ({
        title: c.title, desc: c.descr, points: c.points || [], image: c.image || "",
        url: c.url || "", tag: c.tag || "", start: c.start_date || "", end: c.end_date || "",
        worksheet: !!c.worksheet
      }));
    } catch (e) {
      return typeof GROUP_BUYS !== "undefined" ? GROUP_BUYS : [];
    }
  }

  function renderGroupBuys(list) {
    const today = todayStr();
    const buckets = { active: [], upcoming: [], ended: [] };
    list.forEach((item) => {
      buckets[classify(item, today)].push(item);
    });

    buckets.active.sort((a, b) => (a.end || "9999").localeCompare(b.end || "9999"));
    buckets.upcoming.sort((a, b) => (a.start || "").localeCompare(b.start || ""));
    buckets.ended.sort((a, b) => (b.end || "").localeCompare(a.end || ""));

    const fill = (key) => {
      const box = document.getElementById(`cards-${key}`);
      buckets[key].forEach((item) => box.appendChild(renderCard(item, key, today)));
      const c = document.getElementById(`count-${key}`);
      if (c) c.textContent = buckets[key].length ? `${buckets[key].length} 團` : "";
    };

    fill("active");
    if (!buckets.active.length) {
      const empty = document.getElementById("empty-active");
      const next = buckets.upcoming[0];
      empty.appendChild(el("p", "empty-main", "目前沒有進行中的團購"));
      if (next) {
        empty.appendChild(el("p", "empty-sub", `下一團「${next.title}」${fmtDate(next.start)} 開團，敬請期待！`));
      } else {
        empty.appendChild(el("p", "empty-sub", "新的團購準備中，追蹤 IG 就能第一時間知道！"));
      }
      empty.hidden = false;
    }

    if (buckets.upcoming.length) {
      document.getElementById("section-upcoming").hidden = false;
      fill("upcoming");
    }

    if (buckets.ended.length) {
      document.getElementById("section-ended").hidden = false;
      fill("ended");
      const toggle = document.getElementById("toggle-ended");
      const box = document.getElementById("cards-ended");
      toggle.addEventListener("click", () => {
        const open = toggle.classList.toggle("open");
        toggle.setAttribute("aria-expanded", String(open));
        box.hidden = !open;
      });
    }

    // 快速切換
    const jump = document.getElementById("jump");
    [
      ["active", "進行中", "section-active"],
      ["upcoming", "即將開團", "section-upcoming"],
      ["ended", "已結束", "section-ended"]
    ].forEach(([key, label, id]) => {
      if (key !== "active" && !buckets[key].length) return;
      const a = el("a", `jump-chip jump-${key}`);
      a.href = `#${id}`;
      a.appendChild(el("span", null, label));
      a.appendChild(el("b", null, String(buckets[key].length)));
      jump.appendChild(a);
    });
  }

  renderProfile();
  loadGroupBuys().then(renderGroupBuys);
})();
