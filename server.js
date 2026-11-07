/* =========================================================
   TableBook սերվեր – միայն Node.js-ի ներկառուցված մոդուլներ
   Գործարկում՝  node server.js   →  http://localhost:3000
   ========================================================= */

import http from "node:http";
import crypto from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, "public");
const PRIVATE_DIR = path.join(ROOT, "private");
const DATA_DIR = path.join(ROOT, "data");
const PORT = Number(process.env.PORT) || 3000;

const SESSION_DAYS = 7;
const DURATION = 120;       // մեկ ամրագրումը զբաղեցնում է սեղանը 2 ժամ
const SLOT_STEP = 30;
const LAST_BOOKING_GAP = 90; // վերջին ամրագրումը փակվելուց 90 րոպե առաջ
const MAX_GUESTS = 12;
const AREAS = ["inside", "window", "terrace"];
const CATEGORIES = ["starter", "main", "dessert", "drink"];
const STATUSES = ["active", "done", "noshow", "cancelled"];

/* ---------- Տվյալների բազա ---------- */
mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, "tablebook.db"));

db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL DEFAULT '',
    salt TEXT NOT NULL,
    hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS restaurants (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    image TEXT NOT NULL DEFAULT '',
    open_time TEXT NOT NULL DEFAULT '12:00',
    close_time TEXT NOT NULL DEFAULT '23:00',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS dining_tables (
    id INTEGER PRIMARY KEY,
    restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    seats INTEGER NOT NULL,
    area TEXT NOT NULL,
    UNIQUE (restaurant_id, code)
  );

  CREATE TABLE IF NOT EXISTS dishes (
    id INTEGER PRIMARY KEY,
    restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price INTEGER NOT NULL,
    category TEXT NOT NULL DEFAULT 'main',
    image TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    table_id INTEGER NOT NULL REFERENCES dining_tables(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    guests INTEGER NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_res_lookup ON reservations (restaurant_id, date);
`);

const q = (sql) => db.prepare(sql);
const plain = (row) => (row ? { ...row } : row);
const all = (sql, ...args) => q(sql).all(...args).map(plain);
const get = (sql, ...args) => plain(q(sql).get(...args));
const run = (sql, ...args) => q(sql).run(...args);

/* ---------- Գաղտնաբառեր և նստաշրջաններ ---------- */
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}
function verifyPassword(password, user) {
  const a = Buffer.from(hashPassword(password, user.salt), "hex");
  const b = Buffer.from(user.hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function createUser({ name, email, phone = "", password, role = "user" }) {
  const salt = crypto.randomBytes(16).toString("hex");
  const info = run(
    "INSERT INTO users (name, email, phone, salt, hash, role) VALUES (?, ?, ?, ?, ?, ?)",
    name, email, phone, salt, hashPassword(password, salt), role,
  );
  return Number(info.lastInsertRowid);
}
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = Date.now() + SESSION_DAYS * 86400000;
  run("INSERT INTO sessions (token_hash, user_id, expires) VALUES (?, ?, ?)", sha256(token), userId, expires);
  res.setHeader("Set-Cookie",
    `tb_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}`);
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function currentUser(req) {
  const token = parseCookies(req).tb_session;
  if (!token) return null;
  const row = get(
    `SELECT u.id, u.name, u.email, u.phone, u.role, s.expires FROM sessions s
     JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, sha256(token));
  if (!row || row.expires < Date.now()) return null;
  delete row.expires;
  return row;
}

/* ---------- Օգնականներ ---------- */
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

function str(v, max, { required = false, label = "Դաշտը" } = {}) {
  const s = typeof v === "string" ? v.trim() : "";
  if (required && !s) fail(400, `${label} պարտադիր է։`);
  if (s.length > max) fail(400, `${label} չափազանց երկար է։`);
  return s;
}
function int(v, min, max, label) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) fail(400, `${label}՝ անվավեր արժեք։`);
  return n;
}
const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const isUrl = (s) => s === "" || /^https?:\/\/\S+$/i.test(s);
const pad = (n) => String(n).padStart(2, "0");
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const toHHMM = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

function slotsFor(r) {
  const out = [];
  for (let m = toMin(r.open_time); m <= toMin(r.close_time) - LAST_BOOKING_GAP; m += SLOT_STEP) out.push(toHHMM(m));
  return out;
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(json);
}

async function readJson(req) {
  if (!/application\/json/.test(req.headers["content-type"] || "")) fail(415, "Սպասվում է JSON։");
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 100_000) fail(413, "Հարցումը չափազանց մեծ է։");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { fail(400, "Անվավեր JSON։"); }
}

function requireUser(req) {
  const user = currentUser(req);
  if (!user) fail(401, "Խնդրում ենք մուտք գործել։");
  return user;
}
function requireAdmin(req) {
  const user = requireUser(req);
  if (user.role !== "admin") fail(403, "Մուտքը արգելված է։");
  return user;
}

function restaurantOr404(id) {
  const r = get("SELECT * FROM restaurants WHERE id = ?", Number(id));
  if (!r) fail(404, "Ռեստորանը չի գտնվել։");
  return r;
}

function restaurantInput(body) {
  const r = {
    name: str(body.name, 80, { required: true, label: "Անվանումը" }),
    description: str(body.description, 500, { label: "Նկարագրությունը" }),
    address: str(body.address, 160, { label: "Հասցեն" }),
    phone: str(body.phone, 40, { label: "Հեռախոսը" }),
    image: str(body.image, 500, { label: "Նկարի հղումը" }),
    open_time: str(body.open_time, 5) || "12:00",
    close_time: str(body.close_time, 5) || "23:00",
  };
  if (!isUrl(r.image)) fail(400, "Նկարի հղումը պետք է սկսվի http:// կամ https://։");
  if (!isTime(r.open_time) || !isTime(r.close_time)) fail(400, "Աշխատանքային ժամերը անվավեր են։");
  if (toMin(r.close_time) - toMin(r.open_time) < LAST_BOOKING_GAP + SLOT_STEP) fail(400, "Փակման ժամը պետք է լինի բացվելուց ուշ։");
  return r;
}

function dishInput(body) {
  const d = {
    name: str(body.name, 80, { required: true, label: "Ուտեստի անվանումը" }),
    description: str(body.description, 300, { label: "Նկարագրությունը" }),
    price: int(body.price, 0, 10_000_000, "Գինը"),
    category: CATEGORIES.includes(body.category) ? body.category : "main",
    image: str(body.image, 500, { label: "Նկարի հղումը" }),
  };
  if (!isUrl(d.image)) fail(400, "Նկարի հղումը պետք է սկսվի http:// կամ https://։");
  return d;
}

const DEFAULT_TABLES = [
  ["W1", 2, "window"], ["W2", 2, "window"], ["W3", 4, "window"],
  ["S1", 2, "inside"], ["S2", 4, "inside"], ["S3", 4, "inside"], ["S4", 6, "inside"], ["S5", 8, "inside"],
  ["T1", 2, "terrace"], ["T2", 4, "terrace"], ["T3", 4, "terrace"], ["T4", 6, "terrace"],
];
function addDefaultTables(restaurantId) {
  const stmt = q("INSERT INTO dining_tables (restaurant_id, code, seats, area) VALUES (?, ?, ?, ?)");
  for (const [code, seats, area] of DEFAULT_TABLES) stmt.run(restaurantId, code, seats, area);
}

/* ---------- API երթուղիներ ---------- */
const routes = [];
const route = (method, pattern, handler) =>
  routes.push({ method, re: new RegExp("^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$"), handler });

// Մուտք / գրանցում
route("POST", "/api/register", async (req, res) => {
  const body = await readJson(req);
  const name = str(body.name, 80, { required: true, label: "Անունը" });
  const email = str(body.email, 120, { required: true, label: "Էլ. փոստը" }).toLowerCase();
  const phone = str(body.phone, 40, { label: "Հեռախոսը" });
  const password = typeof body.password === "string" ? body.password : "";
  if (name.length < 2) fail(400, "Մուտքագրեք Ձեր անունը։");
  if (!isEmail(email)) fail(400, "Էլ. փոստի հասցեն անվավեր է։");
  if (password.length < 6 || password.length > 200) fail(400, "Գաղտնաբառը պետք է լինի առնվազն 6 նիշ։");
  if (get("SELECT id FROM users WHERE email = ?", email)) fail(409, "Այս էլ. փոստով հաշիվ արդեն կա։");
  const id = createUser({ name, email, phone, password });
  createSession(res, id);
  send(res, 201, { user: get("SELECT id, name, email, phone, role FROM users WHERE id = ?", id) });
});

route("POST", "/api/login", async (req, res) => {
  const body = await readJson(req);
  const email = str(body.email, 120).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  const user = get("SELECT * FROM users WHERE email = ?", email);
  // պատճենելիս հաճախ բացատ է ընկնում սկզբում կամ վերջում
  const ok = user && (verifyPassword(password, user) ||
    (password.trim() !== password && verifyPassword(password.trim(), user)));
  if (!ok) fail(401, "Էլ. փոստը կամ գաղտնաբառը սխալ է։");
  createSession(res, user.id);
  send(res, 200, { user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role } });
});

route("POST", "/api/logout", async (req, res) => {
  const token = parseCookies(req).tb_session;
  if (token) run("DELETE FROM sessions WHERE token_hash = ?", sha256(token));
  res.setHeader("Set-Cookie", "tb_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
  send(res, 200, { ok: true });
});

route("GET", "/api/me", async (req, res) => send(res, 200, { user: currentUser(req) }));

route("POST", "/api/me/password", async (req, res) => {
  const me = requireUser(req);
  const body = await readJson(req);
  const user = get("SELECT * FROM users WHERE id = ?", me.id);
  if (!verifyPassword(String(body.current || ""), user)) fail(400, "Ընթացիկ գաղտնաբառը սխալ է։");
  const next = String(body.next || "");
  if (next.length < 8 || next.length > 200) fail(400, "Նոր գաղտնաբառը պետք է լինի առնվազն 8 նիշ։");
  const salt = crypto.randomBytes(16).toString("hex");
  run("UPDATE users SET salt = ?, hash = ? WHERE id = ?", salt, hashPassword(next, salt), me.id);
  send(res, 200, { ok: true });
});

// Ռեստորաններ (հանրային)
route("GET", "/api/restaurants", async (req, res) => {
  send(res, 200, {
    restaurants: all(`SELECT r.*, (SELECT COUNT(*) FROM dining_tables t WHERE t.restaurant_id = r.id) AS table_count
                      FROM restaurants r ORDER BY r.id`),
  });
});

route("GET", "/api/restaurants/:id", async (req, res, p) => {
  const restaurant = restaurantOr404(p.id);
  send(res, 200, {
    restaurant,
    slots: slotsFor(restaurant),
    tables: all("SELECT id, code, seats, area FROM dining_tables WHERE restaurant_id = ? ORDER BY area, code", restaurant.id),
    dishes: all(`SELECT * FROM dishes WHERE restaurant_id = ? ORDER BY
                 CASE category WHEN 'starter' THEN 1 WHEN 'main' THEN 2 WHEN 'dessert' THEN 3 ELSE 4 END, id`, restaurant.id),
  });
});

route("GET", "/api/restaurants/:id/availability", async (req, res, p, url) => {
  const restaurant = restaurantOr404(p.id);
  const date = url.searchParams.get("date") || "";
  const time = url.searchParams.get("time") || "";
  if (!isDate(date) || !isTime(time)) fail(400, "Ամսաթիվը կամ ժամը անվավեր է։");
  const start = toMin(time);
  const busy = all("SELECT table_id, time FROM reservations WHERE restaurant_id = ? AND date = ? AND status = 'active'",
    restaurant.id, date)
    .filter((r) => Math.abs(toMin(r.time) - start) < DURATION)
    .map((r) => r.table_id);
  send(res, 200, { busy: [...new Set(busy)] });
});

// Ամրագրումներ (օգտատեր)
route("GET", "/api/reservations/mine", async (req, res) => {
  const user = requireUser(req);
  send(res, 200, {
    reservations: all(`SELECT r.*, t.code AS table_code, t.area, rs.name AS restaurant_name
                       FROM reservations r JOIN dining_tables t ON t.id = r.table_id
                       JOIN restaurants rs ON rs.id = r.restaurant_id
                       WHERE r.user_id = ? ORDER BY r.date, r.time`, user.id),
  });
});

route("POST", "/api/reservations", async (req, res) => {
  const user = requireUser(req);
  const body = await readJson(req);
  const restaurant = restaurantOr404(body.restaurantId);
  const table = get("SELECT * FROM dining_tables WHERE id = ? AND restaurant_id = ?", Number(body.tableId), restaurant.id);
  if (!table) fail(400, "Սեղանը չի գտնվել։");
  const date = String(body.date || "");
  const time = String(body.time || "");
  const guests = int(body.guests, 1, MAX_GUESTS, "Անձերի քանակը");
  const notes = str(body.notes, 300, { label: "Նշումները" });

  if (!isDate(date)) fail(400, "Ամսաթիվը անվավեր է։");
  const today = localDate();
  const maxDate = new Date(); maxDate.setDate(maxDate.getDate() + 60);
  if (date < today || date > localDate(maxDate)) fail(400, "Ամրագրումը հնարավոր է միայն առաջիկա 60 օրվա համար։");
  if (!slotsFor(restaurant).includes(time)) fail(400, "Ընտրված ժամը հասանելի չէ։");
  if (date === today && toMin(time) <= nowMinutes() + 30) fail(400, "Այս ժամն արդեն անցել է։");
  if (guests > table.seats) fail(400, "Սեղանը փոքր է այդքան հյուրի համար։");

  const busy = all("SELECT time FROM reservations WHERE table_id = ? AND date = ? AND status = 'active'", table.id, date)
    .some((r) => Math.abs(toMin(r.time) - toMin(time)) < DURATION);
  if (busy) fail(409, "Այս սեղանն արդեն զբաղված է։ Ընտրեք այլ սեղան։");

  const info = run(
    "INSERT INTO reservations (user_id, restaurant_id, table_id, date, time, guests, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
    user.id, restaurant.id, table.id, date, time, guests, notes);
  send(res, 201, { id: Number(info.lastInsertRowid) });
});

route("POST", "/api/reservations/:id/cancel", async (req, res, p) => {
  const user = requireUser(req);
  const r = get("SELECT * FROM reservations WHERE id = ? AND user_id = ?", Number(p.id), user.id);
  if (!r) fail(404, "Ամրագրումը չի գտնվել։");
  run("UPDATE reservations SET status = 'cancelled' WHERE id = ?", r.id);
  send(res, 200, { ok: true });
});

/* ---------- Ադմին API ---------- */
route("GET", "/api/admin/stats", async (req, res) => {
  requireAdmin(req);
  const today = localDate();
  send(res, 200, {
    today,
    todayReservations: get("SELECT COUNT(*) AS n FROM reservations WHERE date = ? AND status = 'active'", today).n,
    todayGuests: get("SELECT COALESCE(SUM(guests), 0) AS n FROM reservations WHERE date = ? AND status = 'active'", today).n,
    upcoming: get("SELECT COUNT(*) AS n FROM reservations WHERE date >= ? AND status = 'active'", today).n,
    users: get("SELECT COUNT(*) AS n FROM users").n,
    restaurants: get("SELECT COUNT(*) AS n FROM restaurants").n,
    dishes: get("SELECT COUNT(*) AS n FROM dishes").n,
  });
});

route("GET", "/api/admin/reservations", async (req, res, p, url) => {
  requireAdmin(req);
  const where = [];
  const args = [];
  const date = url.searchParams.get("date");
  const restaurant = url.searchParams.get("restaurant");
  const status = url.searchParams.get("status");
  const search = (url.searchParams.get("q") || "").trim();
  if (date && isDate(date)) { where.push("r.date = ?"); args.push(date); }
  if (restaurant) { where.push("r.restaurant_id = ?"); args.push(Number(restaurant)); }
  if (status && STATUSES.includes(status)) { where.push("r.status = ?"); args.push(status); }
  if (search) { where.push("(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)"); args.push(...Array(3).fill(`%${search}%`)); }
  send(res, 200, {
    reservations: all(`SELECT r.*, u.name AS user_name, u.email AS user_email, u.phone AS user_phone,
                       t.code AS table_code, t.area, rs.name AS restaurant_name
                       FROM reservations r JOIN users u ON u.id = r.user_id
                       JOIN dining_tables t ON t.id = r.table_id JOIN restaurants rs ON rs.id = r.restaurant_id
                       ${where.length ? "WHERE " + where.join(" AND ") : ""}
                       ORDER BY r.date DESC, r.time DESC LIMIT 500`, ...args),
  });
});

route("POST", "/api/admin/reservations/:id/status", async (req, res, p) => {
  requireAdmin(req);
  const body = await readJson(req);
  if (!STATUSES.includes(body.status)) fail(400, "Անվավեր կարգավիճակ։");
  const info = run("UPDATE reservations SET status = ? WHERE id = ?", body.status, Number(p.id));
  if (!info.changes) fail(404, "Ամրագրումը չի գտնվել։");
  send(res, 200, { ok: true });
});

route("GET", "/api/admin/users", async (req, res) => {
  requireAdmin(req);
  send(res, 200, {
    users: all(`SELECT u.id, u.name, u.email, u.phone, u.role, u.created_at,
                (SELECT COUNT(*) FROM reservations r WHERE r.user_id = u.id) AS reservation_count
                FROM users u ORDER BY u.id`),
  });
});

route("POST", "/api/admin/users/:id/role", async (req, res, p) => {
  const me = requireAdmin(req);
  const body = await readJson(req);
  if (!["user", "admin"].includes(body.role)) fail(400, "Անվավեր դեր։");
  if (Number(p.id) === me.id && body.role !== "admin") fail(400, "Դուք չեք կարող հանել Ձեր սեփական ադմինի դերը։");
  const info = run("UPDATE users SET role = ? WHERE id = ?", body.role, Number(p.id));
  if (!info.changes) fail(404, "Օգտատերը չի գտնվել։");
  send(res, 200, { ok: true });
});

route("POST", "/api/admin/restaurants", async (req, res) => {
  requireAdmin(req);
  const r = restaurantInput(await readJson(req));
  const info = run(
    "INSERT INTO restaurants (name, description, address, phone, image, open_time, close_time) VALUES (?, ?, ?, ?, ?, ?, ?)",
    r.name, r.description, r.address, r.phone, r.image, r.open_time, r.close_time);
  const id = Number(info.lastInsertRowid);
  addDefaultTables(id);
  send(res, 201, { id });
});

route("PUT", "/api/admin/restaurants/:id", async (req, res, p) => {
  requireAdmin(req);
  const existing = restaurantOr404(p.id);
  const r = restaurantInput(await readJson(req));
  run(`UPDATE restaurants SET name = ?, description = ?, address = ?, phone = ?, image = ?, open_time = ?, close_time = ?
       WHERE id = ?`, r.name, r.description, r.address, r.phone, r.image, r.open_time, r.close_time, existing.id);
  send(res, 200, { ok: true });
});

route("DELETE", "/api/admin/restaurants/:id", async (req, res, p) => {
  requireAdmin(req);
  const r = restaurantOr404(p.id);
  run("DELETE FROM restaurants WHERE id = ?", r.id);
  send(res, 200, { ok: true });
});

route("POST", "/api/admin/restaurants/:id/tables", async (req, res, p) => {
  requireAdmin(req);
  const r = restaurantOr404(p.id);
  const body = await readJson(req);
  const code = str(body.code, 10, { required: true, label: "Սեղանի կոդը" }).toUpperCase();
  const seats = int(body.seats, 1, MAX_GUESTS, "Տեղերի քանակը");
  if (!AREAS.includes(body.area)) fail(400, "Անվավեր գոտի։");
  if (get("SELECT id FROM dining_tables WHERE restaurant_id = ? AND code = ?", r.id, code)) fail(409, "Այդ կոդով սեղան արդեն կա։");
  const info = run("INSERT INTO dining_tables (restaurant_id, code, seats, area) VALUES (?, ?, ?, ?)", r.id, code, seats, body.area);
  send(res, 201, { id: Number(info.lastInsertRowid) });
});

route("DELETE", "/api/admin/tables/:id", async (req, res, p) => {
  requireAdmin(req);
  const t = get("SELECT * FROM dining_tables WHERE id = ?", Number(p.id));
  if (!t) fail(404, "Սեղանը չի գտնվել։");
  const upcoming = get("SELECT COUNT(*) AS n FROM reservations WHERE table_id = ? AND status = 'active' AND date >= ?",
    t.id, localDate()).n;
  if (upcoming) fail(409, `Այս սեղանն ունի ${upcoming} առաջիկա ամրագրում։ Նախ չեղարկեք դրանք։`);
  run("DELETE FROM dining_tables WHERE id = ?", t.id);
  send(res, 200, { ok: true });
});

route("POST", "/api/admin/restaurants/:id/dishes", async (req, res, p) => {
  requireAdmin(req);
  const r = restaurantOr404(p.id);
  const d = dishInput(await readJson(req));
  const info = run("INSERT INTO dishes (restaurant_id, name, description, price, category, image) VALUES (?, ?, ?, ?, ?, ?)",
    r.id, d.name, d.description, d.price, d.category, d.image);
  send(res, 201, { id: Number(info.lastInsertRowid) });
});

route("PUT", "/api/admin/dishes/:id", async (req, res, p) => {
  requireAdmin(req);
  const d = dishInput(await readJson(req));
  const info = run("UPDATE dishes SET name = ?, description = ?, price = ?, category = ?, image = ? WHERE id = ?",
    d.name, d.description, d.price, d.category, d.image, Number(p.id));
  if (!info.changes) fail(404, "Ուտեստը չի գտնվել։");
  send(res, 200, { ok: true });
});

route("DELETE", "/api/admin/dishes/:id", async (req, res, p) => {
  requireAdmin(req);
  const info = run("DELETE FROM dishes WHERE id = ?", Number(p.id));
  if (!info.changes) fail(404, "Ուտեստը չի գտնվել։");
  send(res, 200, { ok: true });
});

/* ---------- Ստատիկ ֆայլեր ---------- */
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".json": "application/json",
};

async function serveFile(res, file, status = 200) {
  try {
    const data = await readFile(file);
    res.writeHead(status, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 – Չի գտնվել");
  }
}

async function serveStatic(req, res, url) {
  // Ադմին վահանակը տրվում է միայն ադմիններին
  if (url.pathname === "/admin" || url.pathname === "/admin/" || url.pathname === "/admin.js") {
    const user = currentUser(req);
    if (!user || user.role !== "admin") {
      if (url.pathname === "/admin.js") { res.writeHead(403); return res.end(); }
      res.writeHead(302, { Location: "/?admin=1" });
      return res.end();
    }
    return serveFile(res, path.join(PRIVATE_DIR, url.pathname === "/admin.js" ? "admin.js" : "admin.html"));
  }

  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  return serveFile(res, file);
}

/* ---------- Սերվեր ---------- */
const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      for (const r of routes) {
        const m = r.method === req.method && url.pathname.match(r.re);
        if (m) return await r.handler(req, res, m.groups || {}, url);
      }
      return send(res, 404, { error: "Չի գտնվել։" });
    }
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
    await serveStatic(req, res, url);
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    console.error(err);
    send(res, 500, { error: "Սերվերի սխալ։" });
  }
});

/* ---------- Սկզբնական տվյալներ ---------- */
const newPassword = () => crypto.randomBytes(9).toString("base64url");

function writeAdminCredentials(email, password) {
  const file = path.join(DATA_DIR, "admin-credentials.txt");
  writeFileSync(file,
    `TableBook – ադմինի մուտքի տվյալներ\n\nԷլ. փոստ:  ${email}\nԳաղտնաբառ: ${password}\n\n` +
    `Պատճենեք գաղտնաբառը Ctrl+C-ով (ոչ թե Ctrl+X)։\n` +
    `Մուտք գործելուց հետո փոխեք գաղտնաբառը (Ադմին վահանակ → Կարգավորումներ) և ջնջեք այս ֆայլը։\n` +
    `Եթե գաղտնաբառը կորցնեք՝  npm run reset-admin\n`);
  return path.relative(ROOT, file);
}

// npm run reset-admin  →  նոր գաղտնաբառ ադմինի համար
function resetAdmin() {
  const email = (process.env.ADMIN_EMAIL || "admin@tablebook.am").toLowerCase();
  const password = process.env.ADMIN_PASSWORD || newPassword();
  const user = get("SELECT id FROM users WHERE email = ?", email);
  if (user) {
    const salt = crypto.randomBytes(16).toString("hex");
    run("UPDATE users SET salt = ?, hash = ?, role = 'admin' WHERE id = ?", salt, hashPassword(password, salt), user.id);
    run("DELETE FROM sessions WHERE user_id = ?", user.id);
  } else {
    createUser({ name: "Ադմինիստրատոր", email, password, role: "admin" });
  }
  if (process.env.ADMIN_PASSWORD) console.log(`\n  ${email} հաշվի գաղտնաբառը փոխված է։\n`);
  else console.log(`\n  ${email} հաշվի նոր գաղտնաբառը՝ ${writeAdminCredentials(email, password)} ֆայլում։\n`);
}

function seed() {
  run("DELETE FROM sessions WHERE expires < ?", Date.now());

  if (!get("SELECT id FROM users WHERE role = 'admin'")) {
    const email = (process.env.ADMIN_EMAIL || "admin@tablebook.am").toLowerCase();
    const password = process.env.ADMIN_PASSWORD || newPassword();
    const existing = get("SELECT id FROM users WHERE email = ?", email);
    if (existing) run("UPDATE users SET role = 'admin' WHERE id = ?", existing.id);
    else createUser({ name: "Ադմինիստրատոր", email, password, role: "admin" });
    if (!existing && !process.env.ADMIN_PASSWORD) {
      console.log(`\n  Ստեղծվեց ադմինի հաշիվ (${email}). Գաղտնաբառը՝ ${writeAdminCredentials(email, password)} ֆայլում։\n`);
    }
  }

  if (!get("SELECT id FROM users WHERE email = 'demo@tablebook.am'")) {
    createUser({ name: "Փորձնական Օգտատեր", email: "demo@tablebook.am", password: "demo1234" });
  }

  if (!get("SELECT id FROM restaurants LIMIT 1")) {
    const img = (id, w = 900, h = 600) => `https://images.unsplash.com/photo-${id}?w=${w}&h=${h}&fit=crop&q=75`;
    const info = run(
      "INSERT INTO restaurants (name, description, address, phone, image, open_time, close_time) VALUES (?, ?, ?, ?, ?, ?, ?)",
      "Արարատ", "Դասական հայկական խոհանոց, ընտիր գինիներ և անթերի սպասարկում՝ 1998 թվականից։",
      "Աբովյան 12, Երևան", "+374 10 123 456", img("1414235077428-338989a2e8c0", 1600, 900), "12:00", "23:00");
    const id = Number(info.lastInsertRowid);
    addDefaultTables(id);
    const dish = q("INSERT INTO dishes (restaurant_id, name, description, price, category, image) VALUES (?, ?, ?, ?, ?, ?)");
    dish.run(id, "Ամառային աղցան", "Թարմ բանջարեղեն, ընկույզ և նռան սոուս", 2800, "starter", img("1540189549336-e6e99c3679fe"));
    dish.run(id, "Խորոված կողիկներ", "Փայտածուխի վրա, տնական սոուսով", 6500, "main", img("1544025162-d76694265947"));
    dish.run(id, "Տավարի սթեյք", "Ընտիր տավարի միս, կարտոֆիլ ֆրի", 8900, "main", img("1529692236671-f1f6cf9683ba"));
    dish.run(id, "Սաղմոն գրիլ", "Սաղմոն բանջարեղենի հետ", 7200, "main", img("1467003909585-2f8a72700288"));
    dish.run(id, "Շոկոլադե տորթ", "Տնական շոկոլադե տորթ", 2400, "dessert", img("1578985545062-69928b1d9587"));
    dish.run(id, "Ծիրանի կոկտեյլ", "Հայկական ծիրան և անանուխ", 3000, "drink", img("1514362545857-3bc16c4c7d1b"));
  }
}

if (process.argv.includes("--reset-admin")) {
  resetAdmin();
  db.close();
} else {
  seed();
  server.listen(PORT, () => console.log(`  TableBook-ն աշխատում է՝ http://localhost:${PORT}`));
}
