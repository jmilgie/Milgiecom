Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$gameRoot = Split-Path -Parent $PSScriptRoot
$pythonExe = 'C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe'
$imageGenCli = 'C:\Users\Administrator\.codex\skills\imagegen\scripts\image_gen.py'
$assetDir = Join-Path $gameRoot 'assets'
$outputDir = Join-Path $repoRoot 'output\imagegen\criminalempire-transparent-icons'
$logPath = Join-Path $outputDir 'generation-log.json'

New-Item -ItemType Directory -Force -Path $assetDir, $outputDir | Out-Null

$env:OPENAI_API_KEY = [Environment]::GetEnvironmentVariable('OPENAI_API_KEY', 'User')
if (-not $env:OPENAI_API_KEY) {
  throw 'OPENAI_API_KEY is not set in the user environment.'
}

$sharedStyle = 'glossy premium game icon matching the Criminal Empire title screen, cinematic blue and violet noir shadows with amber highlights, centered composition, isolated object only, no frame, no text, no letters, no numbers, transparent background'

$jobs = @(
  @{ Key='special_luck1'; Subject='a lucky gold horseshoe charm with subtle emerald accents'; Label='Lucky Charm' },
  @{ Key='special_crit1'; Subject='a tactical sniper scope lens with sharp metallic highlights'; Label='Sharp Eye' },
  @{ Key='special_crit2'; Subject='a cracked steel target medallion with kinetic energy sparks'; Label='Crit Master' },
  @{ Key='special_luck2'; Subject='luxury dice and casino chips stacked together'; Label='Gambler' },
  @{ Key='special_crit3'; Subject='a blazing obsidian crest with molten energy veins'; Label='Devastation' },
  @{ Key='special_luck3'; Subject='a radiant crystal fortune talisman with gold chain'; Label='Fortune' },

  @{ Key='police_scanner'; Subject='a covert police radio scanner with blue signal lights'; Label='Scanner' },
  @{ Key='police_safehouse'; Subject='a reinforced safehouse steel door with lock hardware'; Label='Safehouse' },
  @{ Key='police_insider'; Subject='a confidential dossier folder with a red wax seal'; Label='Insider' },
  @{ Key='police_judge'; Subject='a polished judge gavel with dark marble base'; Label='Judge' },
  @{ Key='police_chief'; Subject='a decorated police chief badge and cap insignia'; Label='Chief' },

  @{ Key='heist_corner_store'; Subject='a corner store cash register with scattered bills'; Label='Corner Store' },
  @{ Key='heist_jewelry'; Subject='a diamond necklace in an open velvet case'; Label='Jewelry' },
  @{ Key='heist_bank'; Subject='a steel bank vault wheel with bundled cash'; Label='Bank' },
  @{ Key='heist_casino'; Subject='a luxury casino chip stack with roulette wheel segment'; Label='Casino' },
  @{ Key='heist_reserve'; Subject='a national reserve style gold bar stack with secure seal'; Label='Reserve' }
)

$results = New-Object System.Collections.Generic.List[object]

foreach ($job in $jobs) {
  $targetPath = Join-Path $assetDir ($job.Key + '.png')
  Write-Host "Generating $($job.Key)..."

  & $pythonExe $imageGenCli generate `
    --prompt $job.Subject `
    --use-case 'stylized-concept' `
    --scene 'transparent asset for a crime empire strategy game UI' `
    --style $sharedStyle `
    --composition 'single centered subject, readable at small icon size' `
    --lighting 'cinematic rim light, glossy reflections, controlled contrast' `
    --constraints 'transparent background, no text, no watermark, no extra objects' `
    --negative 'busy scene, background environment, labels, typography, border frame, watermark' `
    --size 1024x1024 `
    --quality high `
    --background transparent `
    --output-format png `
    --no-augment `
    --out $targetPath `
    --force

  if ($LASTEXITCODE -ne 0) {
    throw "Image generation failed for $($job.Key)"
  }

  $results.Add([pscustomobject]@{
    Key = $job.Key
    Label = $job.Label
    Target = $targetPath
    Status = 'generated'
  })
}

$results | ConvertTo-Json -Depth 5 | Set-Content -Path $logPath -Encoding utf8
Write-Host "Transparent icons ready."
Write-Host "Assets: $assetDir"
Write-Host "Log: $logPath"
