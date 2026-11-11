/*
  sim-engine.js - Marvel Rivals fight simulator engine.

  Runs hero models (data/sim/*.js, schema in data/sim/README.md) through a
  fixed-step combat simulation: weapons, abilities, healing, bonus health,
  barriers, damage reduction, crowd control, team-up loadouts, ultimates.
  Every roll (hit, crit, area coverage, uptime) uses a seeded RNG, so one
  run is one plausible fight and many runs give the distribution.

  Performance level (0-100) per hero maps to concrete skill numbers in
  perfStats(); 100 = a robot: every shot lands, every crit, zero reaction.

  Public API (window.SIM):
    SIM.defs()                       -> list of loaded hero models
    SIM.perfStats(level, overrides)  -> {aim, crit, uptime, reaction, coverage}
    SIM.run(config, seed)            -> one fight (timeline, events, breakdowns)
    SIM.monteCarlo(config, n)        -> aggregate over n fights
    SIM.dpsCheck(config, targetIdx, window, opts) -> sustained DPS needed
*/
(function () {
  "use strict";
  window.SIM_DEFS = window.SIM_DEFS || [];
  window.SIM_DEF = window.SIM_DEF || function (d) { window.SIM_DEFS.push(d); };

  const DT = 0.05;
  const DEFAULTS = {
    maxTime: 12,        // seconds simulated after the first engage
    critMult: 2,        // headshot multiplier when a weapon doesn't say otherwise (assumption)
    reload: 1.5,        // reload seconds when a weapon doesn't say (assumption)
    clusterDef: 0.6,    // chance an area effect also catches each other defender (how stacked they are)
    clusterAtt: 0.45,   // same for attackers around their target
    barrierDive: 0.2,   // share of a diver's damage a barrier soaks (they walk around it)
    barrierPoke: 0.85,  // share of a poker's damage a barrier soaks
    shieldDelay: 3,     // regenerating shield: seconds without damage before it regenerates
    shieldRate: 40,     // ... and how fast (per second)
    allyDist: 5,        // distance between members of the same team
    castLock: 0.4,      // animation lock after an ability unless the model gives castTime
  };
  const MODE_DIST = { dive: 3, brawl: 10, poke: 25, long: 40 };
  const AIM_EXP = { hitscan: 1, projectile: 1.25, beam: 0.6, melee: 0.5, aoe: 0.4, auto: 0 };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const keyOf = d => d.variant ? `${d.name} (${d.variant})` : d.name;

  function defs() { return window.SIM_DEFS; }
  function findDef(key) { return window.SIM_DEFS.find(d => keyOf(d) === key); }

  /* ---------------- performance ---------------- */
  // x = level/100. aim: chance to land a plain hitscan shot on a normal-sized
  // enemy (60 -> 54%, 70 -> 64%, 100 -> 100%). Harder/easier weapon types bend
  // this curve (see hitChance). crit: share of landed crit-capable hits that
  // are headshots. uptime: share of time actually firing (peeking, repositioning,
  // dodging). reaction: delay before pressing an ability once it's the right
  // moment. coverage: how well area heals/damage catch the intended people.
  function perfStats(level, ov) {
    ov = ov || {};
    const x = clamp(level / 100, 0, 1);
    const pick = (k, v) => (ov[k] !== undefined && ov[k] !== null && ov[k] !== "") ? +ov[k] : v;
    return {
      aim: pick("aim", 0.9 * x + 0.1 * Math.pow(x, 8)),
      crit: pick("crit", Math.pow(x, 2.5)),
      uptime: pick("uptime", 0.55 + 0.45 * x),
      reaction: pick("reaction", 1.5 * (1 - x)),
      coverage: pick("coverage", 0.5 + 0.5 * x),
    };
  }
  function hitChance(ps, aim, friendly, dist, size) {
    let e = AIM_EXP[aim];
    if (e === undefined) e = 1;
    if (e === 0) return 1;
    if (aim === "projectile") e *= 1 + dist / 60;
    if (friendly) e *= 0.6;           // allies don't dodge you
    e /= size || 1;                   // big hitboxes are easier
    return Math.pow(clamp(ps.aim, 0, 1), e);
  }
  function falloffMult(fo, dist) {
    if (!fo) return 1;
    const [s, e, m] = fo;
    if (dist <= s) return 1;
    if (dist >= e) return m;
    return 1 - (1 - m) * (dist - s) / (e - s);
  }

  /* ---------------- rng ---------------- */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------------- units ---------------- */
  function chooseLoadout(def, slot, teamNames) {
    const tus = [...new Set(def.actions.filter(a => a.teamup).map(a => a.teamup))];
    if (slot.loadout === "none") return null;
    if (slot.loadout && slot.loadout !== "auto" && tus.includes(slot.loadout)) return slot.loadout;
    for (const tu of tus) {
      const a = def.actions.find(x => x.teamup === tu && x.enhanced);
      if (a && teamNames.includes(a.enhanced.partner)) return tu;
    }
    return tus[0] || null;
  }

  function buildActions(def, loadout, teamNames) {
    const out = [];
    for (const raw of def.actions) {
      if (raw.teamup && raw.teamup !== loadout) continue;
      let a = Object.assign({}, raw);
      a.isEnhanced = false;
      if (raw.enhanced && teamNames.includes(raw.enhanced.partner)) {
        const { partner, ...over } = raw.enhanced;
        a = Object.assign(a, over);
        a.isEnhanced = true;
      }
      a.pellets = a.pellets || 1;
      a.charges = a.charges || 1;
      out.push(a);
    }
    // a team-up that upgrades an existing ability replaces it while equipped
    const over = new Set(out.filter(a => a.teamup && a.overrides).map(a => a.overrides));
    return out.filter(a => !over.has(a.id) || a.teamup);
  }

  function makeUnit(slot, side, idx, cfg, teamNames) {
    const def = findDef(slot.hero);
    if (!def) throw new Error("No model for " + slot.hero);
    const loadout = chooseLoadout(def, slot, teamNames);
    const u = {
      side, idx, key: keyOf(def), name: def.name, def, slot,
      label: (side === "D" ? "D" : "A") + (idx + 1) + " " + keyOf(def),
      ps: perfStats(slot.perf == null ? 70 : slot.perf, slot.ov),
      maxHp: def.hp, hp: def.hp, shieldMax: def.shield || 0, shield: def.shield || 0, size: def.size || 1,
      loadout, actions: buildActions(def, loadout, teamNames),
      dist: side === "A" ? (slot.dist != null ? +slot.dist : MODE_DIST[slot.mode || "dive"]) : 0,
      mode: slot.mode || "dive",
      engageAt: side === "A" ? +(slot.delay || 0) : 0,
      focus: slot.focus == null ? "lowest" : slot.focus,
      ultReady: !!slot.ult,
      alive: true, deathT: null,
      bonuses: [], buffs: [], hots: [], dots: [], barriers: [],
      invulnUntil: -1, untargUntil: -1, ccUntil: -1, ccImmuneUntil: -1, regen: null, cheat: null,
      lastDmgT: -99, dmgLog: [],
      cds: {}, ammo: {}, reloadUntil: {}, nextFire: 0,
      channel: null, fields: [], pending: {}, ultUsed: false,
      target: null,
      st: { dmgDone: 0, healDone: 0, healSelf: 0, dmgTaken: 0, healTaken: 0, absorbed: 0, byAction: {}, casts: [] },
    };
    for (const a of u.actions) {
      u.cds[a.id] = { ready: 0, charges: a.charges };
      if (a.ammo) u.ammo[a.id] = a.ammo;
    }
    return u;
  }

  /* ---------------- fight ---------------- */
  function run(config, seed) {
    const S = Object.assign({}, DEFAULTS, config.settings || {});
    const R = rng(seed == null ? 1 : seed);
    const defNames = config.defenders.map(s => (findDef(s.hero) || {}).name);
    const attNames = config.attackers.map(s => (findDef(s.hero) || {}).name);
    const D = config.defenders.map((s, i) => makeUnit(s, "D", i, config, defNames));
    const A = config.attackers.map((s, i) => makeUnit(s, "A", i, config, attNames));
    if (config.dummy) A.push(makeDummy(config.dummy, A.length));
    const all = D.concat(A);
    const firstEngage = A.length ? Math.min(...A.map(u => u.engageAt)) : 0;
    for (const u of D) u.engageAt = firstEngage;
    // nobody lands a full volley on the first tick: aim/charge time before the
    // first shot (half the slowest weapon cycle, max 0.6 s, plus up to 0.3 s for lower skill)
    for (const u of all) {
      const cyc = Math.max(0, ...u.actions.filter(a => a.kind === "weapon").map(a => Math.min(a.cycle || 0, 1.2)));
      u.nextFire = u.engageAt + Math.min(0.6, cyc / 2) + 0.3 * (1 - clamp(u.ps.aim, 0, 1));
    }
    const T_END = firstEngage + S.maxTime;
    const events = [];
    const timeline = [];
    const queue = []; // delayed effects
    let t = 0;

    const allies = u => (u.side === "D" ? D : A).filter(x => x.alive);
    const enemies = u => (u.side === "D" ? A : D).filter(x => x.alive);
    const engaged = u => t >= u.engageAt;
    const distTo = (u, v) => u.side === v.side ? S.allyDist : (u.side === "A" ? u.dist : v.dist);
    const targetable = v => v.alive && t >= v.untargUntil && (v.side === "D" || t >= v.engageAt);
    const hpFrac = u => u.hp / u.maxHp;
    const sumBuff = (u, type) => { let s = 0; for (const b of u.buffs) if (b.t === type) s += b.pct; return s; };
    const log = (u, text, kind) => events.push({ t: +(t - firstEngage).toFixed(2), who: u ? u.label : "", side: u ? u.side : "", text, kind: kind || "info" });
    const bump = (u, id, field, v) => { const r = u.st.byAction[id] || (u.st.byAction[id] = { dmg: 0, heal: 0, hits: 0, shots: 0 }); r[field] += v; };

    /* ----- damage / healing ----- */
    function rawDamage(v, amt) {
      if (amt <= 0 || !v.alive) return 0;
      let left = amt;
      v.bonuses.sort((a, b) => a.exp - b.exp);
      for (const b of v.bonuses) { const k = Math.min(b.amt, left); b.amt -= k; left -= k; if (left <= 0) break; }
      v.bonuses = v.bonuses.filter(b => b.amt > 0.01);
      if (left > 0 && v.shield > 0) { const k = Math.min(v.shield, left); v.shield -= k; left -= k; }
      const took = Math.min(v.hp, left);
      v.hp -= left;
      v.lastDmgT = t;
      if (v.hp <= 0 && v.cheat && t < v.cheat.exp) {   // "survive fatal damage" effects
        const c = v.cheat; v.cheat = null;
        v.hp = Math.max(1, c.hp || 1);
        if (c.bonus) v.bonuses.push({ amt: c.bonus, exp: t + (c.bonusDur || 5) });
        if (c.invuln) v.invulnUntil = Math.max(v.invulnUntil, t + c.invuln);
        log(v, "survived fatal damage", "heal");
        return amt;
      }
      if (v.hp <= 0) { v.hp = 0; die(v); }
      return amt - Math.max(0, left - took);
    }
    function die(v) {
      if (!v.alive) return;
      v.alive = false; v.deathT = t; v.channel = null; v.fields = [];
      log(v, "eliminated", "death");
    }
    function dealDamage(src, v, amt, actionId) {
      if (!v.alive || amt <= 0) return 0;
      if (t < v.invulnUntil) { v.st.absorbed += amt; return 0; }
      let mult = (1 + sumBuff(src, "dmgBoost") / 100) * (1 + sumBuff(v, "vuln") / 100) * (1 - clamp(sumBuff(src, "weaken"), 0, 95) / 100);
      for (const b of v.buffs) if (b.t === "dr") mult *= 1 - clamp(b.pct, 0, 95) / 100;
      let a = amt * mult;
      // deployable barriers protecting v soak part of it
      for (const br of v.barriers) {
        if (br.hp <= 0 || t > br.exp) continue;
        const share = src.side === "A" ? (src.mode === "dive" ? S.barrierDive : (src.mode === "brawl" ? 0.5 : S.barrierPoke)) : 0.5;
        const k = Math.min(br.hp, a * share);
        br.hp -= k; a -= k; v.st.absorbed += k;
        if (br.hp <= 0) log(br.owner, "barrier broken", "info");
      }
      // soul-bond style damage sharing
      const sh = v.buffs.find(b => b.t === "share" && b.group);
      let dealt = 0;
      if (sh) {
        const grp = sh.group.filter(x => x.alive);
        const spread = a * sh.pct / 100;
        dealt += rawDamage(v, a - spread + spread / grp.length);
        for (const g of grp) if (g !== v) dealt += rawDamage(g, spread / grp.length);
      } else dealt = rawDamage(v, a);
      v.dmgLog.push([t, a]);
      src.st.dmgDone += dealt; v.st.dmgTaken += dealt; bump(src, actionId, "dmg", dealt);
      const ls = sumBuff(src, "lifesteal");
      if (ls > 0 && src.alive) doHeal(src, src, dealt * ls / 100, { label: "lifesteal", noEcho: true });
      return dealt;
    }
    function doHeal(src, v, amt, o) {
      o = o || {};
      if (!v.alive || amt <= 0) return 0;
      const anti = clamp(sumBuff(v, "antiHeal") / 100, 0, 1);
      const a = amt * (1 + sumBuff(src, "healBoostDealt") / 100 + sumBuff(v, "healBoost") / 100) * (1 - anti);
      const eff = Math.min(a, v.maxHp - v.hp);
      v.hp += eff;
      if (o.overflow === "bonus" && a > eff) v.bonuses.push({ amt: Math.min(a - eff, o.overflowMax || Infinity), exp: t + 5 });
      src.st.healDone += eff; if (src === v) src.st.healSelf += eff; v.st.healTaken += eff;
      bump(src, o.action || o.label || "heal", "heal", eff);
      if (!o.noEcho && v !== src) {
        for (const b of src.buffs) if (b.t === "echo" && b.unit && b.unit !== v && b.unit.alive) doHeal(src, b.unit, amt * b.pct / 100, { label: "echo", action: "echo", noEcho: true });
      }
      return eff;
    }

    /* ----- targets ----- */
    function lowestAlly(u, includeSelf, needHeal) {
      let best = null, bv = 2;
      for (const x of allies(u)) {
        if (!includeSelf && x === u) continue;
        if (needHeal && x.hp >= x.maxHp - 0.5) continue;
        const f = hpFrac(x);
        if (f < bv) { bv = f; best = x; }
      }
      return best;
    }
    function pickEnemy(u) {
      const es = enemies(u).filter(targetable);
      if (!es.length) return null;
      if (u.side === "A") {
        if (u.focus !== "lowest") { const f = D[+u.focus]; if (f && targetable(f)) return f; }
        return es.reduce((a, b) => (hpFrac(b) < hpFrac(a) ? b : a));
      }
      // defenders shoot whoever is hurting the team most, else the closest
      let best = null, bv = -1;
      for (const e of es) {
        const dmgRecent = e.st.dmgDone; // cumulative pressure
        const score = dmgRecent / 100 + (1 - hpFrac(e)) * 2 - e.dist / 30;
        if (score > bv) { bv = score; best = e; }
      }
      return best;
    }
    function recipients(u, eff, ctx) {
      const to = eff.to || (ctx.target ? "target" : "self");
      const cl = u.side === "D" ? S.clusterDef : S.clusterAtt;
      const out = [];
      if (to === "self") out.push([u, 1]);
      else if (to === "ally") { const x = lowestAlly(u, false, false) || null; if (x) out.push([x, 1]); }
      else if (to === "allyOrSelf") { const x = lowestAlly(u, true, false); if (x) out.push([x, 1]); }
      else if (to === "allies" || to === "others") {
        // big fields (>= 12 m) reach everyone a decent player keeps close; small ones depend on how stacked the team is
        const r = ctx.a && ctx.a.range != null ? ctx.a.range : 8;
        const reach = r >= 12 ? 1 : cl + (1 - cl) * r / 12;
        for (const x of allies(u)) { if (x === u) { if (to === "allies") out.push([u, 1]); } else out.push([x, reach * u.ps.coverage]); }
      } else if (to === "target") { if (ctx.target && ctx.target.alive) out.push([ctx.target, 1]); }
      else if (to === "enemies") {
        const main = ctx.target && ctx.target.alive ? ctx.target : u.target;
        const ecl = u.side === "A" ? S.clusterDef : S.clusterAtt;
        for (const x of enemies(u)) out.push([x, x === main ? 1 : ecl * u.ps.coverage]);
      } else if (to === "attackers") {
        for (const x of enemies(u)) if (x.target === u) out.push([x, 1]);
      }
      return out;
    }
    const AMOUNT_EFFECTS = { dmg: 1, heal: 1 };
    function applyEffect(u, eff, ctx, scale) {
      scale = scale == null ? 1 : scale;
      const recs = recipients(u, eff, ctx);
      if (eff.t === "share") { // one linked group, not one link per member
        const grp = recs.filter(([v, w]) => w >= 1 || R() < w).map(r => r[0]);
        const exp = eff.dur != null ? t + eff.dur : Infinity;
        for (const g of grp) g.buffs.push({ t: "share", pct: eff.pct, exp, group: grp });
        return;
      }
      if (eff.delay) { // e.g. a meteor that lands a few seconds after the cast
        const { delay, ...rest } = eff;
        queue.push({ at: t + delay, u, eff: rest, ctx: Object.assign({}, ctx), scale });
        return;
      }
      for (const [v, w] of recs) {
        if (AMOUNT_EFFECTS[eff.t] && ctx.tick) { applyOne(u, v, eff, ctx, scale * w); continue; }
        if (w < 1 && R() > w) continue;
        applyOne(u, v, eff, ctx, scale);
      }
    }
    function applyOne(u, v, e, ctx, scale) {
      const exp = e.dur != null ? t + e.dur : Infinity;
      if (ctx.tick) { // inside a field's per-second tick: over-time effects become continuous flow
        if (e.t === "hot") { doHeal(u, v, e.hps * scale, { action: ctx.action, noEcho: true }); return; }
        if (e.t === "dot") { dealDamage(u, v, e.dps * scale, ctx.action || "dot"); return; }
        if (e.t === "cdr") { for (const a of u.actions) if (!a.ult && (e.action === "all" || e.action === a.id)) { const c = u.cds[a.id]; c.ready = Math.max(t, c.ready - e.sec * scale); } return; }
        if (e.t === "cc" && t < v.ccUntil) return; // keep cc refreshed without spamming the log
      }
      switch (e.t) {
        case "dmg": dealDamage(u, v, (e.amt + v.maxHp * (e.pctMaxHp || 0) / 100 + (v.maxHp - v.hp) * (e.pctMissingHp || 0) / 100) * scale, ctx.action || "effect"); break;
        case "heal": doHeal(u, v, (e.amt + v.maxHp * (e.pctMaxHp || 0) / 100) * scale, { overflow: e.overflow, overflowMax: e.overflowMax, action: ctx.action }); break;
        case "hot": v.hots.push({ hps: e.hps, exp, src: u, action: ctx.action }); break;
        case "dot": v.dots.push({ dps: e.dps, exp, src: u, action: ctx.action }); break;
        case "bonus": v.bonuses.push({ amt: (e.amt + (v.maxHp - v.hp) * (e.missingPct || 0) / 100) * scale, exp }); break;
        case "ccImmune": v.ccImmuneUntil = Math.max(v.ccImmuneUntil, exp); break;
        case "cheatDeath": v.cheat = { hp: e.hp, bonus: e.bonus, bonusDur: e.bonusDur, invuln: e.invuln, exp }; break;
        case "barrier": { const br = { hp: e.hp, exp, owner: u }; v.barriers.push(br); break; }
        case "invuln": v.invulnUntil = Math.max(v.invulnUntil, exp); break;
        case "untargetable": v.untargUntil = Math.max(v.untargUntil, exp); break;
        case "cc":
          if (t < v.invulnUntil || t < v.ccImmuneUntil) break;
          if (e.kind === "root") { // immobilised: can still shoot, but no dashes / melee lunges
            v.rootUntil = Math.max(v.rootUntil || 0, exp);
            log(v, `rooted ${e.dur}s (by ${u.label})`, "cc");
            break;
          }
          v.ccUntil = Math.max(v.ccUntil, exp);
          if (v.channel && !v.channel.a.ult) v.channel = null;
          log(v, `${e.kind} ${e.dur}s (by ${u.label})`, "cc");
          break;
        case "echo": u.buffs.push({ t: "echo", pct: e.pct, exp, unit: v }); break;
        case "regen": v.regen = { hps: e.hps, delay: e.delay }; break;
        case "cdr":
          for (const a of u.actions) if (!a.ult && (e.action === "all" || e.action === a.id)) { const c = u.cds[a.id]; c.ready = Math.max(t, c.ready - e.sec); }
          break;
        case "cleanse":
          v.ccUntil = Math.min(v.ccUntil, t); v.dots = []; v.buffs = v.buffs.filter(b => b.t !== "antiHeal" && b.t !== "vuln");
          break;
        case "revive":
          for (const x of (u.side === "D" ? D : A)) if (!x.alive && x.deathT != null && t - x.deathT < 8) {
            x.alive = true; x.hp = x.maxHp * e.hpPct / 100; x.deathT = null;
            if (e.bonusPct) x.bonuses.push({ amt: x.maxHp * e.bonusPct / 100, exp: e.dur != null ? t + e.dur : t + 5 });
            log(x, "revived", "heal");
          }
          break;
        case "slow": break;
        default: // dr, healBoost, healBoostDealt, dmgBoost, vuln, antiHeal, lifesteal, weaken, blind
          v.buffs.push({ t: e.t, pct: e.pct, exp });
      }
    }

    /* ----- conditions ----- */
    function recentDmg(u) { let s = 0; for (const [tt, a] of u.dmgLog) if (t - tt <= 1) s += a; return s; }
    function cond(u, a) {
      const c = a.use || "never";
      for (const part of c.split("|")) {
        const m = /^(\w+)(?:<([\d.]+))?$/.exec(part.trim());
        if (!m) continue;
        const k = m[1], x = m[2] != null ? +m[2] : null;
        if (k === "always" || k === "cd") return true;
        if (k === "allyHp" && allies(u).some(v => hpFrac(v) < x)) return true;
        if (k === "othersHp" && allies(u).some(v => v !== u && hpFrac(v) < x)) return true;
        if (k === "selfHp" && hpFrac(u) < x) return true;
        if (k === "teamHp") { const al = allies(u); if (al.length && al.reduce((s, v) => s + hpFrac(v), 0) / al.length < x) return true; }
        if (k === "enemyNear" && enemies(u).some(v => targetable(v) && distTo(u, v) <= 8)) return true;
        if (k === "underFire" && recentDmg(u) >= 60) return true;
        if (k === "engage" && t <= u.engageAt + 0.5 + u.ps.reaction) return true;
        if (k === "targetHp" && u.target && u.target.alive && hpFrac(u.target) < x) return true;
      }
      return false;
    }

    /* ----- firing ----- */
    function fireVolley(u, a, v, healing, count) {
      const d = distTo(u, v);
      let landed = 0;
      const blind = clamp(sumBuff(u, "blind"), 0, 100);
      const ps = blind ? Object.assign({}, u.ps, { aim: u.ps.aim * (1 - blind / 100) }) : u.ps;
      const n = count == null ? a.pellets : count;
      for (let p = 0; p < n; p++) {
        if (a.ammo) {
          if ((u.ammo[a.id] || 0) <= 0) break;
          u.ammo[a.id] -= 1;
        }
        bump(u, a.id, "shots", 1);
        if (R() > hitChance(ps, a.aim, healing, d, healing ? 1 : v.size)) continue;
        landed++; bump(u, a.id, "hits", 1);
        hitWith(u, a, v, healing, d, true);
        if (a.targets === "all") {
          const pool = healing ? allies(u) : enemies(u).filter(targetable);
          const cl = (u.side === "D") === healing ? S.clusterDef : S.clusterAtt;
          for (const o of pool) if (o !== v && R() < cl * u.ps.coverage) hitWith(u, a, o, healing, d, false);
        }
      }
      if (a.ammo && u.ammo[a.id] <= 0) u.reloadUntil[a.id] = t + a.cycle + (a.reload != null ? a.reload : S.reload);
      return landed;
    }
    function hitWith(u, a, v, healing, d, primary) {
      if (healing) {
        if (a.heal) doHeal(u, v, a.heal * (a.healFalloff ? falloffMult(a.falloff, d) : 1), { action: a.id });
      } else if (a.dmg || a.pctMaxHp) {
        let amt = (a.dmg || 0) * falloffMult(a.falloff, d) + v.maxHp * (a.pctMaxHp || 0) / 100;
        if (a.crit && R() < u.ps.crit) amt *= a.critMult || S.critMult;
        dealDamage(u, v, amt, a.id);
      }
      if (a.onHit) for (const e of a.onHit) {
        const isDefensive = e.to === "self" || e.to === "allies" || e.to === "allyOrSelf";
        if (!healing || isDefensive || e.t === "heal" || e.t === "hot" || e.t === "bonus") applyEffect(u, e, { target: v, action: a.id, a });
      }
    }
    function healTargetFor(u, a, dist) {
      if (!a.heal) return null;
      const x = lowestAlly(u, !!a.healSelf, true);
      if (!x) return null;
      if (x !== u && (a.range || 99) < S.allyDist) return null;
      return x;
    }
    function inRange(u, a, v) { return v && distTo(u, v) <= (a.range != null ? a.range : 99) + 0.01; }

    function tryCast(u) {
      if (t < (u.castLockUntil || 0)) return false;
      for (const a of u.actions) {
        if (a.kind === "weapon") continue;
        if (a.ult && (!u.ultReady || u.ultUsed)) continue;
        if (a.aim === "melee" && a.kind === "cast" && t < (u.rootUntil || 0)) continue; // rooted: no dashes
        const c = u.cds[a.id];
        if (t < c.ready || c.charges <= 0) { delete u.pending[a.id]; continue; }
        if (u.channel && u.channel.a === a) continue;
        if (u.fields.some(f => f.a === a)) continue;
        if (!cond(u, a)) { delete u.pending[a.id]; continue; }
        const shootsEnemy = !!a.dmg || (a.onHit && a.onHit.some(e => e.t === "cc" || e.to === "target"));
        const healsOnly = !!a.heal && !a.dmg;
        let tgt = null, healing = false;
        if (healsOnly || (a.heal && lowestAlly(u, !!a.healSelf, true) && (!u.target || hpFrac(lowestAlly(u, !!a.healSelf, true)) < 0.9))) {
          tgt = lowestAlly(u, !!a.healSelf, true); healing = !!tgt;
        }
        if (!tgt && shootsEnemy) { tgt = u.target; if (!tgt || !inRange(u, a, tgt)) { continue; } }
        if (!tgt && healsOnly) continue;
        if (u.pending[a.id] == null) u.pending[a.id] = t;
        const wait = a.use && a.use.includes("engage") && t <= u.engageAt + 0.5 ? u.ps.reaction * 0.3 : u.ps.reaction;
        if (t - u.pending[a.id] < wait) continue;
        delete u.pending[a.id];
        cast(u, a, tgt, healing);
        return true; // one ability per tick
      }
      return false;
    }
    function cast(u, a, tgt, healing) {
      const c = u.cds[a.id];
      c.charges -= 1;
      if (a.ult) u.ultUsed = true;
      // animation lock: no other ability, and no weapon fire, until it finishes.
      // Multi-hit casts (combos, barrages) take ~0.08 s per hit by default.
      const lock = a.castTime != null ? a.castTime : Math.max(S.castLock, a.kind === "cast" ? Math.min(1.2, (a.pellets || 1) * 0.08) : 0);
      u.castLockUntil = t + lock;
      if (a.kind !== "channel") u.nextFire = Math.max(u.nextFire, t + lock);
      u.st.casts.push({ t: +(t - firstEngage).toFixed(2), id: a.id, name: a.name, ult: !!a.ult, teamup: a.teamup || null });
      log(u, `${a.ult ? "ULT " : ""}${a.name}${a.isEnhanced ? " (enhanced)" : ""}${tgt && tgt !== u ? " → " + tgt.label : ""}`, a.ult ? "ult" : (u.side === "A" ? "att" : "def"));
      const ctx = { target: tgt || u.target, action: a.id, a };
      if (a.onCast) for (const e of a.onCast) applyEffect(u, e, ctx);
      if (a.kind === "cast") {
        if ((a.dmg || a.heal || (a.onHit && a.aim)) && tgt) {
          if (a.pellets > 1) { // spread the hits over the animation; a stun or a dead target cuts the rest
            fireVolley(u, a, tgt, healing, 1);
            for (let i = 1; i < a.pellets; i++) queue.push({ at: t + lock * i / a.pellets, fn: () => { if (u.alive && t >= u.ccUntil && tgt.alive) fireVolley(u, a, tgt, healing, 1); } });
          } else fireVolley(u, a, tgt, healing);
        }
        startCd(u, a, 0);
      } else if (a.kind === "channel") {
        u.channel = { a, until: t + a.dur, next: t };
      } else if (a.kind === "field") {
        u.fields.push({ a, until: t + a.dur, target: ctx.target });
      }
    }
    function startCd(u, a, delay) {
      const c = u.cds[a.id];
      if (a.ult) return;
      const cd = a.cd || 0;
      // charges recharge one at a time
      c.ready = t + delay + (c.charges > 0 ? 0 : cd);
      if (c.charges < a.charges) setTimeoutCharge(u, a, t + delay + cd);
      if (a.sharedCd) for (const b of u.actions) if (b !== a && b.sharedCd === a.sharedCd && !b.ult) {
        u.cds[b.id].ready = Math.max(u.cds[b.id].ready, t + delay + cd);
      }
    }
    function setTimeoutCharge(u, a, at) { (u.rechargeQ || (u.rechargeQ = [])).push({ id: a.id, at }); }

    function fireWeapons(u) {
      if (t < u.nextFire) return;
      const ch = u.channel;
      let weapons;
      if (ch) weapons = [ch.a];
      else {
        const replaced = new Set();
        for (const f of u.fields) if (f.a.replaces) replaced.add(f.a.replaces);
        weapons = u.actions.filter(a => a.kind === "weapon" && !replaced.has(a.id) && t >= (u.reloadUntil[a.id] || 0));
      }
      if (!weapons.length) return;
      // refill finished reloads
      for (const a of weapons) if (a.ammo && u.ammo[a.id] <= 0 && t >= (u.reloadUntil[a.id] || 0)) u.ammo[a.id] = a.ammo;
      let choice = null, tgt = null, healing = false;
      for (const a of weapons) {
        const ht = healTargetFor(u, a);
        if (ht) { choice = a; tgt = ht; healing = true; break; }
      }
      if (!choice) {
        const e = u.target;
        if (e && targetable(e)) {
          let best = null, bdps = 0;
          const de = distTo(u, e);
          for (const a of weapons) if (a.dmg && inRange(u, a, e)) {
            const dps = a.dmg * a.pellets / a.cycle * falloffMult(a.falloff, de) * hitChance(u.ps, a.aim, false, de, e.size);
            if (dps > bdps) { bdps = dps; best = a; }
          }
          if (best) { choice = best; tgt = e; }
        }
      }
      if (!choice) return;
      u.nextFire = t + choice.cycle;
      if (ch) { if (t < ch.next) return; ch.next = t + ch.a.cycle; }
      if (R() > u.ps.uptime && !choice.ult) return; // lost the volley to movement / peeking
      fireVolley(u, choice, tgt, healing);
    }

    /* ----- per-tick upkeep ----- */
    function upkeep(u) {
      if (!u.alive) return;
      for (const h of u.hots) if (t < h.exp) doHeal(h.src, u, h.hps * DT, { action: h.action || "hot", noEcho: true });
      for (const d of u.dots) if (t < d.exp) dealDamage(d.src, u, d.dps * DT, d.action || "dot");
      if (!u.alive) return;
      if (u.regen && t - u.lastDmgT >= u.regen.delay) doHeal(u, u, u.regen.hps * DT, { action: "regen", noEcho: true });
      if (u.shieldMax && u.shield < u.shieldMax && t - u.lastDmgT >= S.shieldDelay) u.shield = Math.min(u.shieldMax, u.shield + S.shieldRate * DT);
      u.hots = u.hots.filter(h => t < h.exp); u.dots = u.dots.filter(d => t < d.exp);
      u.buffs = u.buffs.filter(b => t < b.exp); u.bonuses = u.bonuses.filter(b => t < b.exp && b.amt > 0.01);
      u.barriers = u.barriers.filter(b => t < b.exp && b.hp > 0);
      if (u.dmgLog.length > 60) u.dmgLog = u.dmgLog.filter(([tt]) => t - tt <= 1.5);
      if (u.rechargeQ) {
        u.rechargeQ = u.rechargeQ.filter(q => {
          if (t < q.at) return true;
          const a = u.actions.find(x => x.id === q.id), c = u.cds[q.id];
          c.charges = Math.min(a.charges, c.charges + 1); c.ready = Math.min(c.ready, t);
          return false;
        });
      }
      // active fields
      for (const f of u.fields) for (const e of (f.a.tick || [])) applyEffect(u, e, { target: f.target, action: f.a.id, a: f.a, tick: true }, DT);
      const ended = u.fields.filter(f => t >= f.until);
      if (ended.length) { u.fields = u.fields.filter(f => t < f.until); for (const f of ended) startCd(u, f.a, 0); }
      if (u.channel && t >= u.channel.until) { const a = u.channel.a; u.channel = null; startCd(u, a, 0); }
    }

    function snapshot() {
      timeline.push({ t: +(t - firstEngage).toFixed(2), u: all.map(u => [Math.round(u.hp), Math.round(u.bonuses.reduce((s, b) => s + b.amt, 0) + u.shield), u.alive ? 1 : 0]) });
    }

    /* ----- start ----- */
    for (const u of all) {
      for (const e of (u.def.passives || [])) applyEffect(u, e, { target: null, action: "passive" });
      for (const a of u.actions) if (a.kind === "weapon" && a.passiveOnHit) { /* reserved */ }
    }
    let lastSnap = -1;
    for (t = 0; t <= T_END + 1e-9; t += DT) {
      t = +t.toFixed(4);
      for (let qi = queue.length - 1; qi >= 0; qi--) {
        const q = queue[qi];
        if (t < q.at) continue;
        queue.splice(qi, 1);
        if (q.fn) q.fn();
        else if (q.u.alive || q.eff.t === "dmg") applyEffect(q.u, q.eff, q.ctx, q.scale);
      }
      for (const u of all) upkeep(u);
      for (const u of all) {
        if (!u.alive || !engaged(u)) continue;
        if (t < u.ccUntil) continue;
        if (!u.target || !targetable(u.target) || (u.side === "A" && u.focus !== "lowest")) u.target = pickEnemy(u);
        tryCast(u);
        fireWeapons(u);
      }
      if (t >= firstEngage && t - lastSnap >= 0.1 - 1e-9) { snapshot(); lastSnap = t; }
      if (!D.some(x => x.alive) || (A.length && !A.some(x => x.alive))) { snapshot(); break; }
    }
    const rel = v => v == null ? null : +(v - firstEngage).toFixed(2);
    return {
      duration: S.maxTime,
      units: all.map(u => ({
        side: u.side, idx: u.idx, key: u.key, label: u.label, maxHp: u.maxHp, loadout: u.loadout,
        alive: u.alive, deathT: rel(u.deathT), ps: u.ps, st: u.st, dummy: !!u.isDummy,
      })),
      events, timeline,
    };
  }

  /* ---------------- DPS dummy (for "how much damage is needed") ---------------- */
  function makeDummy(dd, idx) {
    const def = { name: "DPS check", hp: 1e9, actions: [{ id: "dps", name: "Sustained DPS", kind: "weapon", use: "always", aim: "auto", cycle: 0.1, dmg: dd.dps * 0.1, range: 999 }] };
    return {
      side: "A", idx, key: "DPS check", name: "DPS check", def, slot: {}, label: "A* DPS check", isDummy: true,
      ps: perfStats(100), maxHp: 1e9, hp: 1e9, shieldMax: 0, shield: 0, size: 1, loadout: null,
      actions: buildActions(def, null, []), dist: dd.dist || 3, mode: dd.mode || "dive", engageAt: dd.delay || 0,
      focus: dd.focus == null ? "lowest" : dd.focus, ultReady: false, alive: true, deathT: null,
      bonuses: [], buffs: [], hots: [], dots: [], barriers: [], invulnUntil: -1, untargUntil: 1e9, ccUntil: -1, regen: null,
      lastDmgT: -99, dmgLog: [], cds: { dps: { ready: 0, charges: 1 } }, ammo: {}, reloadUntil: {}, nextFire: 0,
      channel: null, fields: [], pending: {}, ultUsed: false, target: null,
      st: { dmgDone: 0, healDone: 0, healSelf: 0, dmgTaken: 0, healTaken: 0, absorbed: 0, byAction: {}, casts: [] },
    };
  }

  /* ---------------- aggregation ---------------- */
  function pct(arr, p) { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; }
  function monteCarlo(config, n, seed0) {
    n = n || 200; seed0 = seed0 || 1337;
    const nd = config.defenders.length;
    const deaths = Array.from({ length: nd }, () => []);
    const attDeaths = Array.from({ length: config.attackers.length }, () => []);
    const wipe = [], firstKill = [];
    const runs = [];
    for (let i = 0; i < n; i++) {
      const r = run(config, seed0 + i * 7919);
      let wipeT = 0, fk = Infinity;
      r.units.forEach(u => {
        if (u.side === "D") { if (!u.alive) { deaths[u.idx].push(u.deathT); wipeT = Math.max(wipeT, u.deathT); fk = Math.min(fk, u.deathT); } else wipeT = Infinity; }
        else if (!u.dummy && !u.alive) attDeaths[u.idx].push(u.deathT);
      });
      if (wipeT !== Infinity && nd) wipe.push(wipeT);
      if (fk !== Infinity) firstKill.push(fk);
      runs.push({ seed: seed0 + i * 7919, fk: fk === Infinity ? null : fk });
    }
    const summ = arr => ({ p: arr.length / n, p10: pct(arr, 0.1), p50: pct(arr, 0.5), p90: pct(arr, 0.9) });
    // representative run: the one whose first kill is the median (or a no-kill run if most survive)
    const killed = runs.filter(r => r.fk != null).sort((a, b) => a.fk - b.fk);
    const rep = killed.length >= n / 2 ? killed[Math.floor(killed.length / 2)] : runs.find(r => r.fk == null) || runs[0];
    return {
      n, defenders: deaths.map(summ), attackers: attDeaths.map(summ), wipe: summ(wipe), firstKill: summ(firstKill),
      repSeed: rep.seed,
    };
  }

  // Smallest extra sustained DPS (perfect aim, no falloff) on one defender that
  // kills them within `window` seconds in at least `need` of the runs, on top of
  // whatever attackers the config already has (pass attackers: [] for the raw check).
  function dpsCheck(config, targetIdx, window, opts) {
    opts = opts || {};
    const n = opts.n || 40, need = opts.need || 0.5;
    const cfg = Object.assign({}, config, { settings: Object.assign({}, config.settings || {}, { maxTime: window }) });
    const ok = dps => {
      const c = Object.assign({}, cfg, { dummy: { dps, focus: targetIdx, dist: opts.dist || 3, mode: opts.mode || "dive" } });
      let k = 0;
      for (let i = 0; i < n; i++) { const r = run(c, 4242 + i * 31); if (!r.units[targetIdx].alive) k++; }
      return k / n >= need;
    };
    if (ok(0)) return 0;
    let lo = 0, hi = 200;
    while (!ok(hi)) { lo = hi; hi *= 2; if (hi > 20000) return Infinity; }
    for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (ok(mid)) hi = mid; else lo = mid; }
    return Math.ceil(hi / 5) * 5;
  }

  // Rough model-level numbers for reference tables.
  function kitSummary(def) {
    const ws = def.actions.filter(a => a.kind === "weapon" && !a.teamup);
    const best = f => ws.reduce((m, a) => Math.max(m, (a[f] || 0) * (a.pellets || 1) / a.cycle), 0);
    return { hp: def.hp + (def.shield || 0), dps: Math.round(best("dmg")), hps: Math.round(best("heal")) };
  }

  window.SIM = { DEFAULTS, MODE_DIST, defs, findDef, keyOf, perfStats, hitChance, run, monteCarlo, dpsCheck, kitSummary };
})();
