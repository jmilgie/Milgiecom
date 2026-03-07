Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$gameRoot = Split-Path -Parent $PSScriptRoot
$skillImageCli = 'C:\Users\Administrator\.codex\skills\comfyui-flux-imagegen\scripts\comfyui_image.js'
$assetDir = Join-Path $gameRoot 'assets'
$outputDir = Join-Path $repoRoot 'output\comfyui\criminalempire-ui-art'
$rawDir = Join-Path $outputDir 'raw'
$logPath = Join-Path $outputDir 'generation-log.json'

New-Item -ItemType Directory -Force -Path $assetDir, $rawDir | Out-Null

$jobs = @(
  @{ Key='biz_lemonade'; Prompt='crime empire game icon, gritty urban lemonade stand with cash jar and neon sign, polished mobile game illustration, centered subject, dark transparent-like background, no text' },
  @{ Key='biz_food_cart'; Prompt='crime empire game icon, midnight street food cart with steam and cash drawer, polished mobile game illustration, centered subject, dark transparent-like background, no text' },
  @{ Key='biz_shop'; Prompt='crime empire game icon, corner bodega storefront with glowing sign and cash vibe, polished mobile game illustration, centered subject, dark transparent-like background, no text' },
  @{ Key='biz_restaurant'; Prompt='crime empire game icon, upscale restaurant facade with valet ropes and warm lights, polished mobile game illustration, centered subject, dark transparent-like background, no text' },
  @{ Key='biz_factory'; Prompt='crime empire game icon, industrial factory with smokestacks and conveyor glow, polished mobile game illustration, centered subject, dark transparent-like background, no text' },
  @{ Key='biz_corp'; Prompt='crime empire game icon, sleek corporate tower at night with cyan office lights, polished mobile game illustration, centered subject, dark transparent-like background, no text' },
  @{ Key='biz_bank'; Prompt='crime empire game icon, fortified urban bank with marble entrance and vault glow, polished mobile game illustration, centered subject, dark transparent-like background, no text' },
  @{ Key='biz_casino'; Prompt='crime empire game icon, luxury casino tower with neon marquee and gold trim, polished mobile game illustration, centered subject, dark transparent-like background, no text' },

  @{ Key='click_gloves'; Prompt='crime empire game icon, black leather gloves with brass knuckles sheen, polished mobile game illustration, centered subject, dark transparent-like background, no text' },
  @{ Key='click_rings'; Prompt='crime empire game icon, stack of gold rings with gemstone sparkle, polished mobile game illustration, centered subject, dark transparent-like background, no text' },
  @{ Key='click_watch'; Prompt='crime empire game icon, expensive wristwatch with emerald face and steel shine, polished mobile game illustration, centered subject, dark transparent-like background, no text' },
  @{ Key='click_briefcase'; Prompt='crime empire game icon, luxury briefcase slightly open with cash glow, polished mobile game illustration, centered subject, dark transparent-like background, no text' },
  @{ Key='click_lambo'; Prompt='crime empire game icon, exotic sports car in crimson with city reflections, polished mobile game illustration, centered subject, dark transparent-like background, no text' },
  @{ Key='click_yacht'; Prompt='crime empire game icon, luxury yacht under moonlight with gold cabin lights, polished mobile game illustration, centered subject, dark transparent-like background, no text' },
  @{ Key='click_jet'; Prompt='crime empire game icon, private jet with sleek chrome finish and runway lights, polished mobile game illustration, centered subject, dark transparent-like background, no text' },

  @{ Key='storage_mattress'; Prompt='crime empire game icon, hidden cash stash in worn mattress with money peeking out, polished mobile game illustration, centered subject, dark transparent-like background, no text' },
  @{ Key='storage_safe'; Prompt='crime empire game icon, steel home safe with combination dial and green glow, polished mobile game illustration, centered subject, dark transparent-like background, no text' },
  @{ Key='storage_vault'; Prompt='crime empire game icon, heavy vault door with gold bars and cool blue highlights, polished mobile game illustration, centered subject, dark transparent-like background, no text' },
  @{ Key='storage_offshore'; Prompt='crime empire game icon, secluded offshore island villa with private dock and money vibe, polished mobile game illustration, centered subject, dark transparent-like background, no text' },

  @{ Key='crew_enforcer'; Prompt='crime empire character portrait, intimidating enforcer in tailored suit, scarred knuckles, moody neon alley lighting, cinematic game portrait, centered bust shot, no text' },
  @{ Key='crew_hacker'; Prompt='crime empire character portrait, elite hacker with glowing monitors reflected in glasses, dark hoodie, cyber blue lighting, cinematic game portrait, centered bust shot, no text' },
  @{ Key='crew_driver'; Prompt='crime empire character portrait, wheelman in bomber jacket with muscle car headlights behind, amber streetlight glow, cinematic game portrait, centered bust shot, no text' },
  @{ Key='crew_smuggler'; Prompt='crime empire character portrait, smuggler with luxury cargo case and harbor night fog, violet rim light, cinematic game portrait, centered bust shot, no text' },
  @{ Key='crew_insider'; Prompt='crime empire character portrait, charismatic insider in masquerade club attire, pink gold club lighting, cinematic game portrait, centered bust shot, no text' },

  @{ Key='casino_slots'; Prompt='crime empire casino mode icon, chrome slot machine with emerald neon glow, polished mobile game illustration, centered subject, dark transparent-like background, no text' },
  @{ Key='casino_dice'; Prompt='crime empire casino mode icon, pair of luxe dice with gold edges and crimson pips, polished mobile game illustration, centered subject, dark transparent-like background, no text' },
  @{ Key='casino_roulette'; Prompt='crime empire casino mode icon, roulette wheel with dramatic spotlight and gold trim, polished mobile game illustration, centered subject, dark transparent-like background, no text' },
  @{ Key='mode_classic'; Prompt='crime empire casino mode icon, vintage slot lever and cherries motif reimagined in luxe noir style, polished mobile game illustration, centered subject, dark transparent-like background, no text' },
  @{ Key='mode_mega'; Prompt='crime empire casino mode icon, crystal jackpot emblem with stacked reels and gold burst, polished mobile game illustration, centered subject, dark transparent-like background, no text' }
)

$results = New-Object System.Collections.Generic.List[object]

foreach ($job in $jobs) {
  $targetPath = Join-Path $assetDir ($job.Key + '.png')
  Write-Host "Generating $($job.Key)..."

  $json = & node $skillImageCli `
    --prompt $job.Prompt `
    --width 768 `
    --height 768 `
    --steps 20 `
    --wait `
    --no-enhance `
    --filename-prefix ("criminalempire/" + $job.Key)

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
  Copy-Item -Path $rawPath -Destination $targetPath -Force

  $results.Add([pscustomobject]@{
    Key = $job.Key
    Target = $targetPath
    PromptId = $result.promptId
    SourceUrl = $imageUrl
    Status = 'generated'
  })
}

$results | ConvertTo-Json -Depth 5 | Set-Content -Path $logPath -Encoding utf8
Write-Host "Criminal Empire UI art ready."
Write-Host "Assets: $assetDir"
Write-Host "Log: $logPath"
