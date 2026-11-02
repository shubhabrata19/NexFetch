# Generates the platform icon set from resources/assets/nexfetch_icon.png.
# Windows-only convenience script; generated assets are committed to the repo.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'resources\assets\nexfetch_icon.png'
$build = Join-Path $root 'build'
$icons = Join-Path $build 'icons'
$rendererAssets = Join-Path $root 'src\renderer\src\assets'

New-Item -ItemType Directory -Force -Path $icons, $rendererAssets | Out-Null

$image = [System.Drawing.Image]::FromFile($source)
try {
  foreach ($size in @(16, 24, 32, 48, 64, 128, 256, 512)) {
    $bitmap = New-Object System.Drawing.Bitmap($size, $size)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.DrawImage($image, 0, 0, $size, $size)
      } finally {
        $graphics.Dispose()
      }
      $bitmap.Save((Join-Path $icons "$size`x$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $bitmap.Dispose()
    }
  }

  foreach ($item in @(
    @{ Size = 512; Path = (Join-Path $build 'icon.png') },
    @{ Size = 256; Path = (Join-Path $rendererAssets 'nexfetch-icon.png') }
  )) {
    $bitmap = New-Object System.Drawing.Bitmap($item.Size, $item.Size)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.DrawImage($image, 0, 0, $item.Size, $item.Size)
      } finally {
        $graphics.Dispose()
      }
      $bitmap.Save($item.Path, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $bitmap.Dispose()
    }
  }
} finally {
  $image.Dispose()
}

node (Join-Path $PSScriptRoot 'generate-icon-formats.mjs')
Write-Host 'Generated build/icon.ico, build/icon.icns, build/icon.png, and build/icons.'
