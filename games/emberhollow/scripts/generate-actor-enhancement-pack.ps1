Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$gameRoot = Split-Path -Parent $PSScriptRoot
$skillRoot = 'C:\Users\Administrator\.codex\skills\comfyui-flux-imagegen'
$cliPath = Join-Path $skillRoot 'scripts\comfyui_image.js'

$rawDir = Join-Path $repoRoot 'output\comfyui\emberhollow-actor-enhancement-pack\raw'
$validationDir = Join-Path $repoRoot 'output\comfyui\emberhollow-actor-enhancement-pack\validation'
$assetDir = Join-Path $gameRoot 'assets\textures\actors'
$logPath = Join-Path $repoRoot 'output\comfyui\emberhollow-actor-enhancement-pack\generation-log.json'
$manifestPath = Join-Path $repoRoot 'output\comfyui\emberhollow-actor-enhancement-pack\manifest.json'
$contactSheetPath = Join-Path $repoRoot 'output\comfyui\emberhollow-actor-enhancement-pack\contact-sheet.png'

New-Item -ItemType Directory -Force -Path $rawDir, $validationDir, $assetDir | Out-Null

Add-Type -AssemblyName System.Drawing
$drawingAssembly = [System.Drawing.Bitmap].Assembly.Location
Add-Type -ReferencedAssemblies @($drawingAssembly) -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Linq;

public static class EmberImageOps
{
    private static Bitmap ResizedBitmap(string path, int size)
    {
        using (var source = new Bitmap(path))
        {
            var target = new Bitmap(size, size, PixelFormat.Format32bppArgb);
            using (var graphics = Graphics.FromImage(target))
            {
                graphics.Clear(Color.Black);
                graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                graphics.SmoothingMode = SmoothingMode.HighQuality;
                graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
                graphics.CompositingQuality = CompositingQuality.HighQuality;
                graphics.DrawImage(source, new Rectangle(0, 0, size, size));
            }
            return target;
        }
    }

    public static void SaveResizedPng(string sourcePath, string destPath, int size)
    {
        using (var target = ResizedBitmap(sourcePath, size))
        {
            target.Save(destPath, ImageFormat.Png);
        }
    }

    public static void SaveHeightMap(string sourcePath, string destPath, int size, double contrast, double gamma)
    {
        using (var source = ResizedBitmap(sourcePath, size))
        using (var output = new Bitmap(size, size, PixelFormat.Format32bppArgb))
        {
            for (int y = 0; y < size; y++)
            {
                for (int x = 0; x < size; x++)
                {
                    var color = source.GetPixel(x, y);
                    var luminance = ((color.R * 0.299) + (color.G * 0.587) + (color.B * 0.114)) / 255.0;
                    luminance = Math.Pow(Math.Min(1.0, Math.Max(0.0, luminance * contrast)), gamma);
                    var value = (int)Math.Round(luminance * 255.0);
                    var gray = Color.FromArgb(255, value, value, value);
                    output.SetPixel(x, y, gray);
                }
            }
            output.Save(destPath, ImageFormat.Png);
        }
    }

    public static void SaveAlphaMask(string sourcePath, string destPath, int size, double threshold, double gamma)
    {
        using (var source = ResizedBitmap(sourcePath, size))
        using (var output = new Bitmap(size, size, PixelFormat.Format32bppArgb))
        {
            for (int y = 0; y < size; y++)
            {
                for (int x = 0; x < size; x++)
                {
                    var color = source.GetPixel(x, y);
                    var signal = Math.Max(color.R, Math.Max(color.G, color.B)) / 255.0;
                    signal = Math.Max(0.0, (signal - threshold) / Math.Max(0.0001, 1.0 - threshold));
                    signal = Math.Pow(signal, gamma);
                    var value = (int)Math.Round(Math.Min(1.0, signal) * 255.0);
                    var gray = Color.FromArgb(255, value, value, value);
                    output.SetPixel(x, y, gray);
                }
            }
            output.Save(destPath, ImageFormat.Png);
        }
    }

    public static void SaveContactSheet(string[] imagePaths, string[] labels, string destPath, int columns, int tileSize)
    {
        int count = imagePaths.Length;
        int rows = (int)Math.Ceiling(count / (double)columns);
        int labelHeight = 34;
        int width = columns * tileSize;
        int height = rows * (tileSize + labelHeight);
        using (var canvas = new Bitmap(width, height, PixelFormat.Format32bppArgb))
        using (var graphics = Graphics.FromImage(canvas))
        using (var framePen = new Pen(Color.FromArgb(88, 240, 210, 168), 2))
        using (var textBrush = new SolidBrush(Color.FromArgb(236, 231, 219)))
        using (var labelFont = new Font("Segoe UI", 11, FontStyle.Bold))
        {
            graphics.Clear(Color.FromArgb(12, 15, 20));
            graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
            graphics.SmoothingMode = SmoothingMode.HighQuality;
            graphics.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;

            for (int i = 0; i < count; i++)
            {
                int col = i % columns;
                int row = i / columns;
                int x = col * tileSize;
                int y = row * (tileSize + labelHeight);
                using (var image = new Bitmap(imagePaths[i]))
                {
                    graphics.DrawImage(image, new Rectangle(x, y, tileSize, tileSize));
                }
                graphics.DrawRectangle(framePen, x + 1, y + 1, tileSize - 2, tileSize - 2);
                graphics.DrawString(labels[i], labelFont, textBrush, x + 8, y + tileSize + 6);
            }

            canvas.Save(destPath, ImageFormat.Png);
        }
    }
}
"@

$assets = @(
  @{ Name = 'face-elder'; Type = 'face'; Size = 512; Prompt = 'hand-painted fantasy RPG elder face decal, centered front-facing eyes brows nose and mouth only, wise weathered expression, warm parchment skin tones, isolated on a pure black background, no hair, no ears, no frame, no text, crisp decal texture' },
  @{ Name = 'face-smith'; Type = 'face'; Size = 512; Prompt = 'hand-painted fantasy RPG blacksmith face decal, centered front-facing eyes brows nose and mouth only, soot-smudged cheeks, strong practical expression, isolated on a pure black background, no hair, no ears, no frame, no text, crisp decal texture' },
  @{ Name = 'face-bard'; Type = 'face'; Size = 512; Prompt = 'hand-painted fantasy RPG bard face decal, centered front-facing eyes brows nose and mouth only, playful smile, expressive eyes, isolated on a pure black background, no hair, no ears, no frame, no text, crisp decal texture' },
  @{ Name = 'face-cartographer'; Type = 'face'; Size = 512; Prompt = 'hand-painted fantasy RPG cartographer face decal, centered front-facing eyes brows nose and mouth only, focused explorer expression, subtle freckles, isolated on a pure black background, no hair, no ears, no frame, no text, crisp decal texture' },
  @{ Name = 'face-glassweaver'; Type = 'face'; Size = 512; Prompt = 'hand-painted fantasy RPG artisan face decal, centered front-facing eyes brows nose and mouth only, refined calm expression, luminous makeup marks, isolated on a pure black background, no hair, no ears, no frame, no text, crisp decal texture' },
  @{ Name = 'wisp-runes'; Type = 'mask'; Size = 512; Prompt = 'arcane spectral rune mask for a floating wisp enemy, concentric glowing glyph lines and drifting sigils, bright cyan and amber glow on a pure black background, centered, no border, no frame, no text, clean emissive game texture' },
  @{ Name = 'warden-runes'; Type = 'mask'; Size = 512; Prompt = 'ancient guardian armor rune mask, vertical visor sigils and chest seal motifs, bright molten gold and teal glow on a pure black background, centered, no border, no frame, no text, clean emissive game texture' },
  @{ Name = 'crawler-eyes'; Type = 'mask'; Size = 512; Prompt = 'predatory cave crawler eye mask, clustered glowing insect eyes and tiny sigil scratches, eerie teal glow on a pure black background, centered, no border, no frame, no text, clean emissive game texture' },
  @{ Name = 'choir-runes'; Type = 'mask'; Size = 512; Prompt = 'forbidden choir king rune mask, ceremonial crown sigils and concentric sacred geometry, magenta gold and pale cyan glow on a pure black background, centered, no border, no frame, no text, clean emissive game texture' },
  @{ Name = 'choir-heart-mask'; Type = 'mask'; Size = 512; Prompt = 'eldritch crystal heart emissive mask, branching inner fissures and pulsing sacred veins, pale cyan and ember magenta glow on a pure black background, centered, no border, no frame, no text, clean emissive game texture' },
  @{ Name = 'choir-veil'; Type = 'surface'; Size = 768; Prompt = 'ornate ceremonial veil textile for a dark fantasy boss, top-down fabric texture with gold-thread embroidery, magenta velvet, subtle sacred motifs, even lighting, seamless style, no perspective, no objects, no text' },
  @{ Name = 'choir-heart-surface'; Type = 'surface'; Size = 768; Prompt = 'dark fantasy crystal heart surface texture, top-down mineral and enamel texture with pale cyan glowing veins and magenta undertones, even lighting, seamless style, no perspective, no objects, no text' }
)

function Invoke-ComfyAsset {
  param(
    [Parameter(Mandatory = $true)] [hashtable] $Asset,
    [Parameter(Mandatory = $true)] [string] $RawPath
  )

  $commandOutput = & node $cliPath `
    --prompt $Asset.Prompt `
    --no-enhance `
    --width 1024 `
    --height 1024 `
    --steps 20 `
    --filename-prefix "Emberhollow-$($Asset.Name)"

  if ($LASTEXITCODE -ne 0) {
    throw "ComfyUI generation failed for $($Asset.Name)"
  }

  $result = $commandOutput | ConvertFrom-Json
  $viewUrl = "http://10.13.37.219:8188/view?filename=Emberhollow-$($Asset.Name)_00001_.png&subfolder=&type=output"
  $deadline = (Get-Date).AddMinutes(4)
  $downloaded = $false
  while ((Get-Date) -lt $deadline) {
    try {
      Invoke-WebRequest -Uri $viewUrl -OutFile $RawPath
      if (Test-Path $RawPath) {
        $downloaded = $true
        break
      }
    } catch {
      Start-Sleep -Seconds 4
      continue
    }
  }

  if (-not $downloaded) {
    throw "Timed out waiting for downloadable image for $($Asset.Name)"
  }

  return [pscustomobject]@{
    promptId = $result.promptId
    imageUrls = @($viewUrl)
  }
}

$results = New-Object System.Collections.Generic.List[object]
$contactImages = New-Object System.Collections.Generic.List[string]
$contactLabels = New-Object System.Collections.Generic.List[string]

foreach ($asset in $assets) {
  $rawPath = Join-Path $rawDir "$($asset.Name).png"
  $colorPath = Join-Path $assetDir "$($asset.Name).png"
  $derivedPath = $null
  switch ($asset.Type) {
    'face' { $derivedPath = Join-Path $assetDir "$($asset.Name)-alpha.png" }
    'mask' { $derivedPath = Join-Path $assetDir "$($asset.Name)-alpha.png" }
    'surface' { $derivedPath = Join-Path $assetDir "$($asset.Name)-height.png" }
    default { throw "Unknown asset type $($asset.Type)" }
  }

  $result = $null
  $url = $null
  if (-not ((Test-Path $rawPath) -and (Test-Path $colorPath) -and (Test-Path $derivedPath))) {
    Write-Host "Generating $($asset.Name)..."
    if (-not (Test-Path $rawPath)) {
      $result = Invoke-ComfyAsset -Asset $asset -RawPath $rawPath
      $url = $result.imageUrls[0]
      if (-not $url) {
        throw "No image URL returned for $($asset.Name)"
      }
    }

    [EmberImageOps]::SaveResizedPng($rawPath, $colorPath, [int]$asset.Size)
    switch ($asset.Type) {
      'face' {
        [EmberImageOps]::SaveAlphaMask($rawPath, $derivedPath, [int]$asset.Size, 0.06, 0.72)
      }
      'mask' {
        [EmberImageOps]::SaveAlphaMask($rawPath, $derivedPath, [int]$asset.Size, 0.04, 0.82)
      }
      'surface' {
        [EmberImageOps]::SaveHeightMap($rawPath, $derivedPath, [int]$asset.Size, 1.15, 0.92)
      }
    }
  } else {
    Write-Host "Skipping $($asset.Name); shipped outputs already exist."
  }

  $contactImages.Add($colorPath)
  $contactLabels.Add($asset.Name)
  $results.Add([pscustomobject]@{
      Name = $asset.Name
      Type = $asset.Type
      Prompt = $asset.Prompt
      PromptId = if ($result) { $result.promptId } else { $null }
      Url = $url
      Raw = $rawPath
      Shipped = $colorPath
    })
}

[EmberImageOps]::SaveContactSheet($contactImages.ToArray(), $contactLabels.ToArray(), $contactSheetPath, 4, 240)
$results | ConvertTo-Json -Depth 5 | Set-Content -Path $logPath -Encoding utf8
$assets | ConvertTo-Json -Depth 5 | Set-Content -Path $manifestPath -Encoding utf8

Write-Host "Actor enhancement pack generated."
Write-Host "Raw output: $rawDir"
Write-Host "Shipped assets: $assetDir"
Write-Host "Contact sheet: $contactSheetPath"
