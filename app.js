"use strict";

/* =========================================================
   TableBook – սեղանի ամրագրում ռեստորանում
   Տվյալները պահվում են բրաուզերի localStorage-ում։
   ========================================================= */

const KEYS = { users: "tb_users", reservations: "tb_reservations", session: "tb_session" };

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

const TABLES = [
  { id: "W1", seats: 2, area: "window" },
  { id: "W2", seats: 2, area: "window" },
  { id: "W3", seats: 4, area: "window" },
  { id: "S1", seats: 2, area: "inside" },
  { id: "S2", seats: 4, area: "inside" },
  { id: "S3", seats: 4, area: "inside" },
  { id: "S4", seats: 6, area: "inside" },
  { id: "S5", seats: 8, area: "inside" },
  { id: "T1", seats: 2, area: "terrace" },
  { id: "T2", seats: 4, area: "terrace" },
  { id: "T3", seats: 4, area: "terrace" },
  { id: "T4", seats: 6, area: "terrace" },
];

const OPEN_MIN = 12 * 60;        // 12:00
const LAST_SLOT_MIN = 21 * 60 + 30; // 21:30
const SLOT_STEP = 30;
const DURATION = 120;            // մեկ ամրագրումը զբաղեցնում է սեղանը 2 ժամ
const MAX_GUESTS = 8;

const WEEKDAYS = ["Կիրակի", "Երկուշաբթի", "Երեքշաբթի", "Չորեքշաբթի", "Հինգշաբթի", "Ուրբաթ", "Շաբաթ"];
const MONTHS = ["հունվարի", "փետրվարի", "մարտի", "ապրիլի", "մայիսի", "հունիսի",
  "հուլիսի", "օգոստոսի", "սեպտեմբերի", "հոկտեմբերի", "նոյեմբերի", "դեկտեմբերի"];
const MONTHS_SHORT = ["հնվ", "փտվ", "մրտ", "ապր", "մյս", "հնս", "հլս", "օգս", "սեպ", "հոկ", "նոյ", "դեկ"];

/* ---------- Պահեստ ---------- */
const load = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));

const getUsers = () => load(KEYS.users, []);
const getReservations = () => load(KEYS.reservations, []);

/* ---------- Օգնականներ ---------- */
const $ = (sel) => document.querySelector(sel);
const pad = (n) => String(n).padStart(2, "0");
const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const toHHMM = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function formatDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${WEEKDAYS[date.getDay()]}, ${d} ${MONTHS[m - 1]} ${y}`;
}

function guestsLabel(n) {
  return `${n} անձ`;
}

async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(salt + ":" + password);
  if (window.crypto?.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Պահուստային տարբերակ, եթե WebCrypto-ն հասանելի չէ
  let h = 0x811c9dc5;
  for (const b of data) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return "fnv" + h.toString(16);
}

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove("show"), 2800);
}

/* ---------- Նստաշրջան ---------- */
function currentUser() {
  const id = load(KEYS.session, null);
  return getUsers().find((u) => u.id === id) || null;
}

async function seedDemoUser() {
  const users = getUsers();
  if (users.some((u) => u.email === "demo@tablebook.am")) return;
  const salt = uid();
  users.push({
    id: uid(), name: "Փորձնական Օգտատեր", email: "demo@tablebook.am", phone: "",
    salt, hash: await hashPassword("demo1234", salt), createdAt: new Date().toISOString(),
  });
  save(KEYS.users, users);
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

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const email = f.email.value.trim().toLowerCase();
  const password = f.password.value;
  const err = $("#loginError");

  if (!email || !password) { err.textContent = "Լրացրեք էլ. փոստը և գաղտնաբառը։"; return; }

  const user = getUsers().find((u) => u.email === email);
  if (!user || (await hashPassword(password, user.salt)) !== user.hash) {
    err.textContent = "Էլ. փոստը կամ գաղտնաբառը սխալ է։";
    return;
  }
  err.textContent = "";
  f.reset();
  save(KEYS.session, user.id);
  toast(`Բարի գալուստ, ${user.name}։`);
  render();
});

$("#registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const name = f.name.value.trim();
  const email = f.email.value.trim().toLowerCase();
  const phone = f.phone.value.trim();
  const err = $("#registerError");

  if (name.length < 2) { err.textContent = "Մուտքագրեք Ձեր անունը։"; return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = "Էլ. փոստի հասցեն անվավեր է։"; return; }
  if (f.password.value.length < 6) { err.textContent = "Գաղտնաբառը պետք է լինի առնվազն 6 նիշ։"; return; }
  if (f.password.value !== f.password2.value) { err.textContent = "Գաղտնաբառերը չեն համընկնում։"; return; }

  const users = getUsers();
  if (users.some((u) => u.email === email)) { err.textContent = "Այս էլ. փոստով հաշիվ արդեն կա։"; return; }

  const salt = uid();
  const user = {
    id: uid(), name, email, phone, salt,
    hash: await hashPassword(f.password.value, salt),
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  save(KEYS.users, users);
  save(KEYS.session, user.id);
  err.textContent = "";
  f.reset();
  toast("Հաշիվը ստեղծված է։ Բարի գալուստ։");
  render();
});

$("#logoutBtn").addEventListener("click", () => {
  localStorage.removeItem(KEYS.session);
  selectedTable = null;
  toast("Դուք դուրս եկաք համակարգից։");
  render();
});

/* ---------- Նավիգացիա ---------- */
let currentView = "book";

document.querySelectorAll(".navlink").forEach((btn) => {
  btn.addEventListener("click", () => { currentView = btn.dataset.view; render(); });
});

function render() {
  const user = currentUser();
  $("#authView").classList.toggle("hidden", !!user);
  $("#nav").classList.toggle("hidden", !user);
  $("#bookView").classList.toggle("hidden", !user || currentView !== "book");
  $("#mineView").classList.toggle("hidden", !user || currentView !== "mine");
  if (!user) return;

  $("#userName").textContent = user.name;
  $("#greeting").textContent = `Բարի գալուստ, ${user.name.split(" ")[0]}`;
  document.querySelectorAll(".navlink").forEach((b) => b.classList.toggle("active", b.dataset.view === currentView));

  if (currentView === "book") renderBooking();
  else renderMine();
}

/* ---------- Ամրագրում ---------- */
const searchForm = $("#searchForm");
let selectedTable = null;

function initSearchForm() {
  const today = isoDate(new Date());
  const max = new Date(); max.setDate(max.getDate() + 60);
  searchForm.date.min = today;
  searchForm.date.max = isoDate(max);
  searchForm.date.value = today;

  for (let g = 1; g <= MAX_GUESTS; g++) {
    searchForm.guests.add(new Option(guestsLabel(g), g, false, g === 2));
  }
  fillTimes();

  searchForm.addEventListener("change", (e) => {
    if (e.target.name === "date") fillTimes();
    selectedTable = null;
    renderBooking();
  });
}

function availableSlots(dateIso) {
  const slots = [];
  const now = new Date();
  const isToday = dateIso === isoDate(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (let m = OPEN_MIN; m <= LAST_SLOT_MIN; m += SLOT_STEP) {
    if (isToday && m <= nowMin + 30) continue; // առնվազն 30 րոպե առաջ
    slots.push(toHHMM(m));
  }
  return slots;
}

function fillTimes() {
  const sel = searchForm.time;
  const prev = sel.value;
  sel.innerHTML = "";
  const slots = availableSlots(searchForm.date.value);
  if (!slots.length) {
    sel.add(new Option("Այսօր ազատ ժամեր չկան", ""));
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  const def = slots.includes(prev) ? prev : (slots.includes("19:00") ? "19:00" : slots[0]);
  slots.forEach((s) => sel.add(new Option(s, s, false, s === def)));
}

function isTableBusy(tableId, date, time, ignoreId = null) {
  const start = toMin(time);
  return getReservations().some((r) =>
    r.status === "active" && r.id !== ignoreId && r.tableId === tableId && r.date === date &&
    Math.abs(toMin(r.time) - start) < DURATION);
}

function tableState(table, q) {
  if (!q.time) return "busy";
  if (isTableBusy(table.id, q.date, q.time)) return "busy";
  if (table.seats < q.guests || table.seats > q.guests + 3) return "small";
  if (q.area && table.area !== q.area) return "small";
  return "free";
}

function currentQuery() {
  return {
    date: searchForm.date.value,
    time: searchForm.time.value,
    guests: Number(searchForm.guests.value),
    area: searchForm.area.value,
  };
}

function renderBooking() {
  const q = currentQuery();
  const floor = $("#floor");
  floor.innerHTML = "";
  let freeCount = 0;

  for (const [areaKey, areaName] of Object.entries(AREAS)) {
    const zone = document.createElement("div");
    zone.className = "zone " + areaKey;
    zone.innerHTML = `<div class="zone-head" style="--img:url('${AREA_IMAGES[areaKey]}')">` +
      `<span class="zone-title">${areaName}</span><span class="zone-count"></span></div><div class="tables"></div>`;
    const wrap = zone.querySelector(".tables");
    let zoneFree = 0;

    TABLES.filter((t) => t.area === areaKey).forEach((t) => {
      const state = tableState(t, q);
      if (state === "free") { freeCount++; zoneFree++; }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `table s${t.seats} ${state}` + (selectedTable === t.id ? " selected" : "");
      btn.innerHTML = `${t.id}<small>${t.seats} տեղ</small>`;
      btn.title = state === "busy" ? "Այս ժամին զբաղված է"
        : state === "small" ? "Չի համապատասխանում ընտրված պարամետրերին" : "Ազատ է – սեղմեք ընտրելու համար";
      btn.disabled = state !== "free";
      btn.addEventListener("click", () => { selectedTable = t.id; renderBooking(); });
      wrap.appendChild(btn);
    });
    zone.querySelector(".zone-count").textContent = `${zoneFree} ազատ`;
    floor.appendChild(zone);
  }

  $("#planInfo").textContent = !q.time
    ? "Ընտրված օրվա համար ազատ ժամեր չկան։"
    : freeCount
      ? `${freeCount} հարմար սեղան ազատ է ${formatDate(q.date)}, ժամը ${q.time}-ին (${guestsLabel(q.guests)})։`
      : "Այս ժամին հարմար ազատ սեղան չկա։ Փորձեք այլ ժամ կամ գոտի։";

  const summary = $("#summary");
  const table = TABLES.find((t) => t.id === selectedTable);
  if (table && tableState(table, q) === "free") {
    summary.classList.remove("muted");
    summary.innerHTML = `Սեղան <strong>${table.id}</strong> (${AREAS[table.area]}, ${table.seats} տեղ) · ` +
      `<strong>${formatDate(q.date)}</strong>, ժամը <strong>${q.time}</strong> · ` +
      `<strong>${guestsLabel(q.guests)}</strong>`;
    $("#bookBtn").disabled = false;
  } else {
    selectedTable = null;
    summary.classList.add("muted");
    summary.textContent = "Խնդրում ենք ընտրել ազատ սեղան դասավորությունից։";
    $("#bookBtn").disabled = true;
  }
  $("#bookError").textContent = "";
}

$("#bookBtn").addEventListener("click", () => {
  const user = currentUser();
  const q = currentQuery();
  const table = TABLES.find((t) => t.id === selectedTable);
  if (!user || !table) return;

  if (tableState(table, q) !== "free") {
    $("#bookError").textContent = "Այս սեղանն արդեն զբաղված է։ Ընտրեք այլ սեղան։";
    renderBooking();
    return;
  }

  const reservations = getReservations();
  reservations.push({
    id: uid(), userId: user.id, tableId: table.id, area: table.area,
    date: q.date, time: q.time, guests: q.guests,
    notes: $("#notes").value.trim(), status: "active", createdAt: new Date().toISOString(),
  });
  save(KEYS.reservations, reservations);

  $("#notes").value = "";
  selectedTable = null;
  toast(`Ամրագրված է՝ սեղան ${table.id}, ${formatDate(q.date)}, ժամը ${q.time}`);
  currentView = "mine";
  render();
});

/* ---------- Իմ ամրագրումները ---------- */
function renderMine() {
  const user = currentUser();
  const now = new Date();
  const nowKey = `${isoDate(now)} ${toHHMM(now.getHours() * 60 + now.getMinutes())}`;

  const mine = getReservations()
    .filter((r) => r.userId === user.id)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  const upcoming = mine.filter((r) => r.status === "active" && `${r.date} ${r.time}` >= nowKey);
  const past = mine.filter((r) => !upcoming.includes(r)).reverse();

  $("#upcoming").innerHTML = upcoming.length
    ? upcoming.map((r) => resHtml(r, true)).join("")
    : `<p class="empty">Առաջիկա ամրագրումներ չունեք։ <a href="#" id="goBook">Ամրագրել սեղան →</a></p>`;
  $("#past").innerHTML = past.length
    ? past.map((r) => resHtml(r, false)).join("")
    : `<p class="empty">Դեռ ոչինչ չկա։</p>`;

  $("#goBook")?.addEventListener("click", (e) => { e.preventDefault(); currentView = "book"; render(); });
  document.querySelectorAll("[data-cancel]").forEach((btn) =>
    btn.addEventListener("click", () => cancelReservation(btn.dataset.cancel)));
}

function resHtml(r, canCancel) {
  const badge = r.status === "cancelled" ? `<span class="badge">չեղարկված</span>`
    : !canCancel ? `<span class="badge">անցած</span>` : "";
  const [y, m, d] = r.date.split("-").map(Number);
  const state = r.status === "cancelled" ? "cancelled" : !canCancel ? "past" : "";
  return `
    <div class="res ${r.area} ${state}">
      <div class="datebox"><b>${d}</b><small class="mon">${MONTHS_SHORT[m - 1]}</small><small>${y}</small></div>
      <div>
        <div class="when">${WEEKDAYS[new Date(y, m - 1, d).getDay()]}, ժամը ${r.time}${badge}</div>
        <div class="meta"><span class="tag"><em>Սեղան</em>${r.tableId}</span><span class="tag"><em>Գոտի</em>${AREAS[r.area]}</span>` +
          `<span class="tag"><em>Հյուրեր</em>${guestsLabel(r.guests)}</span>` +
          (r.notes ? `<span class="tag"><em>Նշում</em>${escapeHtml(r.notes)}</span>` : "") + `</div>
      </div>
      ${canCancel ? `<button class="btn danger small" data-cancel="${r.id}">Չեղարկել</button>` : ""}
    </div>`;
}

function cancelReservation(id) {
  if (!confirm("Իսկապե՞ս ցանկանում եք չեղարկել այս ամրագրումը։")) return;
  const reservations = getReservations();
  const r = reservations.find((x) => x.id === id && x.userId === currentUser()?.id);
  if (!r) return;
  r.status = "cancelled";
  save(KEYS.reservations, reservations);
  toast("Ամրագրումը չեղարկված է։");
  renderMine();
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
          <div class="gc-bottom"><span>Ռեստորան «Արարատ»</span><span class="gc-chip"></span></div>
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
renderOffers();
initSearchForm();
seedDemoUser().then(render);
