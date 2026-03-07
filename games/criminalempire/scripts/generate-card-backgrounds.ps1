Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$gameRoot = Split-Path -Parent $PSScriptRoot
$skillImageCli = 'C:\Users\Administrator\.codex\skills\comfyui-flux-imagegen\scripts\comfyui_image.js'
$assetDir = Join-Path $gameRoot 'assets'
$outputDir = Join-Path $repoRoot 'output\comfyui\criminalempire-card-backgrounds'
$rawDir = Join-Path $outputDir 'raw'
$logPath = Join-Path $outputDir 'generation-log.json'

New-Item -ItemType Directory -Force -Path $assetDir, $rawDir | Out-Null

$styleTail = 'empty environment plate, no people, no characters, no signs anywhere, no words, no letters, no numbers, blank walls and surfaces, rain soaked atmosphere, teal and amber reflections, glossy noir game art matching the Criminal Empire title screen, wide card composition, strong readability for overlay UI'

$jobs = @(
  @{ Key='bg_biz_lemonade'; Prompt="cinematic crime empire card background, illicit lemonade stand in a narrow backstreet, $styleTail" },
  @{ Key='bg_biz_food_cart'; Prompt="cinematic crime empire card background, midnight street food cart serving as a cash front, $styleTail" },
  @{ Key='bg_biz_shop'; Prompt="cinematic crime empire card background, corner shop front used for laundering cash, $styleTail" },
  @{ Key='bg_biz_restaurant'; Prompt="cinematic crime empire card background, upscale restaurant back entrance with velvet ropes and hidden dealing vibe, $styleTail" },
  @{ Key='bg_biz_factory'; Prompt="cinematic crime empire card background, industrial factory floor with glowing furnaces and conveyor belts, $styleTail" },
  @{ Key='bg_biz_corp'; Prompt="cinematic crime empire card background, sleek corporate office floor at night with skyline reflections and secretive finance mood, $styleTail" },
  @{ Key='bg_biz_bank'; Prompt="cinematic crime empire card background, fortified bank vault corridor with stacked deposit boxes and cold security lighting, $styleTail" },
  @{ Key='bg_biz_casino'; Prompt="cinematic crime empire card background, luxury casino floor with slot glow and polished noir reflections, $styleTail" },

  @{ Key='bg_click_gloves'; Prompt="cinematic crime empire card background, underground boxing locker with leather gloves and cash drops, $styleTail" },
  @{ Key='bg_click_rings'; Prompt="cinematic crime empire card background, jeweler workbench with gemstone rings and hidden cash ledger, $styleTail" },
  @{ Key='bg_click_watch'; Prompt="cinematic crime empire card background, luxury watchmaker desk with steel parts and velvet trays, $styleTail" },
  @{ Key='bg_click_briefcase'; Prompt="cinematic crime empire card background, dark boardroom table with open briefcase and money documents, $styleTail" },
  @{ Key='bg_click_lambo'; Prompt="cinematic crime empire card background, exotic sports car garage with wet floor reflections and underglow, $styleTail" },
  @{ Key='bg_click_yacht'; Prompt="cinematic crime empire card background, luxury yacht deck at night with harbor reflections and contraband vibe, $styleTail" },
  @{ Key='bg_click_jet'; Prompt="cinematic crime empire card background, private jet hangar with runway reflections and stacked cargo cases, $styleTail" },

  @{ Key='bg_storage_mattress'; Prompt="cinematic crime empire card background, shabby apartment hideaway with mattress cash stash, $styleTail" },
  @{ Key='bg_storage_safe'; Prompt="cinematic crime empire card background, small safe room with steel door and hidden bundles, $styleTail" },
  @{ Key='bg_storage_vault'; Prompt="cinematic crime empire card background, vault interior with gold bars and bundled cash, $styleTail" },
  @{ Key='bg_storage_offshore'; Prompt="cinematic crime empire card background, offshore villa office with ocean night glow and hidden accounts mood, $styleTail" },

  @{ Key='bg_special_luck1'; Prompt="cinematic crime empire card background, superstition altar with lucky tokens and cash offerings, $styleTail" },
  @{ Key='bg_special_crit1'; Prompt="cinematic crime empire card background, marksman range booth with crisp spotlight and precision target mood, $styleTail" },
  @{ Key='bg_special_crit2'; Prompt="cinematic crime empire card background, explosive breach scene aftermath with sparks and tactical gear, $styleTail" },
  @{ Key='bg_special_luck2'; Prompt="cinematic crime empire card background, high stakes private gambling lounge with dice table glow, $styleTail" },
  @{ Key='bg_special_crit3'; Prompt="cinematic crime empire card background, scorched alley aftermath with blazing reflections and elite strike vibe, $styleTail" },
  @{ Key='bg_special_luck3'; Prompt="cinematic crime empire card background, fortune teller backroom with crystal glow and shadowy wealth vibe, $styleTail" },

  @{ Key='bg_police_scanner'; Prompt="cinematic crime empire card background, surveillance van interior with radio equipment and signal screens, $styleTail" },
  @{ Key='bg_police_safehouse'; Prompt="cinematic crime empire card background, secure safehouse room with maps, shutters and hidden exits, $styleTail" },
  @{ Key='bg_police_insider'; Prompt="cinematic crime empire card background, courthouse back corridor with confidential files and whispered corruption mood, $styleTail" },
  @{ Key='bg_police_judge'; Prompt="cinematic crime empire card background, dark judicial chamber with marble desk and sealed folders, $styleTail" },
  @{ Key='bg_police_chief'; Prompt="cinematic crime empire card background, police chief office at night with skyline reflections and blue desk glow, $styleTail" },

  @{ Key='bg_heist_corner_store'; Prompt="cinematic crime empire card background, small corner store interior after hours with register glow and aisles, $styleTail" },
  @{ Key='bg_heist_jewelry'; Prompt="cinematic crime empire card background, luxury jewelry showroom with glass displays and cold diamonds glow, $styleTail" },
  @{ Key='bg_heist_bank'; Prompt="cinematic crime empire card background, downtown bank lobby with marble floor and vault corridor, $styleTail" },
  @{ Key='bg_heist_casino'; Prompt="cinematic crime empire card background, casino cage corridor with neon slot spill and hidden cash room, $styleTail" },
  @{ Key='bg_heist_reserve'; Prompt="cinematic crime empire card background, national reserve style bullion chamber with towering shelves and armored doors, $styleTail" }
)

$results = New-Object System.Collections.Generic.List[object]

foreach ($job in $jobs) {
  $targetPath = Join-Path $assetDir ($job.Key + '.png')
  Write-Host "Generating $($job.Key)..."
  $json = & node $skillImageCli `
    --prompt $job.Prompt `
    --width 1536 `
    --height 1024 `
    --steps 20 `
    --timeout-s 120 `
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
Write-Host "Criminal Empire card backgrounds ready."
Write-Host "Assets: $assetDir"
Write-Host "Log: $logPath"
