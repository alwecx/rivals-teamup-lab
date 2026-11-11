# Rivals S11 Team-Up Lab

An unofficial, single-file team-composition sandbox for **Marvel Rivals Season 11**.
Slot six heroes, see exactly which team-up loadouts go **Enhanced**, and brute-force
the best comps — all in one HTML file with zero dependencies.

**▶ Try it live: [alwecx.github.io/rivals-teamup-lab](https://alwecx.github.io/rivals-teamup-lab/)** · **[Sim Lab (fight simulator)](https://alwecx.github.io/rivals-teamup-lab/sim.html)**

**The full board** — six slots, live team-up readout, roster intel, and the optimizer, with the avatar pack installed:

![Desktop board with avatars](docs/screenshot-desktop.png)

**No avatars? No problem** — without the optional icon pack, heroes render as text tiles and every feature still works:

![With and without avatars](docs/screenshot-side-by-side.png)

**Mobile layout** — collapses to a single-column scroll with touch-sized controls:

![Mobile layout](docs/screenshot-mobile.png)

## What it does

Season 9 reworked team-ups: every hero has **two team-up loadouts**, each with a
base effect (always on) and an enhanced effect (active when the named partner is
on your team) — but only **one** loadout equipped per match. Keeping track of 108
team-ups across 55 heroes in your head is miserable. This tool doesn't make you.

- **Build board** — six slots, click or drag heroes in. Each card shows the hero's
  two partners as buttons; click one to pin that loadout, or let the auto-equip
  pick whichever loadout's partner is already on the team.
- **Live readout** — every slotted hero's equipped team-up with its official base
  and enhanced descriptions, plus synergy lines drawn between enhanced pairs.
- **Roster intel** — dots on every unslotted hero show how they'd connect to your
  current team: *gains enhanced* (violet), *grants enhanced to a selected loadout*
  (blue), or *grants via a loadout swap* (blue ring).
- **Optimizer** — pick a role comp (2-2-2, 1-3-2, …) and **Find Teams** enumerates
  every legal roster for it, ranked by enhanced count. **Lock** heroes to force
  them (and their selected team-up) into every result. **Scan Presets** badges all
  16 comps with their best possible score under your current locks.
- **Shareable links** — the full board state (heroes, locks, loadout picks, comp)
  lives in the URL hash. Copy the address bar, paste it in Discord, argument settled:
  `…#t=thor.vL0,hela.d,deadpool.s1&c=1-3-2`
- **Mobile friendly** — collapses to a single-column layout with touch-sized controls.

## Sim Lab - fight simulator (`sim.html`)

A competitive-play calculator: put 1-6 heroes on defence (usually your 2-3
strategists) and 1-6 attackers on the other side, give **every hero their own
performance level**, and simulate the fight hundreds of times.

- **Performance 0-100 per hero** turns into concrete skill numbers: accuracy
  (60 → ~54 %, 70 → ~64 %, 100 → every shot), headshot rate, firing uptime,
  reaction time on abilities and how well area heals/attacks catch people.
  100 is a robot - perfect but unrealistic. Each number can also be set
  directly under *Fine-tune skill*. Weapon type matters: beams and splash are
  easier to land than hitscan, projectiles get harder with range, allies are
  easier to heal than enemies are to hit, big hitboxes are easier.
- **Full kits, Season 11 numbers**: primary/secondary fire, every ability,
  ultimates (tick *Ult ready*), both team-up loadouts with their enhanced
  versions, passives - healing, self-heals, heal boosts, auras, bonus health,
  barriers that soak damage until they break, damage reduction, invincibility,
  stealth, stuns/freezes/knock-ups, anti-heal, lifesteal, falloff, crits, ammo.
- **Attackers** pick a range (dive 3 m, brawl 10 m, poke 25 m, long 40 m), a
  focus target and an engage time, so you can test a dive, a poke line or a
  staggered collapse.
- **Results**: kill chance and time-to-kill (median and 10-90 % range) for each
  defender, team wipe chance, attacker deaths, an HP-over-time chart, the fight
  log, damage/healing breakdown per ability (with hit rates), and **which
  cooldowns had to be committed before each kill**.
- **What it takes to kill**: the sustained DPS a defender can out-heal (for 1 s,
  2 s and your chosen window), and how much *extra* DPS your current attackers
  still need.
- **Stack finder**: tries every duelist/vanguard pair (or trio) against your
  backline and ranks the stacks that kill fastest and most often.
- **Hero model reference**: every hero's modelled actions, numbers, effects and
  written assumptions next to the raw official stats.

The engine is `sim-engine.js`; hero models are plain data in `data/sim/*.js`
(schema: [`data/sim/README.md`](data/sim/README.md)), built from the official
hero pages (`data/official-stats.js`, refreshed by `tools/sync-stats.ps1`) plus
the Season 11 balance post. `tools/check-sim-data.ps1` validates the models.
Movement, line of sight and real decision-making are abstracted - treat the
numbers as a well-informed model, not the game itself.

## Using it

No build, no install, no network requirement beyond Google Fonts (which degrades
gracefully offline). Either use it at
**[alwecx.github.io/rivals-teamup-lab](https://alwecx.github.io/rivals-teamup-lab/)**
or download `index.html` and open it in any modern browser (2023+).

## Avatars (optional)

The tool works fully without images — heroes render as text tiles. With an
`avatars/` folder beside the HTML, tiles and cards use icons in three tiers:

| Tier | Filename | Shown when |
|---|---|---|
| Normal | `Hero_Icon_<Name>.webp` | No enhanced team-up available |
| Lord | `Lord_Icon_<Name>.webp` | Enhanced available, but not the active pick |
| Champion | `Champion_Icon_<Name>_Animated.webp` | Enhanced **and** activated (animated) |

`<Name>` is the in-game name with spaces/ampersands as underscores, capitalization
preserved: `The_Punisher`, `Jeff_the_Land_Shark`, `Cloak_Dagger`, `Star-Lord`.
Missing tiers fall back downward (Champion → Lord → Normal → text), so a partial
set is fine. A fully-firing team literally animates.

Icons in this repo were sourced from the community-maintained
[Marvel Rivals Wiki](https://marvelrivals.fandom.com/wiki/Avatars).
`tools/fetch-avatars.ps1` downloads any tier that is missing for a hero in the
roster (as `.webp`) once the wiki has it, without touching existing files:

```powershell
powershell -ExecutionPolicy Bypass -File tools\fetch-avatars.ps1
```

## Data

Team-up names, partners and base/enhanced descriptions are synced to the
official [Marvel Rivals hero pages](https://www.marvelrivals.com/heroes/index.html)
plus the [Season 11 balance post](https://www.marvelrivals.com/balancepost/20261110/41667_1319209.html),
**as of November 11, 2026**. That covers The Hood's loadouts, Gorr the God
Butcher (Season 10) and the Season 10–11 team-up reworks.

**Nightcrawler** (Season 11 Strategist, launching November 13) is on the roster
with his team-ups marked TBD until they are revealed. The data is one
plainly-formatted `RAW` array at the top of the file's script.

### Refreshing the data

`tools/sync-official.ps1` reads every official hero page and merges it into
`RAW`: new heroes, new or swapped team-ups and partner changes are applied
automatically, and wording differences are listed for review instead of
overwriting the hand-checked text. Run it from the repo root on Windows:

```powershell
powershell -ExecutionPolicy Bypass -File tools\sync-official.ps1 -DryRun   # see what would change
powershell -ExecutionPolicy Bypass -File tools\sync-official.ps1           # update index.html
```

Corrections welcome via Issues or PRs.

## How the optimizer works (for the curious)

Hero partnerships are packed into bitmasks, so scoring a candidate team is a few
AND operations. Find Teams enumerates every combination for the selected comp
(tens to hundreds of thousands of teams, under half a second), buckets results by
enhanced count and lock satisfaction, and applies a diversity filter so the top
list isn't ten near-identical rosters. Locked heroes are pinned to whichever
loadout is displayed at search time — what you see is what gets enforced.

## Feedback & contributing

Bug reports, stale-data corrections, and feature ideas → GitHub Issues. The whole
app is one commented HTML file; PRs are easy to review.

## Built with AI

In the spirit of transparency: this tool was "vibe-coded" — designed, iterated,
debugged, and reviewed in collaboration with AI tools, with a human directing,
testing, and shipping it. Judge the result on its merits: the entire app is one
readable, commented HTML file with no build step, no trackers, no accounts, and
no network calls beyond Google Fonts — auditable in a single sitting if you'd
like to see for yourself.

## License & disclaimers

Code is released under the [MIT License](LICENSE). **The license covers the code
only.** Files in `avatars/` are the property of NetEase Games and Marvel, included
non-commercially for identification purposes, and will be removed immediately upon
request by the rights holders — the tool is fully functional without them.

This is a free fan-made tool. It is not affiliated with, endorsed by, or connected
to NetEase Games or Marvel in any way. Marvel Rivals and all associated characters
and materials are trademarks and copyrights of their respective owners.
