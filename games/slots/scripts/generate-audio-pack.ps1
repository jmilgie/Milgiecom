Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$gameRoot = Split-Path -Parent $PSScriptRoot
$skillAudioCli = 'C:\Users\Administrator\.codex\skills\comfyui-flux-imagegen\scripts\comfyui_audio.js'
$assetDir = Join-Path $gameRoot 'assets\audio'
$outputDir = Join-Path $repoRoot 'output\comfyui\slots-audio-pack'
$rawDir = Join-Path $outputDir 'raw'
$logPath = Join-Path $outputDir 'generation-log.json'

New-Item -ItemType Directory -Force -Path $assetDir, $rawDir | Out-Null

$jobs = @(
  @{ Key='theme-lucky7s'; Mode='music'; Duration=22; Bpm=112; KeyScale='C minor'; Prompt='vintage vegas casino lounge instrumental, brushed drums, upright bass, vibraphone accents, bright brass stabs, confident slot machine floor energy, seamless game loop'; Instrumental=$true; Target='theme-lucky7s.mp3' },
  @{ Key='theme-fruits'; Mode='music'; Duration=22; Bpm=126; KeyScale='F major'; Prompt='bright tropical casino groove instrumental, marimba hooks, bongos, playful brass, fruity arcade energy, seamless slot game loop'; Instrumental=$true; Target='theme-fruits.mp3' },
  @{ Key='theme-diamonds'; Mode='music'; Duration=22; Bpm=92; KeyScale='D minor'; Prompt='luxury high stakes casino soundtrack instrumental, dark synth pulse, crystalline bells, cinematic bass, elegant tension, seamless slot game loop'; Instrumental=$true; Target='theme-diamonds.mp3' },
  @{ Key='theme-stars'; Mode='music'; Duration=22; Bpm=100; KeyScale='C# minor'; Prompt='cosmic neon casino instrumental, shimmering synth arpeggios, dreamy pads, punchy electronic bass, glossy jackpot atmosphere, seamless slot game loop'; Instrumental=$true; Target='theme-stars.mp3' },
  @{ Key='sfx-spinStart'; Mode='sfx'; Duration=2; Prompt='slot machine spin start, polished mechanical whoosh, button click, arcade casino feel, short game sound'; Negative='voice, speech, vocals, melody, music'; Target='sfx-spinStart.mp3' },
  @{ Key='sfx-reelTick'; Mode='sfx'; Duration=2; Prompt='slot reel ticking, light mechanical click rhythm, crisp arcade machine texture, short game sound'; Negative='voice, speech, vocals, melody, music'; Target='sfx-reelTick.mp3' },
  @{ Key='sfx-reelStop'; Mode='sfx'; Duration=2; Prompt='slot reel stop, satisfying mechanical thunk and cabinet knock, polished casino machine sound'; Negative='voice, speech, vocals, melody, music'; Target='sfx-reelStop.mp3' },
  @{ Key='sfx-smallWin'; Mode='sfx'; Duration=3; Prompt='small slot machine win jingle, short bright casino celebration, charming payout sound'; Negative='voice, speech, vocals'; Target='sfx-smallWin.mp3' },
  @{ Key='sfx-bigWin'; Mode='sfx'; Duration=5; Prompt='big slot machine win fanfare, rising casino celebration, coins and bright synth brass, energetic payout sound'; Negative='voice, speech, vocals'; Target='sfx-bigWin.mp3' },
  @{ Key='sfx-jackpot'; Mode='sfx'; Duration=8; Prompt='massive casino jackpot celebration, triumphant fanfare, raining coins, luxury slot machine climax'; Negative='voice, speech, vocals'; Target='sfx-jackpot.mp3' },
  @{ Key='sfx-coinClink'; Mode='sfx'; Duration=2; Prompt='single casino coin clink, metallic payout accent, crisp arcade machine sound'; Negative='voice, speech, vocals, melody, music'; Target='sfx-coinClink.mp3' },
  @{ Key='sfx-buttonClick'; Mode='sfx'; Duration=2; Prompt='arcade cabinet button click, tactile casino machine press, short ui sound'; Negative='voice, speech, vocals, melody, music'; Target='sfx-buttonClick.mp3' },
  @{ Key='sfx-noMoney'; Mode='sfx'; Duration=2; Prompt='casino machine error buzzer, low credits warning, short negative ui sound'; Negative='voice, speech, vocals, melody, music'; Target='sfx-noMoney.mp3' },
  @{ Key='sfx-freeSpins'; Mode='sfx'; Duration=5; Prompt='free spins award celebration, sparkling bells, uplifting casino bonus jingle'; Negative='voice, speech, vocals'; Target='sfx-freeSpins.mp3' }
)

$results = New-Object System.Collections.Generic.List[object]

foreach ($job in $jobs) {
  $targetPath = Join-Path $assetDir $job.Target

  Write-Host "Generating $($job.Key)..."
  $args = @(
    $skillAudioCli,
    '--mode', $job.Mode,
    '--prompt', $job.Prompt,
    '--duration', [string]$job.Duration,
    '--wait',
    '--save-format', 'mp3',
    '--mp3-quality', '320k',
    '--filename-prefix', "slots/$($job.Key)"
  )

  if ($job.ContainsKey('Bpm')) {
    $args += @('--bpm', [string]$job.Bpm)
  }
  if ($job.ContainsKey('KeyScale')) {
    $args += @('--key-scale', $job.KeyScale)
  }
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
