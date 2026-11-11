/* Sim models: reference examples (Luna Snow, Psylocke) - see data/sim/README.md */
SIM_DEF({
  "name": "Luna Snow",
  "role": "Strategist",
  "hp": 275,
  "speed": 6,
  "actions": [
    { "id": "lmb", "name": "Light & Dark Ice", "kind": "weapon", "use": "always",
      "aim": "hitscan", "cycle": 0.5, "pellets": 3, "dmg": 24, "heal": 24, "crit": true,
      "falloff": [20, 40, 0.7], "ammo": 30, "reload": 1.5, "range": 60 },
    { "id": "shift", "name": "Ice Arts", "kind": "channel", "use": "allyHp<0.7|underFire", "cd": 15, "dur": 6,
      "aim": "beam", "cycle": 0.7, "dmg": 50, "heal": 75, "targets": "all", "range": 40, "replaces": "lmb",
      "onCast": [ { "t": "hot", "hps": 35, "dur": 3, "to": "self" } ] },
    { "id": "rmb", "name": "Absolute Zero", "kind": "cast", "use": "enemyNear|selfHp<0.6", "cd": 12,
      "aim": "projectile", "dmg": 50, "range": 40,
      "onCast": [ { "t": "hot", "hps": 35, "dur": 3, "to": "self" } ],
      "onHit": [ { "t": "cc", "kind": "freeze", "dur": 1.5, "to": "target" }, { "t": "bonus", "amt": 50, "to": "self" } ] },
    { "id": "q", "name": "Fate of Both Worlds", "kind": "field", "ult": true, "use": "teamHp<0.6|allyHp<0.35", "dur": 10, "range": 15,
      "onCast": [ { "t": "heal", "amt": 200, "to": "allies" }, { "t": "bonus", "amt": 250, "dur": 10, "to": "self" } ],
      "tick": [ { "t": "heal", "amt": 250, "to": "allies" } ] },
    { "id": "c-atlas", "name": "Atlas Bond", "kind": "cast", "teamup": "Atlas Bond", "use": "othersHp<0.6", "cd": 12,
      "aim": "aoe", "dmg": 45, "heal": 80, "targets": "all", "range": 40,
      "enhanced": { "partner": "White Fox", "cd": 10 } },
    { "id": "c-duality", "name": "Duality Dance", "kind": "cast", "teamup": "Duality Dance", "use": "selfHp<0.7|underFire", "cd": 15, "range": 20,
      "onCast": [ { "t": "echo", "pct": 35, "dur": 6, "to": "self" }, { "t": "lifesteal", "pct": 50, "dur": 6, "to": "self" } ],
      "enhanced": { "partner": "Adam Warlock" } }
  ],
  "passives": [
    { "t": "echo", "pct": 35, "to": "ally" },
    { "t": "echo", "pct": 10, "to": "self" }
  ],
  "notes": "Official page (S10.5 build) + S11 balance post: Absolute Zero freeze 2.7s -> 1.5s; Atlas Bond loses Charm and self-cleanse, heal 70 -> 80, dmg 35 -> 45; Duality Dance ally-heal-to-self 25% -> 35%. Share the Stage (E) modelled as a permanent Idol Aura on one ally: echo 35% of Luna's healing on others (official 'HEALING BOOST: 35%'). Number One Idol (F) 'gain extra healing when healing others 10%' read as Luna healing herself for 10% of healing done. Cryo Heart (35/s for 3s) attached to Ice Arts and Absolute Zero casts. Ult in heal mode; 'SHIELD VALUE 250' read as Bonus Health on Luna for the duration; field radius not listed (15m assumed). Reload 1.5s assumed. Ice Arts is a 1m-radius piercing cylinder: aim beam, pierces (targets all). Duality Dance enhanced (crit cooldown refunds) not modelled."
});
SIM_DEF({
  "name": "Psylocke",
  "role": "Duelist",
  "hp": 150,
  "shield": 100,
  "speed": 6,
  "actions": [
    { "id": "lmb", "name": "Psionic Crossbow", "kind": "weapon", "use": "always",
      "aim": "projectile", "cycle": 0.8, "pellets": 4, "dmg": 12, "crit": true, "critMult": 1.5,
      "falloff": [8, 30, 0.7], "ammo": 16, "reload": 1.5, "range": 30,
      "onHit": [ { "t": "cdr", "sec": 0.3, "action": "all" } ] },
    { "id": "shift", "name": "Psi-Blade Dash", "kind": "cast", "use": "engage|targetHp<0.35", "cd": 12, "charges": 2,
      "aim": "melee", "dmg": 50, "targets": "all", "range": 12 },
    { "id": "rmb", "name": "Wing Shurikens", "kind": "cast", "use": "engage|cd", "cd": 8,
      "aim": "projectile", "pellets": 5, "dmg": 20, "falloff": [15, 25, 0.8], "range": 25,
      "onHit": [ { "t": "bonus", "amt": 10, "to": "self" } ] },
    { "id": "e", "name": "Psychic Stealth", "kind": "cast", "use": "selfHp<0.5|underFire", "cd": 15, "range": 0,
      "onCast": [ { "t": "untargetable", "dur": 2, "to": "self" } ] },
    { "id": "q", "name": "Dance of the Butterfly", "kind": "channel", "ult": true, "use": "engage|targetHp<0.8", "dur": 4,
      "aim": "auto", "cycle": 0.5, "dmg": 160, "range": 10 },
    { "id": "c-projection", "name": "Mental Projection", "kind": "cast", "teamup": "Mental Projection", "use": "engage|selfHp<0.5", "cd": 20, "range": 12,
      "onCast": [ { "t": "untargetable", "dur": 1, "to": "self" }, { "t": "dmgBoost", "pct": 15, "dur": 3, "to": "self" } ],
      "enhanced": { "partner": "Emma Frost" } },
    { "id": "c-darts", "name": "Light & Dark Darts", "kind": "cast", "teamup": "Light & Dark Darts", "use": "engage|selfHp<0.6", "cd": 20,
      "aim": "aoe", "dmg": 30, "targets": "all", "range": 6,
      "onHit": [ { "t": "heal", "amt": 20, "to": "self" } ],
      "onCast": [ { "t": "untargetable", "dur": 1.5, "to": "self" } ],
      "enhanced": { "partner": "Cloak & Dagger" } }
  ],
  "notes": "Official page (S10.5 build); no S11 changes. Health '150+100 Regenerative Shield' -> hp 150, shield 100. Crossbow: 4 bolts x 12 per round with 0.2s between the two shots and 0.6s between rounds, read as 48 damage per 0.8s volley (16 ammo = 4 volleys); crit 150% per page; reload 1.5s assumed. Crossbow hits refund 0.3s on all cooldowns. Wing Shurikens: 5 shurikens x (10 out + 10 recall) folded into 5 pellets of 20; 10 Bonus Health per shuriken landed. Psychic Stealth: 2s untargetable (she flickers when hit; treated as untargetable). Ult slashes 160 every 0.5s for 4s at enemies in 10m (auto-targets). Mental Projection: illusion mimics 15% damage for ~3s while she stealths briefly; swap (enhanced) is mobility, not modelled. Light & Dark Darts: ring of 30 dmg darts, 20 self-heal per hit, brief re-stealth in the Shadow Domain."
});
