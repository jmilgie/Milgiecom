Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$gameRoot = Split-Path -Parent $PSScriptRoot
$skillAudioCli = 'C:\Users\Administrator\.codex\skills\comfyui-flux-imagegen\scripts\comfyui_audio.js'
$assetDir = Join-Path $gameRoot 'assets\audio'
$outputDir = Join-Path $repoRoot 'output\comfyui\emberhollow-audio-pack'
$rawDir = Join-Path $outputDir 'raw'
$logPath = Join-Path $outputDir 'generation-log.json'

New-Item -ItemType Directory -Force -Path $assetDir, $rawDir | Out-Null

$jobs = @(
  @{ Key='theme-town'; Mode='music'; Duration=20; Prompt='warm adventurous fantasy town theme, lute, light hand percussion, soft whistles, cozy heroic exploration, seamless game loop, instrumental, 96 bpm'; Instrumental=$true; Target='theme-town.mp3' },
  @{ Key='theme-market'; Mode='music'; Duration=20; Prompt='playful bustling fantasy market theme, plucked strings, hand drums, lively woodwinds, seamless game loop, instrumental, 110 bpm'; Instrumental=$true; Target='theme-market.mp3' },
  @{ Key='theme-moss'; Mode='music'; Duration=20; Prompt='mysterious damp cave exploration theme, low drones, glassy chimes, subtle percussion, seamless game loop, instrumental, 78 bpm'; Instrumental=$true; Target='theme-moss.mp3' },
  @{ Key='theme-reservoir'; Mode='music'; Duration=20; Prompt='subterranean reservoir theme, watery synth textures, echoing mallets, pulsing bass, seamless game loop, instrumental, 88 bpm'; Instrumental=$true; Target='theme-reservoir.mp3' },
  @{ Key='theme-echo'; Mode='music'; Duration=20; Prompt='arcane rune cavern theme, shimmering bells, haunting choir pads, rhythmic pulse, seamless game loop, instrumental, 92 bpm'; Instrumental=$true; Target='theme-echo.mp3' },
  @{ Key='theme-archive'; Mode='music'; Duration=20; Prompt='moonlit archive exploration theme, delicate piano, airy strings, magical discovery, seamless game loop, instrumental, 84 bpm'; Instrumental=$true; Target='theme-archive.mp3' },
  @{ Key='theme-forge'; Mode='music'; Duration=20; Prompt='tense forge dungeon theme, heavy anvils, deep drums, gritty cellos, ember sparks, seamless game loop, instrumental, 104 bpm'; Instrumental=$true; Target='theme-forge.mp3' },
  @{ Key='theme-boss'; Mode='music'; Duration=18; Prompt='dark final boss battle theme, massive drums, distorted choir pads, urgent ostinato strings, relentless tension, seamless game loop, instrumental, 128 bpm'; Instrumental=$true; Target='theme-boss.mp3' },
  @{ Key='sfx-shoot'; Mode='sfx'; Duration=2; Prompt='magical energy bolt shot, bright crack and sparkling trail, short game weapon sound'; Negative='voice, speech, vocals, melody, music'; Target='sfx-shoot.mp3' },
  @{ Key='sfx-hit'; Mode='sfx'; Duration=2; Prompt='arcane projectile impact on stone and armor, punchy magical hit, short game combat sound'; Negative='voice, speech, vocals, melody, music'; Target='sfx-hit.mp3' },
  @{ Key='sfx-enemyDown'; Mode='sfx'; Duration=3; Prompt='fantasy monster defeat burst, collapsing magical shell and shard scatter, satisfying game enemy defeat sound'; Negative='voice, speech, vocals, melody, music'; Target='sfx-enemyDown.mp3' },
  @{ Key='sfx-pickup'; Mode='sfx'; Duration=2; Prompt='small crystal pickup, bright twinkle, satisfying collect game sound'; Negative='voice, speech, vocals, melody, music'; Target='sfx-pickup.mp3' },
  @{ Key='sfx-unlock'; Mode='sfx'; Duration=3; Prompt='ancient puzzle unlock, stone mechanism click, magical chord rise, satisfying door unlock game sound'; Negative='voice, speech, vocals'; Target='sfx-unlock.mp3' },
  @{ Key='sfx-hurt'; Mode='sfx'; Duration=2; Prompt='hero damage impact, blunt hit with arcane sting, short game hurt sound, no voice'; Negative='voice, speech, vocals, melody, music'; Target='sfx-hurt.mp3' },
  @{ Key='sfx-heal'; Mode='sfx'; Duration=3; Prompt='healing fountain blessing, soft ascending chime, warm shimmer, restorative magic sound'; Negative='voice, speech, vocals'; Target='sfx-heal.mp3' },
  @{ Key='sfx-dash'; Mode='sfx'; Duration=2; Prompt='fast aether dash, airy whoosh, magical snap, short movement burst sound'; Negative='voice, speech, vocals, melody, music'; Target='sfx-dash.mp3' },
  @{ Key='sfx-magnet'; Mode='sfx'; Duration=3; Prompt='magnetic rune activation, metallic pull, arcane hum, short utility ability sound'; Negative='voice, speech, vocals, melody, music'; Target='sfx-magnet.mp3' },
  @{ Key='sfx-bossCharge'; Mode='sfx'; Duration=4; Prompt='ominous boss charge-up, deep rising drone, crackling energy, threatening attack tell'; Negative='voice, speech, vocals, melody, music'; Target='sfx-bossCharge.mp3' },
  @{ Key='sfx-nova'; Mode='sfx'; Duration=4; Prompt='huge magical nova burst, radiant explosion, crystalline tail, powerful ultimate ability sound'; Negative='voice, speech, vocals, melody, music'; Target='sfx-nova.mp3' }
)

$results = New-Object System.Collections.Generic.List[object]

foreach ($job in $jobs) {
  $targetPath = Join-Path $assetDir $job.Target
  if (Test-Path $targetPath) {
    Write-Host "Skipping $($job.Key); asset already exists."
    $results.Add([pscustomobject]@{
      Key = $job.Key
      Target = $targetPath
      Status = 'skipped'
    })
    continue
  }

  Write-Host "Generating $($job.Key)..."
  $args = @(
    $skillAudioCli,
    '--mode', $job.Mode,
    '--prompt', $job.Prompt,
    '--duration', [string]$job.Duration,
    '--wait',
    '--save-format', 'mp3',
    '--mp3-quality', '320k',
    '--filename-prefix', "audio/$($job.Key)"
  )

  if ($job.ContainsKey('Negative')) {
    $args += @('--negative-prompt', $job.Negative)
  }
  if ($job.ContainsKey('Instrumental') -and $job.Instrumental) {
    $args += '--instrumental'
  }

  $json = & node @args
  if ($LASTEXITCODE -ne 0) {
    throw "Audio generation failed for $($job.Key)"
  }

  $result = $json | ConvertFrom-Json
  $output = $result.outputs | Select-Object -First 1
  if (-not $output) {
    throw "No output returned for $($job.Key)"
  }

  $viewUrl = if ($output.viewUrl) { $output.viewUrl } else { $output.bestEffortViewUrl }
  if (-not $viewUrl) {
    throw "No downloadable output URL returned for $($job.Key)"
  }

  $rawPath = Join-Path $rawDir "$($job.Key).mp3"
  Invoke-WebRequest -Uri $viewUrl -OutFile $rawPath
  Copy-Item -Path $rawPath -Destination $targetPath -Force

  $results.Add([pscustomobject]@{
    Key = $job.Key
    Target = $targetPath
    PromptId = $result.promptId
    SourceUrl = $viewUrl
    Status = 'generated'
  })
}

$results | ConvertTo-Json -Depth 5 | Set-Content -Path $logPath -Encoding utf8
Write-Host "Audio pack ready."
Write-Host "Assets: $assetDir"
Write-Host "Log: $logPath"
