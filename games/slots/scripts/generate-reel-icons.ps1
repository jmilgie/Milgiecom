Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$gameRoot = Split-Path -Parent $PSScriptRoot
$skillImageCli = 'C:\Users\Administrator\.codex\skills\comfyui-flux-imagegen\scripts\comfyui_image.js'
$assetDir = Join-Path $gameRoot 'assets\reels'
$outputDir = Join-Path $repoRoot 'output\comfyui\slots-reel-icons'
$rawDir = Join-Path $outputDir 'raw'
$logPath = Join-Path $outputDir 'generation-log.json'

New-Item -ItemType Directory -Force -Path $assetDir, $rawDir | Out-Null

$jobs = @(
  @{ Machine='lucky7s'; Key='highroller'; Prompt='art deco vegas slot reel symbol, single centered roulette sunburst medallion, polished brass and burgundy enamel, luxury casino game icon, dark background, no text, no letters, no border'; Target='lucky7s\highroller.png' },
  @{ Machine='lucky7s'; Key='champagne'; Prompt='art deco vegas slot reel symbol, single centered champagne tower in crystal coupe glasses, polished gold and ivory highlights, luxury casino game icon, dark background, no text, no letters, no border'; Target='lucky7s\champagne.png' },
  @{ Machine='lucky7s'; Key='dice'; Prompt='art deco vegas slot reel symbol, single centered ivory dice pair with ruby pips, polished brass trim, luxury casino game icon, dark background, no text, no letters, no border'; Target='lucky7s\dice.png' },
  @{ Machine='lucky7s'; Key='sax'; Prompt='art deco vegas slot reel symbol, single centered golden saxophone with velvet glow, polished enamel casino icon, dark background, no text, no letters, no border'; Target='lucky7s\sax.png' },
  @{ Machine='lucky7s'; Key='martini'; Prompt='art deco vegas slot reel symbol, single centered crystal martini glass with olive and gold stirrer, polished enamel casino icon, dark background, no text, no letters, no border'; Target='lucky7s\martini.png' },
  @{ Machine='lucky7s'; Key='cufflinks'; Prompt='art deco vegas slot reel symbol, single centered pair of black onyx cufflinks with gold facets, polished casino icon, dark background, no text, no letters, no border'; Target='lucky7s\cufflinks.png' },
  @{ Machine='lucky7s'; Key='lighter'; Prompt='art deco vegas slot reel symbol, single centered vintage gold lighter with small flame glow, polished casino icon, dark background, no text, no letters, no border'; Target='lucky7s\lighter.png' },
  @{ Machine='lucky7s'; Key='chip'; Prompt='art deco vegas slot reel symbol, single centered high roller casino chip with pearl inlay, polished casino icon, dark background, no text, no letters, no border'; Target='lucky7s\chip.png' },
  @{ Machine='lucky7s'; Key='scatter'; Prompt='art deco vegas slot reel symbol, single centered marquee starburst crest with ivory bulbs and gold trim, polished casino icon, dark background, no text, no letters, no border'; Target='lucky7s\scatter.png' },
  @{ Machine='lucky7s'; Key='wild'; Prompt='art deco vegas slot reel symbol, single centered black ace card with radiant gold edge and crimson jewel, polished casino icon, dark background, no text, no letters, no border'; Target='lucky7s\wild.png' },

  @{ Machine='fruits'; Key='jackpot'; Prompt='tropical cabana slot reel symbol, single centered golden tiki idol with coral gemstones, glossy enamel arcade icon, dark background, no text, no letters, no border'; Target='fruits\jackpot.png' },
  @{ Machine='fruits'; Key='parrot'; Prompt='tropical cabana slot reel symbol, single centered scarlet macaw crest portrait badge, glossy enamel arcade icon, dark background, no text, no letters, no border'; Target='fruits\parrot.png' },
  @{ Machine='fruits'; Key='dragonfruit'; Prompt='tropical cabana slot reel symbol, single centered sliced dragon fruit jewel, glossy enamel arcade icon, dark background, no text, no letters, no border'; Target='fruits\dragonfruit.png' },
  @{ Machine='fruits'; Key='coconut'; Prompt='tropical cabana slot reel symbol, single centered chilled coconut drink with orchid garnish, glossy enamel arcade icon, dark background, no text, no letters, no border'; Target='fruits\coconut.png' },
  @{ Machine='fruits'; Key='hibiscus'; Prompt='tropical cabana slot reel symbol, single centered hibiscus blossom with lacquered petals and dew glow, glossy arcade icon, dark background, no text, no letters, no border'; Target='fruits\hibiscus.png' },
  @{ Machine='fruits'; Key='papaya'; Prompt='tropical cabana slot reel symbol, single centered ripe papaya slice with luminous seeds, glossy enamel arcade icon, dark background, no text, no letters, no border'; Target='fruits\papaya.png' },
  @{ Machine='fruits'; Key='lime'; Prompt='tropical cabana slot reel symbol, single centered lime wedge with radiant citrus glow, glossy enamel arcade icon, dark background, no text, no letters, no border'; Target='fruits\lime.png' },
  @{ Machine='fruits'; Key='shell'; Prompt='tropical cabana slot reel symbol, single centered spiral seashell with pearlescent coral sheen, glossy enamel arcade icon, dark background, no text, no letters, no border'; Target='fruits\shell.png' },
  @{ Machine='fruits'; Key='scatter'; Prompt='tropical cabana slot reel symbol, single centered carved sun medallion with turquoise rays, glossy enamel arcade icon, dark background, no text, no letters, no border'; Target='fruits\scatter.png' },
  @{ Machine='fruits'; Key='wild'; Prompt='tropical cabana slot reel symbol, single centered carnival mask with tropical feathers and gold trim, glossy arcade icon, dark background, no text, no letters, no border'; Target='fruits\wild.png' },

  @{ Machine='diamonds'; Key='diamond'; Prompt='luxury vault slot reel symbol, single centered black diamond crown emblem with platinum setting, premium casino icon, dark velvet background, no text, no letters, no border'; Target='diamonds\diamond.png' },
  @{ Machine='diamonds'; Key='ruby'; Prompt='luxury vault slot reel symbol, single centered ruby scarab brooch with gold filigree, premium casino icon, dark velvet background, no text, no letters, no border'; Target='diamonds\ruby.png' },
  @{ Machine='diamonds'; Key='sapphire'; Prompt='luxury vault slot reel symbol, single centered sapphire cufflink pair with platinum shine, premium casino icon, dark velvet background, no text, no letters, no border'; Target='diamonds\sapphire.png' },
  @{ Machine='diamonds'; Key='emerald'; Prompt='luxury vault slot reel symbol, single centered emerald pendant with ornate platinum chain, premium casino icon, dark velvet background, no text, no letters, no border'; Target='diamonds\emerald.png' },
  @{ Machine='diamonds'; Key='amber'; Prompt='luxury vault slot reel symbol, single centered amber perfume bottle with gold cap and glow, premium casino icon, dark velvet background, no text, no letters, no border'; Target='diamonds\amber.png' },
  @{ Machine='diamonds'; Key='crown'; Prompt='luxury vault slot reel symbol, single centered royal crown with ruby and sapphire inlays, premium casino icon, dark velvet background, no text, no letters, no border'; Target='diamonds\crown.png' },
  @{ Machine='diamonds'; Key='locket'; Prompt='luxury vault slot reel symbol, single centered diamond locket with platinum clasp, premium casino icon, dark velvet background, no text, no letters, no border'; Target='diamonds\locket.png' },
  @{ Machine='diamonds'; Key='coin'; Prompt='luxury vault slot reel symbol, single centered embossed platinum casino token with gemstone rim, premium casino icon, dark velvet background, no text, no letters, no border'; Target='diamonds\coin.png' },
  @{ Machine='diamonds'; Key='scatter'; Prompt='luxury vault slot reel symbol, single centered radiant jewel burst with silver sparks, premium casino icon, dark velvet background, no text, no letters, no border'; Target='diamonds\scatter.png' },
  @{ Machine='diamonds'; Key='wild'; Prompt='luxury vault slot reel symbol, single centered black invitation card with platinum edge and diamond seal, premium casino icon, dark velvet background, no text, no letters, no border'; Target='diamonds\wild.png' },

  @{ Machine='stars'; Key='star7'; Prompt='retro futurist cosmic slot reel symbol, single centered nebula core crest with neon gold halo, glossy arcade icon, deep space background, no text, no letters, no border'; Target='stars\star7.png' },
  @{ Machine='stars'; Key='helm'; Prompt='retro futurist cosmic slot reel symbol, single centered astronaut helm with cyan magenta reflections, glossy arcade icon, deep space background, no text, no letters, no border'; Target='stars\helm.png' },
  @{ Machine='stars'; Key='comet'; Prompt='retro futurist cosmic slot reel symbol, single centered comet shard with neon trail, glossy arcade icon, deep space background, no text, no letters, no border'; Target='stars\comet.png' },
  @{ Machine='stars'; Key='eclipse'; Prompt='retro futurist cosmic slot reel symbol, single centered eclipse ring with radiant corona, glossy arcade icon, deep space background, no text, no letters, no border'; Target='stars\eclipse.png' },
  @{ Machine='stars'; Key='satellite'; Prompt='retro futurist cosmic slot reel symbol, single centered chrome satellite with neon fins, glossy arcade icon, deep space background, no text, no letters, no border'; Target='stars\satellite.png' },
  @{ Machine='stars'; Key='drone'; Prompt='retro futurist cosmic slot reel symbol, single centered hover drone orb with blue thrusters, glossy arcade icon, deep space background, no text, no letters, no border'; Target='stars\drone.png' },
  @{ Machine='stars'; Key='ufo'; Prompt='retro futurist cosmic slot reel symbol, single centered luminous flying saucer with magenta beam, glossy arcade icon, deep space background, no text, no letters, no border'; Target='stars\ufo.png' },
  @{ Machine='stars'; Key='star'; Prompt='retro futurist cosmic slot reel symbol, single centered four point crystal star with cyan glow, glossy arcade icon, deep space background, no text, no letters, no border'; Target='stars\star.png' },
  @{ Machine='stars'; Key='scatter'; Prompt='retro futurist cosmic slot reel symbol, single centered galaxy portal spiral with neon dust, glossy arcade icon, deep space background, no text, no letters, no border'; Target='stars\scatter.png' },
  @{ Machine='stars'; Key='wild'; Prompt='retro futurist cosmic slot reel symbol, single centered prism wildcard card with holographic edge, glossy arcade icon, deep space background, no text, no letters, no border'; Target='stars\wild.png' }
)

$results = New-Object System.Collections.Generic.List[object]

foreach ($job in $jobs) {
  $targetPath = Join-Path $assetDir $job.Target
  $targetDir = Split-Path -Parent $targetPath
  New-Item -ItemType Directory -Force -Path $targetDir | Out-Null

  Write-Host "Generating $($job.Machine)/$($job.Key)..."
  $json = & node $skillImageCli `
    --prompt $job.Prompt `
    --width 768 `
    --height 768 `
    --steps 20 `
    --wait `
    --no-enhance `
    --filename-prefix ("slots/" + $job.Machine + "/" + $job.Key)

  if ($LASTEXITCODE -ne 0) {
    throw "Image generation failed for $($job.Machine)/$($job.Key)"
  }

  $result = $json | ConvertFrom-Json
  $imageUrl = $result.imageUrls | Select-Object -First 1
  if (-not $imageUrl) {
    throw "No image URL returned for $($job.Machine)/$($job.Key)"
  }

  $rawPath = Join-Path $rawDir ($job.Machine + '-' + $job.Key + '.png')
  Invoke-WebRequest -Uri $imageUrl -OutFile $rawPath
  Copy-Item -Path $rawPath -Destination $targetPath -Force

  $results.Add([pscustomobject]@{
    Machine = $job.Machine
    Key = $job.Key
    Target = $targetPath
    PromptId = $result.promptId
    SourceUrl = $imageUrl
    Status = 'generated'
  })
}

$results | ConvertTo-Json -Depth 5 | Set-Content -Path $logPath -Encoding utf8
Write-Host "Reel icon pack ready."
Write-Host "Assets: $assetDir"
Write-Host "Log: $logPath"
