Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$pythonExe = 'C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe'
$imageGenCli = 'C:\Users\Administrator\.codex\skills\imagegen\scripts\image_gen.py'
$assetDir = Join-Path $repoRoot 'games\assets\catalog'
$outputDir = Join-Path $repoRoot 'output\imagegen\games-catalog-art'
$logPath = Join-Path $outputDir 'generation-log.json'

New-Item -ItemType Directory -Force -Path $assetDir, $outputDir | Out-Null

$env:OPENAI_API_KEY = [Environment]::GetEnvironmentVariable('OPENAI_API_KEY', 'User')
if (-not $env:OPENAI_API_KEY) {
  throw 'OPENAI_API_KEY is not set in the user environment.'
}

$sharedConstraints = 'no text anywhere in the artwork, no watermark, no logos, no borders, no environmental signage with words'
$sharedComposition = 'wide banner, strong focal point, safe darker lower third for overlay UI copy, keep the frame readable behind catalog text'
$sharedStyle = 'premium game key art, polished poster composition'

$jobs = @(
  @{
    Key = 'emberhollow'
    Prompt = 'Emberhollow'
    Scene = 'browser game catalog banner for a fantasy action adventure set above a luminous cave town'
    Subject = 'lantern-lit village edge, glowing cave mouth, ancient runes, ember sparks, adventurous atmosphere'
    Lighting = 'warm amber firelight against cool teal cave glow, cinematic dusk'
    Palette = 'ember orange, teal, deep forest green, midnight blue'
  },
  @{
    Key = 'criminal-empire'
    Prompt = 'Criminal Empire'
    Scene = 'browser game catalog banner for a stylish crime empire idle strategy game'
    Subject = 'rain-soaked city skyline, luxury safe full of cash, noir getaway car lights, criminal underworld atmosphere'
    Lighting = 'electric blue and violet night with amber and red highlights'
    Palette = 'blue, violet, black, amber, red'
  },
  @{
    Key = 'nexus-protocol'
    Prompt = 'Nexus Protocol'
    Scene = 'browser game catalog banner for a cyberpunk signal-routing puzzle'
    Subject = 'glowing network core, branching neon data paths, tactical sci-fi interface'
    Lighting = 'electric cyan and magenta neon with deep black contrast'
    Palette = 'cyan, magenta, indigo, black'
  },
  @{
    Key = 'lucky-7s-casino'
    Prompt = 'Lucky 7s Casino'
    Scene = 'browser game catalog banner for a glamorous slot machine casino game'
    Subject = 'luxury slot reels, gold chips, neon marquee glow, polished casino floor reflections, jackpot atmosphere'
    Lighting = 'Vegas gold, ruby neon, emerald accents, glossy reflections'
    Palette = 'gold, crimson, emerald, black'
  },
  @{
    Key = 'void-runner'
    Prompt = 'Void Runner'
    Scene = 'browser game catalog banner for a fast cyber-action shooter inside a corrupted server world'
    Subject = 'armored runner silhouette, shattered digital corridor, energy weapon trails, rogue AI core in the distance'
    Lighting = 'magenta and cyan neon with intense black shadows'
    Palette = 'magenta, cyan, black, steel blue'
  }
)

$results = New-Object System.Collections.Generic.List[object]

foreach ($job in $jobs) {
  $targetPath = Join-Path $assetDir ($job.Key + '.png')
  Write-Host "Generating $($job.Key)..."

  & $pythonExe $imageGenCli generate `
    --prompt $job.Prompt `
    --use-case 'stylized-concept' `
    --scene $job.Scene `
    --subject $job.Subject `
    --style $sharedStyle `
    --composition $sharedComposition `
    --lighting $job.Lighting `
    --palette $job.Palette `
    --constraints $sharedConstraints `
    --negative 'words, letters, numbers, subtitle, caption, signage, marquee copy, poster copy, UI labels, watermark, logo, crowded typography' `
    --quality high `
    --size 1536x1024 `
    --output-format png `
    --no-augment `
    --out $targetPath `
    --force

  if ($LASTEXITCODE -ne 0) {
    throw "Image generation failed for $($job.Key)"
  }

  $results.Add([pscustomobject]@{
    Key = $job.Key
    Target = $targetPath
    Status = 'generated'
  })
}

$results | ConvertTo-Json -Depth 5 | Set-Content -Path $logPath -Encoding utf8
Write-Host "Catalog tile art ready."
Write-Host "Assets: $assetDir"
Write-Host "Log: $logPath"
