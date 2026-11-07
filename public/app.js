"use strict";

/* =========================================================
   TableBook – հաճախորդի մաս
   Տվյալները պահվում են սերվերում (/api/...)։
   ========================================================= */

const AREAS = {
  window: "Պատուհանի մոտ",
  inside: "Սրահ",
  terrace: "Տեռաս",
};

const AREA_IMAGES = {
  window: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=900&h=300&fit=crop&q=70",
  inside: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=900&h=300&fit=crop&q=70",
  terrace: "https://images.unsplash.com/photo-1559339352-11d035aa65de?w=1400&h=300&fit=crop&q=70",
};

const CATEGORIES = {
  starter: "Նախուտեստ",
  main: "Հիմնական ուտեստ",
  dessert: "Աղանդեր",
  drink: "Ըմպելիք",
};

const DEFAULT_BANNER = "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1600&h=500&fit=crop&q=75";
const MAX_GUESTS = 12;

const WEEKDAYS = ["Կիրակի", "Երկուշաբթի", "Երեքշաբթի", "Չորեքշաբթի", "Հինգշաբթի", "Ուրբաթ", "Շաբաթ"];
const MONTHS = ["հունվարի", "փետրվարի", "մարտի", "ապրիլի", "մայիսի", "հունիսի",
  "հուլիսի", "օգոստոսի", "սեպտեմբերի", "հոկտեմբերի", "նոյեմբերի", "դեկտեմբերի"];
const MONTHS_SHORT = ["հնվ", "փտվ", "մրտ", "ապր", "մյս", "հնս", "հլս", "օգս", "սեպ", "հոկ", "նոյ", "դեկ"];

/* ---------- Օգնականներ ---------- */
const $ = (sel) => document.querySelector(sel);
const pad = (n) => String(n).padStart(2, "0");
const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => `${Number(n).toLocaleString("en-US").replace(/,/g, " ")} ֏`;
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");

function formatDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${WEEKDAYS[new Date(y, m - 1, d).getDay()]}, ${d} ${MONTHS[m - 1]} ${y}`;
}
const guestsLabel = (n) => `${n} անձ`;

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove("show"), 3200);
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Սխալ է տեղի ունեցել։");
  return data;
}

/* ---------- Վիճակ ---------- */
const state = {
  user: null,
  view: "book",
  restaurants: [],
  details: {},          // restaurantId → { restaurant, slots, tables, dishes }
  busy: new Set(),
  selectedTable: null,
  menuRestaurant: null, // մուտքի էջի ճաշացանկի ընտրված ռեստորանը
};

async function loadDetails(id) {
  if (!state.details[id]) state.details[id] = await api(`/api/restaurants/${id}`);
  return state.details[id];
}

/* ---------- Ճաշացանկ ---------- */
function dishesHtml(dishes) {
  if (!dishes.length) return `<p class="empty">Ճաշացանկը դեռ դատարկ է։</p>`;
  return dishes.map((d) => {
    const img = safeUrl(d.image);
    return `
      <figure class="dish">
        <div class="ph">${img
          ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(d.name)}" loading="lazy">`
          : `<div class="ph-empty"><span class="monogram">TB</span></div>`}</div>
        <figcaption><b>${escapeHtml(d.name)}</b><i></i><span>${money(d.price)}</span></figcaption>
        <p class="dish-desc"><em>${CATEGORIES[d.category] || ""}</em>${d.description ? " · " + escapeHtml(d.description) : ""}</p>
      </figure>`;
  }).join("");
}

/* ---------- Մուտքի էջ ---------- */
function renderRestaurantCards() {
  $("#factRestaurants").textContent = state.restaurants.length;
  $("#restaurantCards").innerHTML = state.restaurants.length
    ? state.restaurants.map((r) => `
      <article class="rcard" data-rest="${r.id}">
        <div class="ph">${safeUrl(r.image)
          ? `<img src="${escapeHtml(r.image)}" alt="${escapeHtml(r.name)}" loading="lazy">`
          : `<div class="ph-empty"><span class="monogram">TB</span></div>`}</div>
        <div class="rcard-body">
          <h3>${escapeHtml(r.name)}</h3>
          <p>${escapeHtml(r.description)}</p>
          <ul class="rcard-meta">
            ${r.address ? `<li><span>Հասցե</span>${escapeHtml(r.address)}</li>` : ""}
            <li><span>Ժամեր</span>${r.open_time} – ${r.close_time}</li>
            <li><span>Սեղաններ</span>${r.table_count}</li>
          </ul>
          <button type="button" class="offer-link" data-show-menu="${r.id}">Տեսնել ճաշացանկը →</button>
        </div>
      </article>`).join("")
    : `<p class="empty">Ռեստորաններ դեռ չկան։</p>`;

  document.querySelectorAll("[data-show-menu]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      state.menuRestaurant = Number(btn.dataset.showMenu);
      await renderAuthMenu();
      $(".menu").scrollIntoView({ behavior: "smooth" });
    }));
}

async function renderAuthMenu() {
  if (!state.restaurants.length) { $("#authMenu").innerHTML = ""; return; }
  const id = state.menuRestaurant || state.restaurants[0].id;
  state.menuRestaurant = id;
  $("#authMenuTabs").innerHTML = state.restaurants.length > 1
    ? state.restaurants.map((r) =>
        `<button type="button" class="menu-tab${r.id === id ? " active" : ""}" data-menu-tab="${r.id}">${escapeHtml(r.name)}</button>`).join("")
    : "";
  document.querySelectorAll("[data-menu-tab]").forEach((b) =>
    b.addEventListener("click", () => { state.menuRestaurant = Number(b.dataset.menuTab); renderAuthMenu(); }));
  const d = await loadDetails(id);
  $("#authMenuTitle").textContent = `«${d.restaurant.name}»`;
  $("#authMenu").innerHTML = dishesHtml(d.dishes);
}

/* ---------- Մուտք / Գրանցում ---------- */
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    $("#loginForm").classList.toggle("hidden", tab.dataset.tab !== "login");
    $("#registerForm").classList.toggle("hidden", tab.dataset.tab !== "register");
    $("#loginError").textContent = "";
    $("#registerError").textContent = "";
  });
});

function afterLogin(user, message) {
  state.user = user;
  toast(message);
  if (user.role === "admin" && new URLSearchParams(location.search).has("admin")) {
    location.href = "/admin";
    return;
  }
  history.replaceState(null, "", "/");
  render();
}

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const err = $("#loginError");
  if (!f.email.value.trim() || !f.password.value) { err.textContent = "Լրացրեք էլ. փոստը և գաղտնաբառը։"; return; }
  try {
    const { user } = await api("/api/login", { method: "POST", body: { email: f.email.value, password: f.password.value } });
    err.textContent = "";
    f.reset();
    afterLogin(user, `Բարի գալուստ, ${user.name}։`);
  } catch (ex) { err.textContent = ex.message; }
});

$("#registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const err = $("#registerError");
  if (f.password.value !== f.password2.value) { err.textContent = "Գաղտնաբառերը չեն համընկնում։"; return; }
  try {
    const { user } = await api("/api/register", {
      method: "POST",
      body: { name: f.name.value, email: f.email.value, phone: f.phone.value, password: f.password.value },
    });
    err.textContent = "";
    f.reset();
    afterLogin(user, "Հաշիվը ստեղծված է։ Բարի գալուստ։");
  } catch (ex) { err.textContent = ex.message; }
});

$("#logoutBtn").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  state.user = null;
  state.selectedTable = null;
  toast("Դուք դուրս եկաք համակարգից։");
  render();
});

/* ---------- Նավիգացիա ---------- */
document.querySelectorAll(".navlink[data-view]").forEach((btn) => {
  btn.addEventListener("click", () => { state.view = btn.dataset.view; render(); });
});

function render() {
  const user = state.user;
  $("#authView").classList.toggle("hidden", !!user);
  $("#nav").classList.toggle("hidden", !user);
  $("#bookView").classList.toggle("hidden", !user || state.view !== "book");
  $("#mineView").classList.toggle("hidden", !user || state.view !== "mine");

  if (!user) {
    if (new URLSearchParams(location.search).has("admin")) {
      $("#authTitle").textContent = "Ադմինի մուտք";
    }
    renderRestaurantCards();
    renderAuthMenu();
    return;
  }

  $("#userName").textContent = user.name;
  $("#adminLink").classList.toggle("hidden", user.role !== "admin");
  $("#greeting").textContent = `Բարի գալուստ, ${user.name.split(" ")[0]}`;
  document.querySelectorAll(".navlink[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === state.view));

  if (state.view === "book") refreshBooking();
  else renderMine();
}

/* ---------- Ամրագրում ---------- */
const searchForm = $("#searchForm");

function initSearchForm() {
  const today = isoDate(new Date());
  const max = new Date(); max.setDate(max.getDate() + 60);
  searchForm.date.min = today;
  searchForm.date.max = isoDate(max);
  searchForm.date.value = today;

  for (let g = 1; g <= MAX_GUESTS; g++) {
    searchForm.guests.add(new Option(guestsLabel(g), g, false, g === 2));
  }

  searchForm.addEventListener("change", (e) => {
    state.selectedTable = null;
    $("#bookError").textContent = "";
    if (e.target.name === "restaurant" || e.target.name === "date") fillTimes();
    refreshBooking();
  });
}

function fillRestaurants() {
  const sel = searchForm.restaurant;
  const prev = sel.value;
  sel.innerHTML = "";
  state.restaurants.forEach((r) => sel.add(new Option(r.name, r.id, false, String(r.id) === prev)));
}

function availableSlots(slots, dateIso) {
  const now = new Date();
  if (dateIso !== isoDate(now)) return slots;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return slots.filter((s) => toMin(s) > nowMin + 30);
}

function fillTimes() {
  const d = state.details[searchForm.restaurant.value];
  const sel = searchForm.time;
  const prev = sel.value;
  sel.innerHTML = "";
  const slots = d ? availableSlots(d.slots, searchForm.date.value) : [];
  if (!slots.length) {
    sel.add(new Option("Ազատ ժամեր չկան", ""));
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  const def = slots.includes(prev) ? prev : (slots.includes("19:00") ? "19:00" : slots[0]);
  slots.forEach((s) => sel.add(new Option(s, s, false, s === def)));
}

function currentQuery() {
  return {
    restaurantId: Number(searchForm.restaurant.value),
    date: searchForm.date.value,
    time: searchForm.time.value,
    guests: Number(searchForm.guests.value),
    area: searchForm.area.value,
  };
}

async function refreshBooking() {
  if (!state.restaurants.length) {
    $("#floor").innerHTML = `<p class="empty">Ռեստորաններ դեռ չկան։</p>`;
    $("#planInfo").textContent = "";
    return;
  }
  if (!searchForm.restaurant.options.length) fillRestaurants();
  const d = await loadDetails(searchForm.restaurant.value);
  if (!searchForm.time.options.length || searchForm.time.dataset.rest !== String(d.restaurant.id)) {
    fillTimes();
    searchForm.time.dataset.rest = d.restaurant.id;
  }

  const r = d.restaurant;
  $("#bookBanner").style.setProperty("--img", `url('${safeUrl(r.image) || DEFAULT_BANNER}')`);
  $("#bookRestName").textContent = `Ռեստորան «${r.name}»`;
  $("#bookRestInfo").textContent = [r.address, `${r.open_time} – ${r.close_time}`, r.phone].filter(Boolean).join(" · ");
  $("#bookMenuTitle").textContent = `«${r.name}»`;
  $("#bookMenu").innerHTML = dishesHtml(d.dishes);

  const q = currentQuery();
  state.busy = new Set();
  if (q.time) {
    try {
      const { busy } = await api(`/api/restaurants/${q.restaurantId}/availability?date=${q.date}&time=${q.time}`);
      state.busy = new Set(busy);
    } catch (ex) { toast(ex.message); }
  }
  renderFloor();
}

function tableState(table, q) {
  if (!q.time || state.busy.has(table.id)) return "busy";
  if (table.seats < q.guests || table.seats > q.guests + 3) return "small";
  if (q.area && table.area !== q.area) return "small";
  return "free";
}

function renderFloor() {
  const q = currentQuery();
  const d = state.details[q.restaurantId];
  const floor = $("#floor");
  floor.innerHTML = "";
  let freeCount = 0;

  for (const [areaKey, areaName] of Object.entries(AREAS)) {
    const tables = d.tables.filter((t) => t.area === areaKey);
    if (!tables.length) continue;
    const zone = document.createElement("div");
    zone.className = "zone " + areaKey;
    zone.innerHTML = `<div class="zone-head" style="--img:url('${AREA_IMAGES[areaKey]}')">` +
      `<span class="zone-title">${areaName}</span><span class="zone-count"></span></div><div class="tables"></div>`;
    const wrap = zone.querySelector(".tables");
    let zoneFree = 0;

    tables.forEach((t) => {
      const st = tableState(t, q);
      if (st === "free") { freeCount++; zoneFree++; }
      const btn = document.createElement("button");
      btn.type = "button";
      const size = t.seats <= 2 ? 2 : t.seats <= 4 ? 4 : t.seats <= 6 ? 6 : 8;
      btn.className = `table s${size} ${st}` + (state.selectedTable === t.id ? " selected" : "");
      btn.innerHTML = `${escapeHtml(t.code)}<small>${t.seats} տեղ</small>`;
      btn.title = st === "busy" ? "Այս ժամին զբաղված է"
        : st === "small" ? "Չի համապատասխանում ընտրված պարամետրերին" : "Ազատ է – սեղմեք ընտրելու համար";
      btn.disabled = st !== "free";
      btn.addEventListener("click", () => { state.selectedTable = t.id; $("#bookError").textContent = ""; renderFloor(); });
      wrap.appendChild(btn);
    });
    zone.querySelector(".zone-count").textContent = `${zoneFree} ազատ`;
    floor.appendChild(zone);
  }
  if (!floor.children.length) floor.innerHTML = `<p class="empty">Այս ռեստորանում սեղաններ դեռ չկան։</p>`;

  $("#planInfo").textContent = !q.time
    ? "Ընտրված օրվա համար ազատ ժամեր չկան։"
    : freeCount
      ? `${freeCount} հարմար սեղան ազատ է ${formatDate(q.date)}, ժամը ${q.time}-ին (${guestsLabel(q.guests)})։`
      : "Այս ժամին հարմար ազատ սեղան չկա։ Փորձեք այլ ժամ կամ գոտի։";

  const summary = $("#summary");
  const table = d.tables.find((t) => t.id === state.selectedTable);
  if (table && tableState(table, q) === "free") {
    summary.classList.remove("muted");
    summary.innerHTML = `«${escapeHtml(d.restaurant.name)}» · Սեղան <strong>${escapeHtml(table.code)}</strong> ` +
      `(${AREAS[table.area]}, ${table.seats} տեղ) · <strong>${formatDate(q.date)}</strong>, ժամը <strong>${q.time}</strong> · ` +
      `<strong>${guestsLabel(q.guests)}</strong>`;
    $("#bookBtn").disabled = false;
  } else {
    state.selectedTable = null;
    summary.classList.add("muted");
    summary.textContent = "Խնդրում ենք ընտրել ազատ սեղան դասավորությունից։";
    $("#bookBtn").disabled = true;
  }
}

$("#bookBtn").addEventListener("click", async () => {
  const q = currentQuery();
  const d = state.details[q.restaurantId];
  const table = d?.tables.find((t) => t.id === state.selectedTable);
  if (!table) return;
  const btn = $("#bookBtn");
  btn.disabled = true;
  try {
    await api("/api/reservations", {
      method: "POST",
      body: { restaurantId: q.restaurantId, tableId: table.id, date: q.date, time: q.time, guests: q.guests, notes: $("#notes").value },
    });
    $("#notes").value = "";
    state.selectedTable = null;
    toast(`Ամրագրված է՝ «${d.restaurant.name}», սեղան ${table.code}, ${formatDate(q.date)}, ժամը ${q.time}`);
    state.view = "mine";
    render();
  } catch (ex) {
    $("#bookError").textContent = ex.message;
    fillTimes(); // ժամերը կարող էին հնանալ, եթե էջը երկար է բաց եղել
    refreshBooking();
  }
});

/* ---------- Իմ ամրագրումները ---------- */
async function renderMine() {
  let reservations = [];
  try { ({ reservations } = await api("/api/reservations/mine")); }
  catch (ex) { toast(ex.message); return; }

  const now = new Date();
  const nowKey = `${isoDate(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const upcoming = reservations.filter((r) => r.status === "active" && `${r.date} ${r.time}` >= nowKey);
  const past = reservations.filter((r) => !upcoming.includes(r)).reverse();

  $("#upcoming").innerHTML = upcoming.length
    ? upcoming.map((r) => resHtml(r, true)).join("")
    : `<p class="empty">Առաջիկա ամրագրումներ չունեք։ <a href="#" id="goBook">Ամրագրել սեղան →</a></p>`;
  $("#past").innerHTML = past.length
    ? past.map((r) => resHtml(r, false)).join("")
    : `<p class="empty">Դեռ ոչինչ չկա։</p>`;

  $("#goBook")?.addEventListener("click", (e) => { e.preventDefault(); state.view = "book"; render(); });
  document.querySelectorAll("[data-cancel]").forEach((btn) =>
    btn.addEventListener("click", () => cancelReservation(btn.dataset.cancel)));
}

const STATUS_BADGE = { cancelled: "չեղարկված", done: "կայացած", noshow: "չներկայացավ" };

function resHtml(r, canCancel) {
  const badge = STATUS_BADGE[r.status] ? `<span class="badge">${STATUS_BADGE[r.status]}</span>`
    : !canCancel ? `<span class="badge">անցած</span>` : "";
  const [y, m, d] = r.date.split("-").map(Number);
  const cls = r.status === "cancelled" ? "cancelled" : !canCancel ? "past" : "";
  return `
    <div class="res ${r.area} ${cls}">
      <div class="datebox"><b>${d}</b><small class="mon">${MONTHS_SHORT[m - 1]}</small><small>${y}</small></div>
      <div>
        <div class="when">${escapeHtml(r.restaurant_name)} · ${WEEKDAYS[new Date(y, m - 1, d).getDay()]}, ժամը ${r.time}${badge}</div>
        <div class="meta"><span class="tag"><em>Սեղան</em>${escapeHtml(r.table_code)}</span><span class="tag"><em>Գոտի</em>${AREAS[r.area] || ""}</span>` +
          `<span class="tag"><em>Հյուրեր</em>${guestsLabel(r.guests)}</span>` +
          (r.notes ? `<span class="tag"><em>Նշում</em>${escapeHtml(r.notes)}</span>` : "") + `</div>
      </div>
      ${canCancel ? `<button class="btn danger small" data-cancel="${r.id}">Չեղարկել</button>` : ""}
    </div>`;
}

async function cancelReservation(id) {
  if (!confirm("Իսկապե՞ս ցանկանում եք չեղարկել այս ամրագրումը։")) return;
  try {
    await api(`/api/reservations/${id}/cancel`, { method: "POST" });
    toast("Ամրագրումը չեղարկված է։");
    renderMine();
  } catch (ex) { toast(ex.message); }
}

/* ---------- Հատուկ առաջարկներ ---------- */
const OFFERS = [
  {
    key: "kids", label: "Ընտանիքի համար", value: "−50%", title: "Մանկական չափաբաժիններ",
    text: "Մինչև 12 տարեկան երեխաների համար՝ հատուկ մանկական ճաշացանկ կես գնով, իսկ աղանդերը՝ մեր կողմից նվեր։",
    note: "Մանկական չափաբաժին",
  },
  {
    key: "birthday", label: "Տոնական", value: "Նվեր", title: "Ծննդյան տորթ",
    text: "Նշում եք ծննդյան օրը մեզ մոտ՝ 6 և ավելի հյուրով։ Տոնական տորթը և մեկ շիշ փրփրուն գինի՝ նվեր։",
    note: "Ծննդյան օր",
  },
  {
    key: "lunch", label: "Երկ.–Ուրբ. 12:00–15:00", value: "4 900 ֏", title: "Բիզնես ճաշ",
    text: "Երեք ուտեստից բաղկացած ճաշ՝ ապուր, հիմնական ուտեստ և սուրճ, մատուցված 30 րոպեում։",
  },
  {
    key: "wine", label: "Ամեն օր 17:00–19:00", value: "−30%", title: "Գինու ժամ",
    text: "Հայկական ընտիր գինիներ բաժակով և շշով՝ 30% զեղչով, պանրի ափսեի հետ միասին։",
  },
];

const GIFT_AMOUNTS = ["10 000", "25 000", "50 000"];

function renderOffers() {
  document.querySelectorAll("[data-offers]").forEach((wrap) => {
    const inApp = !!wrap.closest(".inapp");
    wrap.innerHTML = `
      <article class="giftcard">
        <div class="gc-visual">
          <div class="gc-top"><span class="monogram">TB</span><span>Gift Card</span></div>
          <div class="gc-name">Նվեր քարտ</div>
          <div class="gc-bottom"><span>TableBook</span><span class="gc-chip"></span></div>
        </div>
        <div class="gc-body">
          <div class="ornament left">Լավագույն նվերը</div>
          <h3>Նվեր քարտեր</h3>
          <p>Նվիրեք անմոռանալի երեկո։ Քարտը գործում է 12 ամիս և կարող է օգտագործվել ամբողջ ճաշացանկի համար։</p>
          <div class="gc-amounts">
            ${GIFT_AMOUNTS.map((a, i) => `<button type="button" class="gc-amount${i === 1 ? " active" : ""}">${a} ֏</button>`).join("")}
          </div>
          <button type="button" class="btn ghost small" data-gift>Պատվիրել նվեր քարտ</button>
        </div>
      </article>
      ${OFFERS.map((o) => `
        <article class="offer">
          <span class="offer-label">${o.label}</span>
          <div class="offer-value gold-text">${o.value}</div>
          <h4>${o.title}</h4>
          <p>${o.text}</p>
          ${inApp && o.note ? `<button type="button" class="offer-link" data-note="${o.note}">Ավելացնել ամրագրմանը →</button>` : ""}
        </article>`).join("")}`;
  });

  document.querySelectorAll(".gc-amounts").forEach((group) => {
    group.addEventListener("click", (e) => {
      const btn = e.target.closest(".gc-amount");
      if (!btn) return;
      group.querySelectorAll(".gc-amount").forEach((b) => b.classList.toggle("active", b === btn));
    });
  });

  document.querySelectorAll("[data-gift]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const amount = btn.closest(".gc-body").querySelector(".gc-amount.active").textContent;
      toast(`Նվեր քարտ ${amount} – զանգահարեք +374 10 123 456 կամ այցելեք ռեստորան։`);
    });
  });

  document.querySelectorAll("[data-note]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const notes = $("#notes");
      if (!notes.value.includes(btn.dataset.note)) {
        notes.value = notes.value ? `${notes.value}, ${btn.dataset.note}` : btn.dataset.note;
      }
      notes.scrollIntoView({ behavior: "smooth", block: "center" });
      toast(`«${btn.dataset.note}» ավելացված է նշումներում։`);
    });
  });
}

/* ---------- Մեկնարկ ---------- */
async function start() {
  renderOffers();
  initSearchForm();
  try {
    const [{ user }, { restaurants }] = await Promise.all([api("/api/me"), api("/api/restaurants")]);
    state.user = user;
    state.restaurants = restaurants;
    fillRestaurants();
  } catch (ex) {
    toast("Սերվերի հետ կապ չկա։ Գործարկեք՝ node server.js");
  }
  render();
}

start();
