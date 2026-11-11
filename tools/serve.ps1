param([string]$Root, [int]$Port = 8765)
$types = @{ '.html'='text/html; charset=utf-8'; '.webp'='image/webp'; '.png'='image/png'; '.js'='text/javascript'; '.css'='text/css' }
$l = New-Object Net.HttpListener
$l.Prefixes.Add("http://localhost:$Port/")
$l.Start()
Write-Host "serving $Root on http://localhost:$Port/"
while ($l.IsListening) {
  $c = $l.GetContext()
  $p = [Uri]::UnescapeDataString($c.Request.Url.AbsolutePath.TrimStart('/'))
  if (-not $p) { $p = 'index.html' }
  $f = [IO.Path]::GetFullPath((Join-Path $Root $p))
  if ($f.StartsWith([IO.Path]::GetFullPath($Root)) -and (Test-Path $f -PathType Leaf)) {
    $b = [IO.File]::ReadAllBytes($f)
    $ct = $types[[IO.Path]::GetExtension($f).ToLower()]; if ($ct) { $c.Response.ContentType = $ct }
    $c.Response.OutputStream.Write($b, 0, $b.Length)
  } else { $c.Response.StatusCode = 404 }
  $c.Response.Close()
}
