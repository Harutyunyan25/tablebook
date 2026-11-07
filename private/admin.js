"use strict";

/* =========================================================
   TableBook – ադմին վահանակ
   Այս ֆայլը սերվերը տալիս է միայն ադմիններին։
   ========================================================= */

const AREAS = { inside: "Սրահ", window: "Պատուհանի մոտ", terrace: "Տեռաս" };
const CATEGORIES = { starter: "Նախուտեստ", main: "Հիմնական ուտեստ", dessert: "Աղանդեր", drink: "Ըմպելիք" };
const STATUSES = { active: "Ակտիվ", done: "Կայացած", noshow: "Չներկայացավ", cancelled: "Չեղարկված" };

const $ = (sel) => document.querySelector(sel);
const pad = (n) => String(n).padStart(2, "0");
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => `${Number(n).toLocaleString("en-US").replace(/,/g, " ")} ֏`;
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");
const formData = (form) => Object.fromEntries(new FormData(form).entries());

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove("show"), 3000);
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) { location.href = "/?admin=1"; throw new Error(data.error); }
  if (!res.ok) throw new Error(data.error || "Սխալ է տեղի ունեցել։");
  return data;
}

const state = { me: null, restaurants: [], editingRestaurant: null, tablesFor: null, editingDish: null };

/* ---------- Բաժիններ ---------- */
const LOADERS = {
  overview: loadOverview,
  reservations: loadReservations,
  restaurants: loadRestaurants,
  menu: loadDishes,
  users: loadUsers,
  settings: () => {},
};

function showSection(name) {
  document.querySelectorAll(".side button").forEach((b) => b.classList.toggle("active", b.dataset.section === name));
  document.querySelectorAll("[data-panel]").forEach((p) => p.classList.toggle("hidden", p.dataset.panel !== name));
  history.replaceState(null, "", `#${name}`);
  LOADERS[name]();
}
document.querySelectorAll(".side button").forEach((b) => b.addEventListener("click", () => showSection(b.dataset.section)));

async function refreshRestaurants() {
  ({ restaurants: state.restaurants } = await api("/api/restaurants"));
  document.querySelectorAll("[data-rest-select]").forEach((sel) => {
    const prev = sel.value;
    sel.innerHTML = (sel.dataset.restSelect === "all" ? `<option value="">Բոլորը</option>` : "") +
      state.restaurants.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join("");
    if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  });
}

/* ---------- Ամրագրումների աղյուսակ ---------- */
function reservationsTable(rows, { compact = false } = {}) {
  if (!rows.length) return `<p class="empty">Ամրագրումներ չկան։</p>`;
  return `
    <table class="tbl">
      <thead><tr>
        ${compact ? "" : "<th>Ամսաթիվ</th>"}<th>Ժամ</th><th>Հյուր</th><th>Ռեստորան / սեղան</th><th>Անձ</th><th>Նշում</th><th>Կարգավիճակ</th>
      </tr></thead>
      <tbody>
        ${rows.map((r) => `
          <tr>
            ${compact ? "" : `<td>${r.date}</td>`}
            <td><b>${r.time}</b></td>
            <td>${escapeHtml(r.user_name)}<small>${escapeHtml(r.user_phone || r.user_email)}</small></td>
            <td>${escapeHtml(r.restaurant_name)}<small>${escapeHtml(r.table_code)} · ${AREAS[r.area] || ""}</small></td>
            <td>${r.guests}</td>
            <td>${escapeHtml(r.notes) || "<small>—</small>"}</td>
            <td>
              <select data-status="${r.id}">
                ${Object.entries(STATUSES).map(([k, v]) => `<option value="${k}"${k === r.status ? " selected" : ""}>${v}</option>`).join("")}
              </select>
            </td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

function bindStatusSelects(root, reload) {
  root.querySelectorAll("[data-status]").forEach((sel) =>
    sel.addEventListener("change", async () => {
      try {
        await api(`/api/admin/reservations/${sel.dataset.status}/status`, { method: "POST", body: { status: sel.value } });
        toast(`Կարգավիճակը՝ «${STATUSES[sel.value]}»`);
        reload();
      } catch (ex) { toast(ex.message); }
    }));
}

/* ---------- Ամփոփում ---------- */
async function loadOverview() {
  const s = await api("/api/admin/stats");
  $("#todayTitle").textContent = `Ամփոփում · ${s.today}`;
  $("#stats").innerHTML = [
    ["Այսօրվա ամրագրումներ", s.todayReservations],
    ["Այսօրվա հյուրեր", s.todayGuests],
    ["Առաջիկա ամրագրումներ", s.upcoming],
    ["Ռեստորաններ", s.restaurants],
    ["Ուտեստներ", s.dishes],
    ["Օգտատերեր", s.users],
  ].map(([label, n]) => `<div class="stat"><span>${label}</span><b class="gold-text">${n}</b></div>`).join("");

  const { reservations } = await api(`/api/admin/reservations?date=${s.today}`);
  reservations.sort((a, b) => a.time.localeCompare(b.time));
  $("#todayList").innerHTML = reservationsTable(reservations, { compact: true });
  bindStatusSelects($("#todayList"), loadOverview);
}

/* ---------- Ամրագրումներ ---------- */
async function loadReservations() {
  const params = new URLSearchParams(Object.entries(formData($("#resFilters"))).filter(([, v]) => v));
  const { reservations } = await api(`/api/admin/reservations?${params}`);
  $("#resList").innerHTML = reservationsTable(reservations);
  bindStatusSelects($("#resList"), loadReservations);
}
let filterTimer;
$("#resFilters").addEventListener("input", () => { clearTimeout(filterTimer); filterTimer = setTimeout(loadReservations, 250); });
$("#resFilters").addEventListener("submit", (e) => e.preventDefault());

/* ---------- Ռեստորաններ ---------- */
async function loadRestaurants() {
  await refreshRestaurants();
  $("#restList").innerHTML = state.restaurants.length
    ? state.restaurants.map((r) => `
      <div class="list-item">
        <div class="li-main">
          ${safeUrl(r.image) ? `<img src="${escapeHtml(r.image)}" alt="">` : `<span class="thumb"></span>`}
          <div><b>${escapeHtml(r.name)}</b><small>${escapeHtml(r.address)} · ${r.open_time}–${r.close_time} · ${r.table_count} սեղան</small></div>
        </div>
        <div class="icon-btns">
          <button class="btn ghost small" data-tables="${r.id}">Սեղաններ</button>
          <button class="btn ghost small" data-edit-rest="${r.id}">Խմբագրել</button>
          <button class="btn danger small" data-del-rest="${r.id}">Ջնջել</button>
        </div>
      </div>`).join("")
    : `<p class="empty">Ռեստորաններ դեռ չկան։ Ավելացրեք առաջինը վերևում։</p>`;

  document.querySelectorAll("[data-edit-rest]").forEach((b) => b.addEventListener("click", () => editRestaurant(Number(b.dataset.editRest))));
  document.querySelectorAll("[data-del-rest]").forEach((b) => b.addEventListener("click", () => deleteRestaurant(Number(b.dataset.delRest))));
  document.querySelectorAll("[data-tables]").forEach((b) => b.addEventListener("click", () => openTables(Number(b.dataset.tables))));
  if (state.tablesFor) openTables(state.tablesFor, false);
}

function resetRestaurantForm() {
  state.editingRestaurant = null;
  $("#restForm").reset();
  $("#restFormTitle").textContent = "Նոր ռեստորան";
  $("#restSubmit").textContent = "Ավելացնել ռեստորան";
  $("#restFormCancel").classList.add("hidden");
  $("#restError").textContent = "";
}

function editRestaurant(id) {
  const r = state.restaurants.find((x) => x.id === id);
  if (!r) return;
  state.editingRestaurant = id;
  const f = $("#restForm");
  for (const k of ["name", "phone", "address", "description", "image", "open_time", "close_time"]) f[k].value = r[k] || "";
  $("#restFormTitle").textContent = `Խմբագրել՝ «${r.name}»`;
  $("#restSubmit").textContent = "Պահպանել փոփոխությունները";
  $("#restFormCancel").classList.remove("hidden");
  f.scrollIntoView({ behavior: "smooth", block: "center" });
}

$("#restFormCancel").addEventListener("click", resetRestaurantForm);

$("#restForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = formData(e.target);
  try {
    if (state.editingRestaurant) {
      await api(`/api/admin/restaurants/${state.editingRestaurant}`, { method: "PUT", body });
      toast("Ռեստորանը թարմացված է։");
    } else {
      await api("/api/admin/restaurants", { method: "POST", body });
      toast(`«${body.name}» ռեստորանն ավելացված է։`);
    }
    resetRestaurantForm();
    loadRestaurants();
  } catch (ex) { $("#restError").textContent = ex.message; }
});

async function deleteRestaurant(id) {
  const r = state.restaurants.find((x) => x.id === id);
  if (!r || !confirm(`Ջնջե՞լ «${r.name}» ռեստորանը։\n\nԿջնջվեն նաև նրա բոլոր սեղանները, ուտեստները և ամրագրումները։ Գործողությունը անդառնալի է։`)) return;
  try {
    await api(`/api/admin/restaurants/${id}`, { method: "DELETE" });
    if (state.tablesFor === id) { state.tablesFor = null; $("#tablesCard").classList.add("hidden"); }
    toast("Ռեստորանը ջնջված է։");
    loadRestaurants();
  } catch (ex) { toast(ex.message); }
}

/* ---------- Սեղաններ ---------- */
async function openTables(id, scroll = true) {
  state.tablesFor = id;
  const { restaurant, tables } = await api(`/api/restaurants/${id}`);
  $("#tablesCard").classList.remove("hidden");
  $("#tablesTitle").textContent = `Սեղաններ՝ «${restaurant.name}» (${tables.length})`;
  $("#tablesList").innerHTML = tables.length
    ? tables.map((t) => `<span class="tchip"><b>${escapeHtml(t.code)}</b><small>${t.seats} տեղ · ${AREAS[t.area]}</small>` +
        `<button title="Ջնջել" data-del-table="${t.id}">×</button></span>`).join("")
    : `<p class="empty">Սեղաններ չկան։</p>`;
  $("#tableError").textContent = "";
  document.querySelectorAll("[data-del-table]").forEach((b) => b.addEventListener("click", async () => {
    try {
      await api(`/api/admin/tables/${b.dataset.delTable}`, { method: "DELETE" });
      toast("Սեղանը ջնջված է։");
      loadRestaurants();
    } catch (ex) { $("#tableError").textContent = ex.message; }
  }));
  if (scroll) $("#tablesCard").scrollIntoView({ behavior: "smooth", block: "center" });
}

$("#tableForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.tablesFor) return;
  try {
    await api(`/api/admin/restaurants/${state.tablesFor}/tables`, { method: "POST", body: formData(e.target) });
    e.target.code.value = "";
    toast("Սեղանն ավելացված է։");
    loadRestaurants();
  } catch (ex) { $("#tableError").textContent = ex.message; }
});

/* ---------- Ճաշացանկ ---------- */
async function loadDishes() {
  await refreshRestaurants();
  const sel = $("#menuRest");
  if (!state.restaurants.length) {
    $("#dishList").innerHTML = `<p class="empty">Նախ ավելացրեք ռեստորան։</p>`;
    return;
  }
  const { restaurant, dishes } = await api(`/api/restaurants/${sel.value}`);
  state.dishes = dishes;
  $("#dishListTitle").textContent = `Ուտեստներ՝ «${restaurant.name}» (${dishes.length})`;
  $("#dishList").innerHTML = dishes.length
    ? dishes.map((d) => `
      <div class="list-item">
        <div class="li-main">
          ${safeUrl(d.image) ? `<img src="${escapeHtml(d.image)}" alt="">` : `<span class="thumb"></span>`}
          <div><b>${escapeHtml(d.name)}</b> <span class="gold-text">${money(d.price)}</span>
            <small>${CATEGORIES[d.category]}${d.description ? " · " + escapeHtml(d.description) : ""}</small></div>
        </div>
        <div class="icon-btns">
          <button class="btn ghost small" data-edit-dish="${d.id}">Խմբագրել</button>
          <button class="btn danger small" data-del-dish="${d.id}">Ջնջել</button>
        </div>
      </div>`).join("")
    : `<p class="empty">Այս ռեստորանի ճաշացանկը դատարկ է։</p>`;

  document.querySelectorAll("[data-edit-dish]").forEach((b) => b.addEventListener("click", () => editDish(Number(b.dataset.editDish))));
  document.querySelectorAll("[data-del-dish]").forEach((b) => b.addEventListener("click", () => deleteDish(Number(b.dataset.delDish))));
}

$("#menuRest").addEventListener("change", () => { resetDishForm(); loadDishes(); });

function resetDishForm() {
  state.editingDish = null;
  $("#dishForm").reset();
  $("#dishFormTitle").textContent = "Նոր ուտեստ";
  $("#dishSubmit").textContent = "Ավելացնել ուտեստ";
  $("#dishFormCancel").classList.add("hidden");
  $("#dishError").textContent = "";
}

function editDish(id) {
  const d = state.dishes.find((x) => x.id === id);
  if (!d) return;
  state.editingDish = id;
  const f = $("#dishForm");
  for (const k of ["name", "price", "category", "image", "description"]) f[k].value = d[k] ?? "";
  $("#dishFormTitle").textContent = `Խմբագրել՝ «${d.name}»`;
  $("#dishSubmit").textContent = "Պահպանել փոփոխությունները";
  $("#dishFormCancel").classList.remove("hidden");
  f.scrollIntoView({ behavior: "smooth", block: "center" });
}

$("#dishFormCancel").addEventListener("click", resetDishForm);

$("#dishForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = formData(e.target);
  body.price = Number(body.price);
  try {
    if (state.editingDish) {
      await api(`/api/admin/dishes/${state.editingDish}`, { method: "PUT", body });
      toast("Ուտեստը թարմացված է։");
    } else {
      await api(`/api/admin/restaurants/${$("#menuRest").value}/dishes`, { method: "POST", body });
      toast(`«${body.name}» ավելացված է ճաշացանկում։`);
    }
    resetDishForm();
    loadDishes();
  } catch (ex) { $("#dishError").textContent = ex.message; }
});

async function deleteDish(id) {
  const d = state.dishes.find((x) => x.id === id);
  if (!d || !confirm(`Ջնջե՞լ «${d.name}» ուտեստը։`)) return;
  try {
    await api(`/api/admin/dishes/${id}`, { method: "DELETE" });
    toast("Ուտեստը ջնջված է։");
    loadDishes();
  } catch (ex) { toast(ex.message); }
}

/* ---------- Օգտատերեր ---------- */
async function loadUsers() {
  const { users } = await api("/api/admin/users");
  $("#userList").innerHTML = `
    <table class="tbl">
      <thead><tr><th>Անուն</th><th>Էլ. փոստ</th><th>Հեռախոս</th><th>Ամրագրումներ</th><th>Գրանցվել է</th><th>Դեր</th></tr></thead>
      <tbody>
        ${users.map((u) => `
          <tr>
            <td>${escapeHtml(u.name)}</td>
            <td>${escapeHtml(u.email)}</td>
            <td>${escapeHtml(u.phone) || "<small>—</small>"}</td>
            <td>${u.reservation_count}</td>
            <td>${u.created_at.slice(0, 10)}</td>
            <td>${u.id === state.me.id
              ? `<span class="pill admin">Ադմին (Դուք)</span>`
              : `<select data-role="${u.id}">
                   <option value="user"${u.role === "user" ? " selected" : ""}>Օգտատեր</option>
                   <option value="admin"${u.role === "admin" ? " selected" : ""}>Ադմին</option>
                 </select>`}</td>
          </tr>`).join("")}
      </tbody>
    </table>`;

  document.querySelectorAll("[data-role]").forEach((sel) => sel.addEventListener("change", async () => {
    const label = sel.value === "admin" ? "ադմին" : "սովորական օգտատեր";
    if (!confirm(`Դարձնե՞լ այս օգտատիրոջը ${label}։`)) { loadUsers(); return; }
    try {
      await api(`/api/admin/users/${sel.dataset.role}/role`, { method: "POST", body: { role: sel.value } });
      toast("Դերը փոխված է։");
    } catch (ex) { toast(ex.message); }
    loadUsers();
  }));
}

/* ---------- Կարգավորումներ ---------- */
$("#pwForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const err = $("#pwError");
  if (f.next.value !== f.next2.value) { err.textContent = "Նոր գաղտնաբառերը չեն համընկնում։"; return; }
  try {
    await api("/api/me/password", { method: "POST", body: { current: f.current.value, next: f.next.value } });
    f.reset();
    err.textContent = "";
    toast("Գաղտնաբառը փոխված է։");
  } catch (ex) { err.textContent = ex.message; }
});

$("#logoutBtn").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  location.href = "/";
});

/* ---------- Մեկնարկ ---------- */
(async function start() {
  const { user } = await api("/api/me");
  if (!user || user.role !== "admin") { location.href = "/?admin=1"; return; }
  state.me = user;
  $("#userName").textContent = user.name;
  $("#resFilters").date.value = today();
  await refreshRestaurants();
  const initial = location.hash.slice(1);
  showSection(LOADERS[initial] ? initial : "overview");
})();
