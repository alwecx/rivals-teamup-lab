<#
  check-sim-data.ps1 - validate the simulator's hero models (data/sim/*.js)
  against data/sim/README.md. Prints "OK <file>" or a list of problems.

  Usage (repo root):
    powershell -ExecutionPolicy Bypass -File tools\check-sim-data.ps1
    powershell -ExecutionPolicy Bypass -File tools\check-sim-data.ps1 -Path data\sim\strategists-a.js
#>
param([string[]]$Path = @(Get-ChildItem (Join-Path $PSScriptRoot '..\data\sim') -Filter *.js | ForEach-Object FullName))
$ErrorActionPreference = 'Stop'

$official = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\data\official-stats.js'))
$heroNames = @{}
[regex]::Matches($official, '(?m)^    "((?:[^"\\]|\\.)+)":\{') | ForEach-Object { $heroNames[$_.Groups[1].Value] = 1 }

$kinds   = 'weapon','channel','cast','field'
$aims    = 'hitscan','projectile','beam','melee','aoe','auto'
$targets = 'self','ally','allyOrSelf','allies','others','target','enemies','attackers'
$need = @{
  dmg=@('amt'); heal=@('amt'); hot=@('hps','dur'); dot=@('dps','dur'); bonus=@('amt'); barrier=@('hp');
  dr=@('pct'); invuln=@('dur'); untargetable=@('dur'); healBoost=@('pct'); healBoostDealt=@('pct');
  dmgBoost=@('pct'); vuln=@('pct','dur'); antiHeal=@('pct','dur'); cc=@('dur','kind'); slow=@('pct','dur');
  lifesteal=@('pct'); echo=@('pct'); share=@('pct'); regen=@('hps','delay'); cdr=@('sec','action');
  cleanse=@(); revive=@('hpPct'); weaken=@('pct','dur'); blind=@('pct','dur'); ccImmune=@(); cheatDeath=@('hp')
}
$ccKinds = 'stun','freeze','sleep','knock','root'
$useRx = '^(always|cd|never|enemyNear|underFire|engage|(allyHp|othersHp|selfHp|teamHp|targetHp)<(0?\.\d+|1(\.0+)?))$'
$seen = @{}
$total = 0

function Has($o, $k) { $null -ne $o -and $o.PSObject.Properties[$k] -and $null -ne $o.$k }
function Num($v) { $v -is [int] -or $v -is [long] -or $v -is [double] -or $v -is [decimal] }

foreach ($file in $Path) {
  $errs = New-Object System.Collections.ArrayList
  $Err = { param($m) [void]$errs.Add($m) }
  $text = [IO.File]::ReadAllText((Resolve-Path $file))
  $blocks = [regex]::Matches($text, '(?ms)^SIM_DEF\((\{.*?^\})\);\s*$')
  $stray = ([regex]::Matches($text, 'SIM_DEF\(')).Count
  if ($stray -ne $blocks.Count) { & $Err "found $stray SIM_DEF( but only $($blocks.Count) well-formed blocks (each must start a line and end with '});' on its own line)" }
  foreach ($b in $blocks) {
    $line = ($text.Substring(0, $b.Index) -split "`n").Count
    try { $h = ConvertFrom-Json $b.Groups[1].Value } catch { & $Err "line ${line}: not strict JSON - $($_.Exception.Message.Split([Environment]::NewLine)[0])"; continue }
    $hn = "$($h.name)$(if (Has $h 'variant') { " ($($h.variant))" })"
    $HLbl = "line $line $hn"
    if (-not (Has $h 'name') -or (-not $heroNames.ContainsKey($h.name) -and -not ((Has $h 'provisional') -and $h.provisional))) { & $Err "${HLbl}: name '$($h.name)' is not a hero in official-stats.js (mark unreleased heroes \"provisional\": true)" }
    if ($seen.ContainsKey($hn)) { & $Err "${HLbl}: defined twice (also in $($seen[$hn]))" } else { $seen[$hn] = [IO.Path]::GetFileName($file) }
    if ('Vanguard','Duelist','Strategist' -notcontains $h.role) { & $Err "${HLbl}: bad role '$($h.role)'" }
    if (-not (Num $h.hp) -or $h.hp -le 0) { & $Err "${HLbl}: hp must be a positive number" }
    if (-not (Has $h 'notes')) { & $Err "${HLbl}: missing notes" }
    $effLists = @()
    if (Has $h 'passives') { $effLists += ,@('passives', $h.passives) }
    $ids = @{}
    foreach ($a in @($h.actions)) {
      $Lbl = "$HLbl / $($a.id)"
      if (-not (Has $a 'id')) { & $Err "${HLbl}: action without id"; continue }
      if ($ids.ContainsKey($a.id)) { & $Err "${Lbl}: duplicate action id" }; $ids[$a.id] = 1
      if ($kinds -notcontains $a.kind) { & $Err "${Lbl}: bad kind '$($a.kind)'" }
      if (-not (Has $a 'name')) { & $Err "${Lbl}: missing name" }
      if (-not (Has $a 'use')) { & $Err "${Lbl}: missing use" } else { foreach ($u in ($a.use -split '\|')) { if ($u -notmatch $useRx) { & $Err "${Lbl}: bad use condition '$u'" } } }
      $shoots = (Has $a 'dmg') -or (Has $a 'heal')
      if ($shoots -and $aims -notcontains $a.aim) { & $Err "${Lbl}: dmg/heal needs aim in ($($aims -join ', '))" }
      if ((Has $a 'aim') -and $aims -notcontains $a.aim) { & $Err "${Lbl}: bad aim '$($a.aim)'" }
      if ('weapon','channel' -contains $a.kind -and (-not (Num $a.cycle) -or $a.cycle -le 0)) { & $Err "${Lbl}: $($a.kind) needs cycle > 0" }
      if ('channel','field' -contains $a.kind -and -not (Num $a.dur)) { & $Err "${Lbl}: $($a.kind) needs dur" }
      if ($a.kind -eq 'weapon' -and (Has $a 'cd')) { & $Err "${Lbl}: weapons have no cd (use a cast/channel)" }
      if ('cast','channel','field' -contains $a.kind -and -not (Has $a 'cd') -and -not (Has $a 'ult')) { & $Err "${Lbl}: non-ult $($a.kind) needs cd" }
      if (-not (Num $a.range)) { & $Err "${Lbl}: missing numeric range" }
      if ((Has $a 'falloff') -and (@($a.falloff).Count -ne 3)) { & $Err "${Lbl}: falloff must be [start, end, minFraction]" }
      if ((Has $a 'targets') -and $a.targets -ne 1 -and $a.targets -ne 'all') { & $Err "${Lbl}: targets must be 1 or ""all""" }
      if (Has $a 'enhanced') {
        if (-not (Has $a.enhanced 'partner') -or -not $heroNames.ContainsKey($a.enhanced.partner)) { & $Err "${Lbl}: enhanced.partner '$($a.enhanced.partner)' is not a hero" }
        if (-not (Has $a 'teamup')) { & $Err "${Lbl}: enhanced without teamup" }
      }
      foreach ($k in 'onCast','onHit','tick') { if (Has $a $k) { $effLists += ,@("$($a.id).$k", $a.$k) }; if ((Has $a 'enhanced') -and (Has $a.enhanced $k)) { $effLists += ,@("$($a.id).enhanced.$k", $a.enhanced.$k) } }
      if ($a.kind -ne 'field' -and (Has $a 'tick')) { & $Err "${Lbl}: only fields have tick" }
    }
    foreach ($a in @($h.actions)) {
      if ((Has $a 'overrides')) {
        if (-not (Has $a 'teamup')) { & $Err "$HLbl / $($a.id): overrides is only for team-up actions" }
        elseif (-not $ids.ContainsKey([string]$a.overrides)) { & $Err "$HLbl / $($a.id): overrides '$($a.overrides)' is not an action id" }
      }
    }
    if (-not @($h.actions).Count) { & $Err "${HLbl}: no actions" }
    foreach ($pair in $effLists) {
      foreach ($f in @($pair[1])) {
        $FLbl = "$HLbl / $($pair[0]) {t:$($f.t)}"
        if (-not $need.ContainsKey([string]$f.t)) { & $Err "${FLbl}: unknown effect type"; continue }
        foreach ($r in $need[$f.t]) { if (-not (Has $f $r)) { & $Err "${FLbl}: missing '$r'" } }
        if ((Has $f 'to') -and $targets -notcontains $f.to) { & $Err "${FLbl}: bad to '$($f.to)'" }
        if ($f.t -eq 'cc' -and $ccKinds -notcontains $f.kind) { & $Err "${FLbl}: cc kind must be one of $($ccKinds -join ', ')" }
        if ($f.t -eq 'cdr' -and $f.action -ne 'all' -and -not $ids.ContainsKey([string]$f.action)) { & $Err "${FLbl}: cdr action '$($f.action)' is not an action id" }
      }
    }
    $total++
  }
  if ($errs.Count) { Write-Host "FAIL $file"; $errs | ForEach-Object { Write-Host "  - $_" } } else { Write-Host "OK $file ($($blocks.Count) heroes)" }
}
Write-Host "$total hero models checked."
