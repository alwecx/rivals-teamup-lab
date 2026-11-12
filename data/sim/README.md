# Combat models for the simulator (`sim.html`)

Each hero is described once, as plain data, and the engine in `sim.html` runs
every hero through the same rules. This file is the contract between the two.

* Numbers come from `data/official-stats.js` (official hero pages, build
  20261012 = Season 10.5) **plus the Season 11 balance post (2026-11-10)**,
  which the models must already include. When the official page and the
  balance post disagree, the balance post wins.
* Where the official data is silent (reload time, crit multiplier, how an
  ability is really used), make a sensible call and write it in `notes`.
* Model what decides a fight between a few strategists and the divers/poke
  coming at them: damage, healing, self-sustain, bonus health, damage
  reduction, invulnerability, stealth, crowd control, anti-heal, team-up
  abilities that change those. Pure movement (wall-crawl, jumps, flight)
  can be skipped unless it gives a defensive effect (e.g. untargetable).

## File format (strict - checked by `tools/check-sim-data.ps1`)

```js
/* Sim models: <group> - see data/sim/README.md */
SIM_DEF({
  "name": "Luna Snow",
  ...
});
SIM_DEF({ ... });
```

* `SIM_DEF({` must start a line and `});` must end the block on its own line.
* Between them: **strict JSON** (double-quoted keys, no comments, no trailing
  commas, no `Infinity`/`undefined`). Put explanations in `notes` strings.
* Run `powershell -ExecutionPolicy Bypass -File tools\check-sim-data.ps1`
  from the repo root; it must print `OK` for your file.

## Hero

| field | type | meaning |
|---|---|---|
| `name` | string | Exactly the key in `OFFICIAL_STATS.heroes` (e.g. `"Cloak & Dagger"`, `"Gorr the God Butcher"`). |
| `provisional` | true? | Hero whose kit is known but whose official numbers aren't published yet (not in `official-stats.js`). Every number is an estimate; the Sim Lab labels the hero "(est.)". Remove the flag once the real numbers are in. |
| `variant` | string? | Only for heroes with several playable roles: `"Deadpool"` gets three defs with `variant` `"Vanguard"`, `"Duelist"`, `"Strategist"`. |
| `role` | `"Vanguard"` \| `"Duelist"` \| `"Strategist"` | |
| `hp` | number | Health. For `"150+100 Regenerative Shield"` use `hp: 150` and `shield: 100`. |
| `shield` | number? | Regenerating shield on top of `hp` (absorbs first, regenerates out of combat - engine handles regen). |
| `size` | number? | Hitbox factor for enemies aiming at this hero: 1 normal, 0.8 small (Rocket, Jeff), 1.25 big (Hulk, Groot, Devil Dinosaur, Venom). Default 1. |
| `speed` | number | Movement speed m/s. |
| `actions` | Action[] | Everything the hero can actively do (weapons + abilities + ultimate + team-ups). |
| `passives` | Effect[]? | Always-on effects applied at fight start (omit `dur` = permanent). |
| `notes` | string | Sources and every assumption you made. |

## Action

| field | type | meaning |
|---|---|---|
| `id` | string | Unique within the hero, e.g. `"lmb"`, `"rmb"`, `"shift"`, `"e"`, `"q"`, `"c"`, `"passive"`. |
| `name` | string | In-game name, title case. |
| `kind` | `"weapon"` \| `"channel"` \| `"cast"` \| `"field"` | see below |
| `use` | string | When the AI uses it (see **Use conditions**). Weapons: `"always"`. |
| `cd` | number? | Cooldown seconds (after the channel/field ends for `channel`/`field`). |
| `charges` | number? | Default 1. |
| `ult` | true? | Ultimate. Only usable if the user marks the ult as ready; once per fight. |
| `teamup` | string? | Team-up loadout name (as in the lab, e.g. `"Atlas Bond"`). The action exists only when that loadout is equipped. |
| `enhanced` | object? | `{ "partner": "White Fox", ...fields }` - fields that replace this action's fields when the partner is on the same team. Arrays (`onHit`, `onCast`, `tick`) replace wholesale. |
| `range` | number | Max distance in metres at which it can be used / reach its target. Melee 3-5, typical guns 40-60. |
| `aim` | `"hitscan"` \| `"projectile"` \| `"beam"` \| `"melee"` \| `"aoe"` \| `"auto"` | How hard it is to land. `beam` = continuous tracking beam, `aoe` = splash/area/wide spread, `auto` = lock-on or guaranteed (no roll). |
| `cycle` | number | Seconds between volleys (weapons, channels). For "X rounds per second" use `1/X`. Include burst gaps: Psylocke 4 bolts over 0.6+... |
| `pellets` | number? | Hits per volley, each rolled separately (shotguns, triple shots). Default 1. |
| `dmg` | number? | Damage per landed pellet (before falloff/crit). |
| `heal` | number? | Healing per landed pellet when the shot is aimed at an ally. A weapon with `heal` > 0 can heal allies; with `dmg` > 0 it can shoot enemies; the AI picks per volley. |
| `healSelf` | bool? | The heal can target the caster herself. Default false (most strategist guns can't). |
| `targets` | `1` \| `"all"` | `"all"` = each pellet also hits other allies/enemies near the main target (spill/area/pierce), scaled by the scenario's clustering. Default 1. |
| `crit` | bool? | Can headshot. |
| `critMult` | number? | Override the global multiplier (Psylocke's crossbow: 1.5). |
| `falloff` | [start, end, minFraction]? | `"Falloff begins at 20m, decreasing to 70% at 40m"` -> `[20, 40, 0.7]`. Applies to dmg (and heal if `healFalloff: true`). |
| `ammo` | number? | Magazine in pellets/rounds. Omit for no ammo. |
| `reload` | number? | Reload seconds (official pages rarely list it; 1.5 is a sane default - say so in notes). |
| `dur` | number? | `channel` / `field` duration. |
| `onCast` | Effect[]? | Applied once when the action starts. |
| `onHit` | Effect[]? | Applied for every landed pellet. `to` defaults to whoever was hit. |
| `tick` | Effect[]? | `field` only: amounts are **per second**, applied continuously while it lasts. |
| `replaces` | string? | id of the weapon this channel/field replaces while active (Ice Arts replaces `lmb`). |
| `overrides` | string? | Team-up actions only: id of a base action this team-up **upgrades**. While the loadout is equipped the base action is removed and this one is used instead (e.g. a team-up that turns Abyssal Veil into Lunar Barrier). Give the upgraded action the full stats. |
| `castTime` | number? | Animation lock in seconds after casting (no other ability or weapon fire meanwhile). Default 0.4. Use ~0.1-0.2 for instant self-buffs, 0.6-1.0 for long animations/grabs. |
| `sharedCd` | string? | Actions with the same `sharedCd` tag share one cooldown (casting one puts the others on cooldown too). |
| `pctMaxHp` | number? | Extra damage per landed hit equal to this % of the target's max health. |

### Kinds

* **weapon** - used continuously (primary fire, secondary fire, melee). The AI
  fires the best available weapon every tick: a healing weapon when an ally
  needs healing, otherwise a damage weapon at the current enemy target.
* **channel** - starts on its `use` condition, then fires like a weapon for `dur`
  seconds (Luna's Ice Arts, Psylocke's ult slashes).
* **cast** - one-shot: applies `onCast`; if it has `dmg`/`heal` it also fires
  `pellets` hits once (rolled with `aim`).
* **field** - persistent area for `dur` seconds: `onCast` once, then `tick`
  per second (healing fields, damage zones, auras, summons/turrets).

## Effect

Every effect is `{ "t": <type>, ... , "to": <target> }`.

| `t` | fields | meaning |
|---|---|---|
| `dmg` | `amt` | Damage. In `tick`: per second. |
| `heal` | `amt`, `overflow`?: `"bonus"`, `overflowMax`? | Healing. `overflow: "bonus"` turns overheal into Bonus Health (cap `overflowMax`). In `tick`: per second. |
| `hot` | `hps`, `dur` | Healing over time. |
| `dot` | `dps`, `dur` | Damage over time. |
| `bonus` | `amt`, `dur`? | Bonus Health (absorbs before health; expires after `dur`). |
| `barrier` | `hp`, `dur`? | Deployable shield/barrier protecting `to`. Absorbs part of the incoming damage until broken (poke damage mostly blocked, divers mostly walk around it - engine decides the share). |
| `dr` | `pct`, `dur`? | Damage Reduction, e.g. `30` = take 30% less. |
| `invuln` | `dur` | Invincible: takes no damage. |
| `untargetable` | `dur` | Stealth / phased / invisible / cocooned: enemies cannot target it. |
| `healBoost` | `pct`, `dur`? | Healing **received** +pct. |
| `healBoostDealt` | `pct`, `dur`? | Healing **done** +pct. |
| `dmgBoost` | `pct`, `dur`? | Damage dealt +pct. |
| `vuln` | `pct`, `dur` | Damage **taken** +pct (Vulnerability). |
| `antiHeal` | `pct`, `dur` | Healing received -pct (Healing Reduction). |
| `cc` | `dur`, `kind`: `"stun"`\|`"freeze"`\|`"sleep"`\|`"knock"`\|`"root"` | Cannot act for `dur`. Knock-up/back/launch -> `knock` with the airborne/displaced time (~0.5-1s). `root` (immobilise/imprison) only stops movement: the target keeps shooting but can't use melee dashes/lunges. |
| `slow` | `pct`, `dur` | Slow (only affects how fast divers re-engage; cosmetic otherwise). |
| `lifesteal` | `pct`, `dur`? | Heal self for pct of damage dealt. |
| `echo` | `pct`, `dur`? | While active, whenever **the caster** heals someone other than `to`, `to` is also healed pct% of that amount (Luna's Idol Aura; "heal yourself for X% of healing done" = `to: "self"`). |
| `share` | `pct`, `dur` | Soul-Bond style link on `to` (usually `"allies"`): pct% of damage any linked hero takes is spread evenly across all linked heroes. |
| `regen` | `hps`, `delay` | Passive: heal hps per second after `delay` s without taking damage. |
| `cdr` | `sec`, `action`: id or `"all"` | Reduce the caster's cooldowns (e.g. Psylocke's crossbow 0.3 s per hit). |
| `cleanse` | | Remove cc / anti-heal / dots from `to`. |
| `revive` | `hpPct`, `bonusPct`?, `dur`? | Revive fallen allies (ults only). |
| `weaken` | `pct`, `dur` | The hero it lands on deals pct% **less** damage (enemy damage-dealt reduction). |
| `blind` | `pct`, `dur` | The hero it lands on lands pct% fewer shots (Blind / vision loss). |
| `ccImmune` | `dur`? | Immune to crowd control (Unstoppable etc.). Omit `dur` in `passives` for permanent. |

Inside a field's `tick`, `hot`/`dot` act as a continuous per-second heal/damage
(`hps`/`dps` per second while the field lasts), `cdr` is seconds per second, and
`bonus` is Bonus Health granted per second.
| `cheatDeath` | `hp`, `bonus`?, `bonusDur`?, `invuln`?, `dur`? | Arms a one-time "survive fatal damage" on `to`: the next lethal hit leaves them at `hp`, then grants `bonus` Bonus Health for `bonusDur` s and `invuln` s of invincibility. Usually a passive (no `dur`) or an ability with `dur`. |

**Extra effect fields:** any effect may have `delay` (seconds after it is triggered
before it lands - wind-ups, meteors). `dmg` and `heal` accept `pctMaxHp` (plus % of
the recipient's max health) and `dmg` accepts `pctMissingHp` (plus % of their
missing health - executes). `bonus` accepts `missingPct` (plus % of the
recipient's missing health, e.g. "Bonus Health scaling with missing Health").

### Targets (`to`)

`"self"` - the caster. `"ally"` - one ally chosen by the AI (lowest health %, never
the caster). `"allyOrSelf"` - same but may pick the caster. `"allies"` - every
ally including the caster (others are reached according to clustering).
`"others"` - every ally except the caster. `"target"` - the enemy (or ally) this
action is aimed at / hit. `"enemies"` - all enemies near the target (clustering).
`"attackers"` - enemies currently damaging the caster.

## Use conditions (`use`)

Join with `|` for "any of": `"selfHp<0.5|enemyNear"`.

| condition | true when |
|---|---|
| `always` | always (weapons) |
| `cd` | whenever ready during the fight |
| `allyHp<X` | some ally *or the caster* is below fraction X of max health |
| `othersHp<X` | some ally *other than* the caster is below X |
| `selfHp<X` | caster below X |
| `teamHp<X` | average team health fraction below X |
| `enemyNear` | an enemy is within 8 m of the caster |
| `underFire` | the caster took ≥ 60 damage in the last second |
| `engage` | in the first 0.5 s after this hero engages (opening combo) |
| `targetHp<X` | the hero's current enemy target is below fraction X (finishers) |
| `never` | modelled for reference only |

Performance level decides how *fast* the AI reacts to a condition (a perfect
player uses it the tick it becomes true) and how well it lands; the condition
says *when a good player would want to press it*.

## Example

See `data/sim/examples.js` (Luna Snow, Psylocke).
