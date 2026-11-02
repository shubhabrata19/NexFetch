# Development-only binary fetch for Windows.
# Release builds must pin versions and verify published SHA-256 checksums.

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$destination = Join-Path $root 'resources\bin\win32-x64'
$temp = Join-Path $env:TEMP 'nexfetch-ffmpeg.zip'

New-Item -ItemType Directory -Force -Path $destination | Out-Null

Write-Host 'Downloading yt-dlp...'
Invoke-WebRequest `
  -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' `
  -OutFile (Join-Path $destination 'yt-dlp.exe')

Write-Host 'Downloading FFmpeg (LGPL build)...'
Invoke-WebRequest `
  -Uri 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip' `
  -OutFile $temp

Write-Host 'Extracting ffmpeg.exe and ffprobe.exe...'
Expand-Archive -Path $temp -DestinationPath (Join-Path $env:TEMP 'nexfetch-ffmpeg') -Force
$bin = Join-Path $env:TEMP 'nexfetch-ffmpeg\ffmpeg-master-latest-win64-lgpl\bin'
Copy-Item (Join-Path $bin 'ffmpeg.exe') $destination -Force
Copy-Item (Join-Path $bin 'ffprobe.exe') $destination -Force

Remove-Item $temp -Force
Remove-Item (Join-Path $env:TEMP 'nexfetch-ffmpeg') -Recurse -Force

Write-Host 'Installed:'
& (Join-Path $destination 'yt-dlp.exe') --version
& (Join-Path $destination 'ffmpeg.exe') -version | Select-Object -First 1
& (Join-Path $destination 'ffprobe.exe') -version | Select-Object -First 1
