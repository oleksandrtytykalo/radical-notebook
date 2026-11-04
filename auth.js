/* ---------- accounts: username + password via Supabase, one progress row per user ----------
   Talks to Supabase's REST endpoints directly (no SDK). The login is remembered in a cookie
   holding the refresh token, so every new tab or visit picks it up until you log out. */
const Cloud = {
  user: null, // { id, name }
  access: null,
  refresh: null,
  exp: 0,
  COOKIE: "rn-session",
  DOMAIN: "radical-notebook.app", // usernames become <name>@radical-notebook.app behind the scenes
  ready: () => !!(window.RN_CONFIG && RN_CONFIG.url && RN_CONFIG.key),
  base: () => RN_CONFIG.url.replace(/\/+$/, ""),
  emailFor(name) { name = name.trim().toLowerCase(); return name.includes("@") ? name : `${name}@${this.DOMAIN}`; },

  readCookie() {
    const m = document.cookie.match(new RegExp(`(?:^|; )${this.COOKIE}=([^;]*)`));
    if (!m) return null;
    try { return JSON.parse(decodeURIComponent(m[1])); } catch { return null; }
  },
  writeCookie() {
    const v = encodeURIComponent(JSON.stringify({ r: this.refresh, id: this.user.id, n: this.user.name }));
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${this.COOKIE}=${v}; Max-Age=31536000; Path=/; SameSite=Lax${secure}`;
  },
  clearCookie() { document.cookie = `${this.COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`; },

  // Picks up a login saved by an earlier visit (no network yet)
  restore() {
    if (!this.ready()) return false;
    const c = this.readCookie();
    if (!c || !c.r || !c.id) return false;
    this.refresh = c.r; this.user = { id: c.id, name: c.n || "" };
    return true;
  },
  async auth(grant, body, name) {
    let res;
    try {
      res = await fetch(`${this.base()}/auth/v1/token?grant_type=${grant}`, {
        method: "POST",
        headers: { apikey: RN_CONFIG.key, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch { throw Object.assign(new Error("Can't reach the server. Check your connection."), { offline: true }); }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const bad = /invalid/i.test(j.error_description || j.msg || j.error_code || "");
      throw Object.assign(new Error(bad ? "Wrong username or password." : j.error_description || j.msg || "Login failed."), { denied: res.status === 400 || res.status === 401 });
    }
    this.access = j.access_token; this.refresh = j.refresh_token;
    this.exp = Date.now() + ((j.expires_in || 3600) - 60) * 1000;
    this.user = { id: j.user.id, name: name || this.user?.name || j.user.email.split("@")[0] };
    this.writeCookie();
  },
  signIn(name, password) { return this.auth("password", { email: this.emailFor(name), password }, name.trim()); },
  async token(force = false) {
    if (!force && this.access && Date.now() < this.exp) return this.access;
    const c = this.readCookie(); // another tab may already have rotated the refresh token
    if (c && c.r && c.id === this.user?.id) this.refresh = c.r;
    await this.auth("refresh_token", { refresh_token: this.refresh });
    return this.access;
  },
  async rest(path, opts = {}, retry = true) {
    const t = await this.token();
    const res = await fetch(`${this.base()}/rest/v1/${path}`, {
      ...opts,
      headers: { apikey: RN_CONFIG.key, Authorization: `Bearer ${t}`, "Content-Type": "application/json", ...(opts.headers || {}) },
    });
    if (res.status === 401 && retry) { await this.token(true); return this.rest(path, opts, false); }
    if (!res.ok) throw new Error(`Sync failed (${res.status})`);
    return res;
  },
  async pull() {
    const rows = await (await this.rest(`progress?select=data&user_id=eq.${this.user.id}`)).json();
    return rows[0]?.data || null;
  },
  push(data, keepalive = false) {
    return this.rest("progress?on_conflict=user_id", {
      method: "POST",
      keepalive,
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ user_id: this.user.id, data, updated_at: new Date().toISOString() }),
    });
  },
  async signOut() {
    const t = this.access;
    this.clearCookie();
    this.user = this.access = this.refresh = null; this.exp = 0;
    if (t) fetch(`${this.base()}/auth/v1/logout`, { method: "POST", headers: { apikey: RN_CONFIG.key, Authorization: `Bearer ${t}` } }).catch(() => {});
  },
};
