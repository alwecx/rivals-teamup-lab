<#
  fetch-avatars.ps1 - fill in missing hero icons in ./avatars from the
  community Marvel Rivals Wiki (marvelrivals.fandom.com), the same source as
  the bundled pack.

  For every hero in index.html's RAW table it checks the three tiers the app
  looks for:
    Hero_Icon_<Name>.webp              normal
    Lord_Icon_<Name>.webp              enhanced available
    Champion_Icon_<Name>_Animated.webp enhanced and active (animated)
  Missing files are looked up on the wiki (.webp, then .png, then .gif
  originals) and saved as .webp - the wiki's image CDN serves webp (animated
  for .gif originals) when the request accepts it.
  Existing files are never overwritten. Tiers the wiki does not have yet are
  just reported; the app falls back Champion -> Lord -> Normal -> text.

  Usage (repo root):  powershell -ExecutionPolicy Bypass -File tools\fetch-avatars.ps1
#>
param(
  [string]$Html = (Join-Path $PSScriptRoot '..\index.html'),
  [string]$Dir  = (Join-Path $PSScriptRoot '..\avatars')
)
$ErrorActionPreference = 'Stop'
$UA  = 'rivals-teamup-lab/1.0 (avatar fetch script)'
$Api = 'https://marvelrivals.fandom.com/api.php'
# wiki file names that differ from the in-game display name
$Alias = @{ 'Gorr the God Butcher' = 'Gorr' }

$text  = [IO.File]::ReadAllText((Resolve-Path $Html))
$names = [regex]::Matches($text, '(?m)^\["((?:[^"\\]|\\.)+)",[VDS],') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique

function Find-WikiFile([string[]]$titles) {
  $q = 'action=query&format=json&prop=imageinfo&iiprop=url|mime&titles=' + [uri]::EscapeDataString(($titles | ForEach-Object { "File:$_" }) -join '|')
  $r = Invoke-RestMethod -Uri "$Api`?$q" -UserAgent $UA
  foreach ($t in $titles) {   # keep caller's preference order
    $want = 'File:' + ($t -replace '_', ' ')
    foreach ($p in $r.query.pages.PSObject.Properties.Value) {
      if ($p.title -eq $want -and $p.imageinfo) { return $p.imageinfo[0].url }
    }
  }
  $null
}

$got = 0; $missing = @()
foreach ($n in $names) {
  $file = $n -replace '[ &]+', '_'
  $wiki = @($file); if ($Alias.ContainsKey($n)) { $wiki += ($Alias[$n] -replace '[ &]+', '_') }
  $tiers = @(
    @{ out = "Hero_Icon_$file.webp";              pre = 'Hero_Icon_';     suf = '' }
    @{ out = "Lord_Icon_$file.webp";              pre = 'Lord_Icon_';     suf = '' }
    @{ out = "Champion_Icon_${file}_Animated.webp"; pre = 'Champion_Icon_'; suf = '_Animated' }
  )
  foreach ($t in $tiers) {
    $dest = Join-Path $Dir $t.out
    if (Test-Path $dest) { continue }
    $cands = foreach ($w in $wiki) { foreach ($ext in 'webp','png','gif') { "$($t.pre)$w$($t.suf).$ext" } }
    $url = Find-WikiFile $cands
    if (-not $url) { $missing += $t.out; continue }
    $tmp = "$dest.part"
    # curl.exe (bundled with Windows 10+) - the CDN 403s some clients/UAs.
    # 'Accept: image/webp' makes the CDN send webp (animated for .gif originals);
    # do NOT add ?format=webp - that 404s/403s for .gif originals.
    & curl.exe -sfL -A $UA -H 'Accept: image/webp' -o $tmp $url
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $tmp)) { Write-Warning "$($t.out): download failed ($url)"; continue }
    $head = [IO.File]::ReadAllBytes($tmp)[0..11]
    if ([Text.Encoding]::ASCII.GetString($head, 0, 4) -ne 'RIFF' -or [Text.Encoding]::ASCII.GetString($head, 8, 4) -ne 'WEBP') {
      Remove-Item $tmp; Write-Warning "$($t.out): wiki did not return webp, skipped ($url)"; continue
    }
    Move-Item $tmp $dest
    Write-Host "added  $($t.out)"; $got++
  }
}
Write-Host "$got icon(s) added."
if ($missing) { Write-Host "Not on the wiki yet:"; $missing | ForEach-Object { Write-Host "  $_" } }
