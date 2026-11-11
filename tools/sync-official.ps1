<#
  sync-official.ps1 - refresh the RAW team-up table in index.html from the
  official hero pages on marvelrivals.com.

  Each official hero page (https://www.marvelrivals.com/heroes/<id>/index.html)
  embeds a window.__HERO_DATA__ JSON blob with the hero's role and both team-up
  loadouts (name, partner, base effect, enhanced effect). This script reads
  every hero listed on the heroes index, merges the result into RAW, and
  rewrites index.html in place.

  Merge rules (chosen so share links and hand-fixed text survive a re-sync):
    * Hero order and team-up order (loadout 0 / 1) are kept as they are in RAW,
      because share links store the loadout index. New heroes are appended at
      the end of their role group.
    * Hero / team-up display names are kept from RAW when they match the site
      ignoring case and punctuation (the site shows names in ALL CAPS).
    * Existing description text is KEPT by default: the hero pages carry many
      copy errors ("Invincible Invincible", "Slowingenemies", "{Ability1}")
      that RAW has hand-fixed. Wording differences are printed as SITE DIFF
      lines for review; pass -UpdateText to take the site's wording instead.
      New heroes and new team-ups always take the site's text.
    * If the site's entry looks broken (partner in the text does not match the
      partner in the image path, or both loadouts share one description), the
      existing RAW entry is kept and a warning is printed.
    * Heroes in RAW that are not on the site yet (e.g. a hero revealed but not
      launched) are kept untouched.
    * $Overrides below patch in balance-post wording the hero pages have not
      caught up with. Each is guarded by a when/unless phrase, so it is applied
      once and is a no-op on later runs.

  Usage (from the repo root, Windows PowerShell 5.1+ or PowerShell 7):
    powershell -ExecutionPolicy Bypass -File tools\sync-official.ps1               # update index.html
    powershell -ExecutionPolicy Bypass -File tools\sync-official.ps1 -DryRun       # report only
    powershell -ExecutionPolicy Bypass -File tools\sync-official.ps1 -UpdateText   # also take site wording
#>
param(
  [string]$Html = (Join-Path $PSScriptRoot '..\index.html'),
  [switch]$DryRun,
  [switch]$UpdateText
)
$ErrorActionPreference = 'Stop'
$UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
$Base = 'https://www.marvelrivals.com/heroes'

# ---------------------------------------------------------------------------
# Balance-post wording not yet reflected on the hero pages.
#   when   = apply only if the site's current text for that field CONTAINS this
#   unless = apply only if the site's current text does NOT contain this
#   base / enh / append = replacement text, or text appended to base
# ---------------------------------------------------------------------------
$Overrides = @(
  # Season 10 (2026-09-08 balance post) + Season 11 (2026-11-10): Charm and self-cleanse removed
  @{ hero='Luna Snow'; tu='Atlas Bond'; when='Charms';
     base='Unleash a spirit fox forward that damages enemies while healing any allies in its path.' }
  @{ hero='Luna Snow'; tu='Atlas Bond'; when='self-cleanse';
     enh='When teaming up with White Fox, the spirit fox automatically returns after reaching its maximum distance.' }
  # Season 10: Black Panther team-up now feeds Fortune
  @{ hero='Black Cat'; tu='Feline Alliance'; unless='Fortune';
     append='Each enemy hit by the explosion grants Fortune.' }
  # Season 11: new / changed team-up effects
  @{ hero='Black Widow'; tu='Allied Agents'; unless='Bonus Health';
     append='Black Widow also gains Bonus Health from a portion of the damage dealt while Focused.' }
  @{ hero='Groot'; tu='Wild Wall'; unless='Flora Colossus';
     append='The Wild Wall is also affected by the Flora Colossus passive, just like Thornlash Wall.' }
  @{ hero='Cloak & Dagger'; tu='Oblivion Shroud'; unless='Launch';
     append='The veils also Launch back enemies hit along their path.' }
  @{ hero='Elsa Bloodstone'; tu='Prehistoric Trap'; when='two Smoky Snares';
     enh='When teaming up with Devil Dinosaur, the cooldown of Smoky Snare is reduced.' }
  @{ hero='Loki'; tu='Vibrant Vitality'; when='granting a Damage Boost';
     base="Empowers Regeneration Domain, expanding the rune field's radius from 5m to 6.5m." }
  @{ hero='Loki'; tu="Villain's Illusion"; unless='Devious Exchange';
     append='Whenever one of his illusions is destroyed, Doppelganger and Devious Exchange gain 1s of cooldown reduction.' }
)

function Get-Page([string]$url) {
  $r = Invoke-WebRequest -Uri $url -UserAgent $UA -UseBasicParsing
  [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
}
function Key([string]$s) { ($s.ToLowerInvariant() -replace '[^a-z0-9]', '') }
function Clean([string]$s) {
  # drop in-game markup the site sometimes leaks: <Buff>, </>, {Ability1}
  $s = $s -replace '</?[A-Za-z]*>', '' -replace '\{Ability\d*\}', 'ability'
  $s = ($s -replace '\s+', ' ').Trim()
  if ($s -and $s -notmatch '[\.!\?"]$') { $s += '.' }
  $s
}
function TitleCase([string]$s) {
  $small = 'a','an','and','of','the','to','in','on','with'
  $words = $s.ToLowerInvariant() -split ' '
  for ($i = 0; $i -lt $words.Count; $i++) {
    $w = $words[$i]
    if ($i -gt 0 -and $small -contains $w) { continue }
    if ($w.Length) { $words[$i] = $w.Substring(0,1).ToUpperInvariant() + $w.Substring(1) }
  }
  $words -join ' '
}
function JsStr([string]$s) { '"' + ($s -replace '\\', '\\' -replace '"', '\"') + '"' }

# ---------------------------------------------------------------- read RAW --
$text = [IO.File]::ReadAllText((Resolve-Path $Html))
$nl = if ($text.Contains("`r`n")) { "`r`n" } else { "`n" }
$m = [regex]::Match($text, '(?s)(const RAW=\[\r?\n)(.*?)(\r?\n\];)')
if (-not $m.Success) { throw "Could not find 'const RAW=[ ... ];' in $Html" }
$roleCode = @{ V = 'Vanguard'; D = 'Duelist'; S = 'Strategist' }
$codeOf = @{ Vanguard = 'V'; Duelist = 'D'; Strategist = 'S' }
$raw = New-Object System.Collections.ArrayList
foreach ($line in ($m.Groups[2].Value -split '\r?\n')) {
  if (-not $line.Trim()) { continue }
  $lm = [regex]::Match($line, '^\[("(?:[^"\\]|\\.)*"),([VDS]),(.*)\],?\s*$')
  if (-not $lm.Success) { throw "Unparseable RAW line: $line" }
  $j = ConvertFrom-Json ('[' + $lm.Groups[1].Value + ',"' + $lm.Groups[2].Value + '",' + $lm.Groups[3].Value + ']')
  $tus = New-Object System.Collections.ArrayList
  foreach ($t in @($j[2])) { if ($null -ne $t) { [void]$tus.Add([pscustomobject]@{ name=$t[0]; partner=$t[1]; base=$t[2]; enh=$t[3] }) } }
  [void]$raw.Add([pscustomobject]@{ name=$j[0]; role=$roleCode[$lm.Groups[2].Value]; tus=$tus })
}
Write-Host "RAW: $($raw.Count) heroes"

# ------------------------------------------------------------ fetch site --
$index = Get-Page "$Base/index.html"
$site = [regex]::Matches($index, 'data-id="([a-z0-9]+)" data-name="([^"]+)"') |
  ForEach-Object { [pscustomobject]@{ id=$_.Groups[1].Value; nick=[Net.WebUtility]::HtmlDecode($_.Groups[2].Value) } } |
  Sort-Object id -Unique
if (-not $site) { throw 'No heroes found on the official heroes index (page layout changed?)' }
Write-Host "Site: $(@($site).Count) heroes"

$rawByKey = @{}; foreach ($h in $raw) { $rawByKey[(Key $h.name)] = $h }
$display = @{}  # site id -> display name
foreach ($s in $site) {
  $k = Key $s.nick
  $display[$s.id] = if ($rawByKey.ContainsKey($k)) { $rawByKey[$k].name } else { TitleCase $s.nick }
}
$known = @{}; foreach ($n in $display.Values) { $known[(Key $n)] = $n }; foreach ($h in $raw) { $known[(Key $h.name)] = $h.name }

$log = New-Object System.Collections.ArrayList
function Note([string]$s) { [void]$log.Add($s) }

foreach ($s in $site) {
  $page = Get-Page "$Base/$($s.id)/index.html"
  $dm = [regex]::Match($page, '(?s)window\.__HERO_DATA__\s*=\s*(\{.*?\})\s*;?\s*</script>')
  if (-not $dm.Success) { Write-Warning "$($s.nick): no __HERO_DATA__, skipped"; continue }
  $d = ConvertFrom-Json $dm.Groups[1].Value
  $name = $display[$s.id]
  $hero = $rawByKey[(Key $name)]
  if (-not $hero) {
    $role = TitleCase ([string]@($d.jobs)[0])
    $hero = [pscustomobject]@{ name=$name; role=$role; tus=(New-Object System.Collections.ArrayList) }
    # insert after the last hero of the same role
    $at = -1; for ($i = 0; $i -lt $raw.Count; $i++) { if ($raw[$i].role -eq $role) { $at = $i } }
    $raw.Insert($at + 1, $hero); $rawByKey[(Key $name)] = $hero
    Note "NEW HERO  $name ($role)"
  }

  $siteTus = @()
  foreach ($t in @($d.teamups)) {
    $tier = @($t.tiers | Where-Object { $_.tier -eq 'base' })[0]
    if (-not $tier) { $tier = @($t.tiers)[0] }
    $desc = [string]$tier.description
    $sm = [regex]::Match($desc, '(?s)^\s*(?:Base Effect:)?\s*(.*?)\s*E?nhanced Effect:\s*(.*)$')
    $b = if ($sm.Success) { $sm.Groups[1].Value } else { $desc }
    $e = if ($sm.Success) { $sm.Groups[2].Value } else { '' }
    $ids = [regex]::Match([string]$t.avatar, 'teamups/([a-z0-9]+)-([a-z0-9]+)/')
    $pid2 = if ($ids.Success) { if ($ids.Groups[1].Value -ne $s.id) { $ids.Groups[1].Value } else { $ids.Groups[2].Value } } else { $null }
    # The partner named in "When teaming up with X," is authoritative. The image
    # path (teamups/<id>-<id>/) is only a fallback: the site reuses images, so
    # its ids often point at an unrelated hero.
    $pt = [regex]::Match($e, '^When .*?team(?:ing|s) up(?: with)? (.+?),')
    $partner = if ($pt.Success -and $known.ContainsKey((Key $pt.Groups[1].Value))) { $known[(Key $pt.Groups[1].Value)] } else { $null }
    if (-not $partner -and $pid2 -and $display.ContainsKey($pid2)) { $partner = $display[$pid2] }
    $siteTus += [pscustomobject]@{ nameKey=(Key $t.name); siteName=[string]$t.name; partner=$partner; base=(Clean $b); enh=(Clean $e); raw=$desc }
  }
  if ($siteTus.Count -eq 2 -and (Key ($siteTus[0].base + $siteTus[0].enh)) -eq (Key ($siteTus[1].base + $siteTus[1].enh))) { foreach ($x in $siteTus) { $x | Add-Member suspect "both loadouts show the same text" } }
  foreach ($x in $siteTus) { if (-not $x.partner) { $x | Add-Member -Force suspect 'partner not found' } }

  foreach ($x in $siteTus) {
    $cur = @($hero.tus | Where-Object { (Key $_.name) -eq $x.nameKey })[0]
    if ($x.PSObject.Properties['suspect']) {
      if ($cur) { Write-Warning "$name / $($cur.name): site entry looks wrong ($($x.suspect)); kept existing"; continue }
      Write-Warning "$name / $($x.siteName): site entry looks wrong ($($x.suspect)); added anyway, please check"
    }
    if (-not $cur) {
      $cur = [pscustomobject]@{ name=(TitleCase $x.siteName); partner=$x.partner; base=$x.base; enh=$x.enh }
      if ($hero.tus.Count -ge 2) { Note "REPLACED  $name / $($hero.tus[$hero.tus.Count-1].name) -> $($cur.name)"; $hero.tus.RemoveAt($hero.tus.Count-1) }
      [void]$hero.tus.Add($cur); Note "NEW TU    $name / $($cur.name) (partner $($x.partner))"
      continue
    }
    if ($x.partner -and $cur.partner -ne $x.partner) { Note "PARTNER   $name / $($cur.name): $($cur.partner) -> $($x.partner)"; $cur.partner = $x.partner }
    foreach ($f in 'base', 'enh') {
      if (-not $x.$f -or (Key $cur.$f) -eq (Key $x.$f)) { continue }
      if ($UpdateText) { Note "TEXT      $name / $($cur.name) ($f) updated from site"; $cur.$f = $x.$f }
      else { Note "SITE DIFF $name / $($cur.name) ($f): site says: $($x.$f)" }
    }
  }
}

# ------------------------------------------------------------- overrides --
foreach ($o in $Overrides) {
  $h = $rawByKey[(Key $o.hero)]; if (-not $h) { continue }
  $t = @($h.tus | Where-Object { (Key $_.name) -eq (Key $o.tu) })[0]; if (-not $t) { continue }
  $field = if ($o.ContainsKey('enh')) { 'enh' } else { 'base' }
  $now = $t.$field
  if ($o.when -and -not $now.Contains($o.when)) { continue }
  if ($o.unless -and $now.Contains($o.unless)) { continue }
  if ($o.ContainsKey('append')) { $t.base = "$($t.base) $($o.append)" }
  else { $t.$field = $o.$field }
  Note "OVERRIDE  $($h.name) / $($t.name) ($field)"
}

foreach ($h in $raw) { if (-not @($site | Where-Object { (Key $_.nick) -eq (Key $h.name) })) { Note "NOT LIVE  $($h.name) (kept as-is, $($h.tus.Count) team-ups)" } }
$log | ForEach-Object { Write-Host $_ }

# ----------------------------------------------------------------- write --
$lines = foreach ($h in $raw) {
  $tus = ($h.tus | ForEach-Object { '[' + ((JsStr $_.name), (JsStr $_.partner), (JsStr $_.base), (JsStr $_.enh) -join ',') + ']' }) -join ','
  '[' + (JsStr $h.name) + ',' + $codeOf[$h.role] + ',[' + $tus + ']],'
}
$block = $m.Groups[1].Value + ($lines -join $nl) + $m.Groups[3].Value
$out = $text.Substring(0, $m.Index) + $block + $text.Substring($m.Index + $m.Length)
if ($DryRun) { Write-Host "Dry run: $($raw.Count) heroes, index.html not written."; return }
if ($out -eq $text) { Write-Host 'No changes.'; return }
[IO.File]::WriteAllText((Resolve-Path $Html), $out, (New-Object Text.UTF8Encoding $false))
Write-Host "Wrote $($raw.Count) heroes to $Html"
