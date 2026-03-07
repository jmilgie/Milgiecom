Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$gameRoot = Split-Path -Parent $PSScriptRoot
$skillImageCli = 'C:\Users\Administrator\.codex\skills\comfyui-flux-imagegen\scripts\comfyui_image.js'
$catalogDir = Join-Path $repoRoot 'games\assets\catalog'
$worldDir = Join-Path $gameRoot 'assets\world'
$outputDir = Join-Path $repoRoot 'output\comfyui\neonfrontier-core-art'
$rawDir = Join-Path $outputDir 'raw'
$logPath = Join-Path $outputDir 'generation-log.json'

New-Item -ItemType Directory -Force -Path $catalogDir, $worldDir, $outputDir, $rawDir | Out-Null

$sharedConstraints = 'no text, no letters, no numbers, no watermark, no logo, no signature, no UI labels, no snow, no winter apocalypse, no duplicate buildings'

$jobs = @(
  @{
    Key = 'neon-frontier'
    Target = Join-Path $catalogDir 'neon-frontier.png'
    Width = 1536
    Height = 1024
    Prefix = 'neonfrontier/catalog'
    Prompt = 'browser game catalog banner, bright light and airy cyberpunk synthwave strategy game, radiant megacity built around a glowing orange energy spire, isometric city blocks, overland frontier routes, polished premium key art, cyan magenta gold palette, no text, no logo, no watermark'
  },
  @{
    Key = 'intro-keyart'
    Target = Join-Path $worldDir 'intro-keyart.png'
    Width = 1536
    Height = 1024
    Prefix = 'neonfrontier/intro'
    Prompt = 'hero key art for a browser strategy game called Neon Frontier, bright airy synthwave megacity rising over a warm frontier, luminous orange helio core, sleek glass towers, drone traffic, overland map glow in the distance, premium cinematic illustration, no text, no logo, no watermark'
  },
  @{
    Key = 'world-map'
    Target = Join-Path $worldDir 'world-map.png'
    Width = 1536
    Height = 1024
    Prefix = 'neonfrontier/world'
    Prompt = 'stylized overland frontier map for a cyber synthwave city builder, glowing route lines, radiant districts, relay towers, salvage basins, heat vents, luminous topographic terrain, bright daytime neon palette, premium strategy game illustration, no text, no logo, no watermark'
  },
  @{
    Key = 'city-plate'
    Target = Join-Path $worldDir 'city-plate.png'
    Width = 1536
    Height = 1024
    Prefix = 'neonfrontier/city'
    Prompt = 'isometric city base plate for a bright airy cyberpunk synthwave browser strategy game, radiant megacity plaza, build pads, glowing transit lanes, water district, market district, helio core at center, polished mobile strategy illustration, no text, no logo, no watermark'
  }
)

$results = New-Object System.Collections.Generic.List[object]

foreach ($job in $jobs) {
  Write-Host "Generating $($job.Key)..."

  $promptText = "$($job.Prompt), $sharedConstraints"

  $json = & node $skillImageCli `
    --prompt $promptText `
    --width $job.Width `
    --height $job.Height `
    --steps 20 `
    --wait `
    --no-enhance `
    --filename-prefix $job.Prefix

  if ($LASTEXITCODE -ne 0) {
    throw "Image generation failed for $($job.Key)"
  }

  $result = $json | ConvertFrom-Json
  $imageUrl = $result.imageUrls | Select-Object -First 1
  if (-not $imageUrl) {
    throw "No image URL returned for $($job.Key)"
  }

  $rawPath = Join-Path $rawDir ($job.Key + '.png')
  Invoke-WebRequest -Uri $imageUrl -OutFile $rawPath
  Copy-Item -Path $rawPath -Destination $job.Target -Force

  $results.Add([pscustomobject]@{
    Key = $job.Key
    Target = $job.Target
    PromptId = $result.promptId
    SourceUrl = $imageUrl
    Status = 'generated'
  })
}

$results | ConvertTo-Json -Depth 5 | Set-Content -Path $logPath -Encoding utf8
Write-Host "Neon Frontier art ready."
Write-Host "World art: $worldDir"
Write-Host "Catalog art: $catalogDir"
Write-Host "Log: $logPath"
