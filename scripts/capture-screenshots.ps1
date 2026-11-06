# Captures README screenshots from an isolated development profile.
#
# Usage:
#   npm run screenshots
#   npm run screenshots -- -Views "downloads:youtube,torrents" -OutDir "docs/images"
#
# The app is launched with NEXFETCH_CAPTURE=1; the dev-only harness switches
# views, writes PNGs, and quits. The real user profile is never touched.

param(
  [string]$OutDir = 'docs/images',
  [string]$Views = 'downloads:youtube,torrents,history,settings'
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$profile = Join-Path $env:TEMP ("nexfetch-screenshots-" + [guid]::NewGuid().ToString('N'))

New-Item -ItemType Directory -Force -Path $profile | Out-Null

try {
  Write-Host "Seeding isolated screenshot profile..."
  & node (Join-Path $PSScriptRoot 'seed-screenshot-profile.mjs') $profile
  if ($LASTEXITCODE -ne 0) { throw 'Failed to seed the screenshot profile.' }

  $env:NEXFETCH_USER_DATA_DIR = $profile
  $env:NEXFETCH_CAPTURE = '1'
  $env:NEXFETCH_CAPTURE_OUT = (Join-Path $root $OutDir)
  $env:NEXFETCH_CAPTURE_VIEWS = $Views

  Write-Host "Launching NexFetch to capture: $Views"
  Push-Location $root
  try {
    & npm run dev
    if ($LASTEXITCODE -ne 0) { throw "npm run dev exited with code $LASTEXITCODE." }
  } finally {
    Pop-Location
  }

  Write-Host "Screenshots written to $(Join-Path $root $OutDir)"
} finally {
  Remove-Item Env:\NEXFETCH_USER_DATA_DIR -ErrorAction SilentlyContinue
  Remove-Item Env:\NEXFETCH_CAPTURE -ErrorAction SilentlyContinue
  Remove-Item Env:\NEXFETCH_CAPTURE_OUT -ErrorAction SilentlyContinue
  Remove-Item Env:\NEXFETCH_CAPTURE_VIEWS -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue
}
