Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$gameRoot = Split-Path -Parent $PSScriptRoot
$skillImageCli = 'C:\Users\Administrator\.codex\skills\comfyui-flux-imagegen\scripts\comfyui_image.js'
$assetDir = Join-Path $gameRoot 'assets'
$outputDir = Join-Path $repoRoot 'output\comfyui\criminalempire-crew-portraits'
$rawDir = Join-Path $outputDir 'raw'
$logPath = Join-Path $outputDir 'generation-log.json'

New-Item -ItemType Directory -Force -Path $assetDir, $rawDir | Out-Null

$jobs = @(
  @{ Key='shadow'; Name='Shadow'; Prompt='crime empire character portrait, Shadow, Black woman in her late 30s, shadowy fixer in charcoal suit, calm dangerous stare, moody noir alley lighting, cinematic bust portrait, no text' },
  @{ Key='ghost'; Name='Ghost'; Prompt='crime empire character portrait, Ghost, white nonbinary person in their early 20s, elusive operator in pale silver jacket, unreadable expression, cold blue neon haze, cinematic bust portrait, no text' },
  @{ Key='viper'; Name='Viper'; Prompt='crime empire character portrait, Viper, South Asian man in his 40s, ruthless criminal in emerald leather coat, sharp predatory eyes, green nightclub light, cinematic bust portrait, no text' },
  @{ Key='raven'; Name='Raven'; Prompt='crime empire character portrait, Raven, East Asian woman in her early 30s, mastermind in black tailored coat with raven feather motif, moody violet streetlight, cinematic bust portrait, no text' },
  @{ Key='wolf'; Name='Wolf'; Prompt='crime empire character portrait, Wolf, Latino man in his 50s, hardcase enforcer in heavy bomber jacket, scarred face, amber backlight, cinematic bust portrait, no text' },
  @{ Key='phantom'; Name='Phantom'; Prompt='crime empire character portrait, Phantom, Middle Eastern woman in her late 20s, silent thief in matte black turtleneck and gloves, smoky magenta noir lighting, cinematic bust portrait, no text' },
  @{ Key='ace'; Name='Ace'; Prompt='crime empire character portrait, Ace, Black man in his early 30s, stylish high roller in luxe blazer and open collar, casino gold lighting, cinematic bust portrait, no text' },
  @{ Key='blaze'; Name='Blaze'; Prompt='crime empire character portrait, Blaze, white woman in her mid 20s, volatile driver in red street racing jacket, fiery orange city glow, cinematic bust portrait, no text' },
  @{ Key='cipher'; Name='Cipher'; Prompt='crime empire character portrait, Cipher, East Asian man in his late 20s, brilliant strategist in dark techwear, holographic code reflections, cyan neon lighting, cinematic bust portrait, no text' },
  @{ Key='duke'; Name='Duke'; Prompt='crime empire character portrait, Duke, older Black man in his 60s, old money kingpin in velvet suit with signet ring, warm lounge lighting, cinematic bust portrait, no text' },
  @{ Key='echo'; Name='Echo'; Prompt='crime empire character portrait, Echo, Latina woman in her early 40s, surveillance specialist with sleek headset and trench coat, cool rain soaked neon, cinematic bust portrait, no text' },
  @{ Key='frost'; Name='Frost'; Prompt='crime empire character portrait, Frost, Indigenous man in his mid 30s, cold precision hitter in pale coat with icy stare, blue white urban night lighting, cinematic bust portrait, no text' }
)

$results = New-Object System.Collections.Generic.List[object]

foreach ($job in $jobs) {
  $targetPath = Join-Path $assetDir ("crew_" + $job.Key + ".png")
  Write-Host "Generating $($job.Name)..."

  $json = & node $skillImageCli `
    --prompt $job.Prompt `
    --width 768 `
    --height 768 `
    --steps 20 `
    --wait `
    --no-enhance `
    --filename-prefix ("criminalempire/crew_" + $job.Key)

  if ($LASTEXITCODE -ne 0) {
    throw "Image generation failed for $($job.Name)"
  }

  $result = $json | ConvertFrom-Json
  $imageUrl = $result.imageUrls | Select-Object -First 1
  if (-not $imageUrl) {
    throw "No image URL returned for $($job.Name)"
  }

  $rawPath = Join-Path $rawDir ("crew_" + $job.Key + ".png")
  Invoke-WebRequest -Uri $imageUrl -OutFile $rawPath
  Copy-Item -Path $rawPath -Destination $targetPath -Force

  $results.Add([pscustomobject]@{
    Key = $job.Key
    Name = $job.Name
    Target = $targetPath
    PromptId = $result.promptId
    SourceUrl = $imageUrl
    Status = 'generated'
  })
}

$results | ConvertTo-Json -Depth 5 | Set-Content -Path $logPath -Encoding utf8
Write-Host "Criminal Empire crew portraits ready."
Write-Host "Assets: $assetDir"
Write-Host "Log: $logPath"
