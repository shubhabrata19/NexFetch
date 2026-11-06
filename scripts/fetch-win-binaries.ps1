# Pinned, checksum-verified development binary fetch for Windows.
#
# Every download is verified against resources/binaries.manifest.json before it
# is used. Release builds must use the same manifest through the release
# workflow; do not bypass verification for distributed artifacts.
#
# The torrent helper is built locally with `npm run build:torrent-helper`
# because PyInstaller builds are not reproducible enough to publish a stable
# hash. It is marked as unpinned in the manifest and is not downloaded here.

param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$root = Split-Path -Parent $PSScriptRoot
$platform = 'win32-x64'
$manifestPath = Join-Path $root 'resources\binaries.manifest.json'
$destination = Join-Path $root 'resources\bin\win32-x64'
$tempRoot = Join-Path $env:TEMP 'nexfetch-binaries'

if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "Missing binary manifest: $manifestPath"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$artifacts = $manifest.platforms.$platform
if ($null -eq $artifacts) {
  throw "The manifest has no pinned artifacts for $platform."
}

New-Item -ItemType Directory -Force -Path $destination | Out-Null
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null

function Get-Sha256 {
  param([string]$Path)
  # Use .NET directly: Get-FileHash is not available in every CI PowerShell.
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      $bytes = $sha.ComputeHash($stream)
      return ([System.BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
    } finally {
      $sha.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

function Test-Sha256 {
  param([string]$Path, [string]$Expected)
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  return (Get-Sha256 -Path $Path) -eq $Expected.ToLowerInvariant()
}

function Assert-Sha256 {
  param([string]$Path, [string]$Expected, [string]$Label)
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "$Label is missing: $Path"
  }
  $actual = Get-Sha256 -Path $Path
  if ($actual -ne $Expected.ToLowerInvariant()) {
    throw "$Label failed SHA-256 verification.`n  expected: $($Expected.ToLowerInvariant())`n  actual:   $actual`nDelete the file and retry, or update the pinned manifest if the upstream release changed intentionally."
  }
  Write-Host "  verified $Label ($actual)"
}

function Save-Download {
  param([string]$Url, [string]$Path)
  if (-not $Url.StartsWith('https://', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing a non-HTTPS download URL: $Url"
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  Invoke-WebRequest -Uri $Url -OutFile $Path -UseBasicParsing
}

Write-Host "NexFetch pinned binaries ($platform)"
Write-Host "Manifest: $manifestPath"

# Build groups of artifacts that come from the same archive.
$archiveGroups = @{}
foreach ($property in $artifacts.PSObject.Properties) {
  $artifact = $property.Value
  if ($null -eq $artifact.archive) { continue }
  $archiveName = [string]$artifact.archive.name
  if (-not $archiveGroups.ContainsKey($archiveName)) {
    $archiveGroups[$archiveName] = @{
      Archive = $artifact.archive
      Members = @()
    }
  }
  $archiveGroups[$archiveName].Members += @{
    Id = $property.Name
    Artifact = $artifact
  }
}

# Direct downloads (yt-dlp).
foreach ($property in $artifacts.PSObject.Properties) {
  $artifact = $property.Value
  if ($null -ne $artifact.archive) { continue }

  $target = Join-Path $destination ([string]$artifact.file)
  if ($null -eq $artifact.sha256) {
    if (Test-Path -LiteralPath $target) {
      Write-Host "  $($property.Name) is locally built (not hash-pinned)."
    } else {
      Write-Warning "$($property.Name) is missing and is not downloaded by this script."
    }
    continue
  }

  if (-not $Force -and (Test-Sha256 -Path $target -Expected $artifact.sha256)) {
    Write-Host "  $($property.Name) is up to date."
    continue
  }

  Write-Host "Downloading $($property.Name) $($artifact.version)..."
  $temporaryFile = Join-Path $tempRoot ([string]$artifact.file)
  Save-Download -Url $artifact.url -Path $temporaryFile
  Assert-Sha256 -Path $temporaryFile -Expected $artifact.sha256 -Label $property.Name
  Move-Item -LiteralPath $temporaryFile -Destination $target -Force
}

# Archive-based downloads (FFmpeg and ffprobe).
foreach ($archiveName in $archiveGroups.Keys) {
  $group = $archiveGroups[$archiveName]
  $archive = $group.Archive
  $needsDownload = $false

  foreach ($member in $group.Members) {
    $target = Join-Path $destination ([string]$member.Artifact.file)
    if ($Force -or -not (Test-Sha256 -Path $target -Expected $member.Artifact.sha256)) {
      $needsDownload = $true
    }
  }

  if (-not $needsDownload) {
    Write-Host "  $archiveName members are up to date."
    continue
  }

  Write-Host "Downloading $archiveName..."
  $archivePath = Join-Path $tempRoot $archiveName
  $extractPath = Join-Path $tempRoot ("extract-" + [System.IO.Path]::GetFileNameWithoutExtension($archiveName))

  Save-Download -Url $archive.url -Path $archivePath
  Assert-Sha256 -Path $archivePath -Expected $archive.sha256 -Label $archiveName

  if (Test-Path -LiteralPath $extractPath) {
    Remove-Item -LiteralPath $extractPath -Recurse -Force
  }
  Write-Host "Extracting $archiveName..."
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($archivePath, $extractPath)

  foreach ($member in $group.Members) {
    $memberPath = Join-Path $extractPath (([string]$member.Artifact.archive.member) -replace '/', '\')
    if (-not (Test-Path -LiteralPath $memberPath)) {
      throw "Archive $archiveName does not contain the pinned member path: $($archive.member)"
    }
    $target = Join-Path $destination ([string]$member.Artifact.file)
    Copy-Item -LiteralPath $memberPath -Destination $target -Force
    Assert-Sha256 -Path $target -Expected $member.Artifact.sha256 -Label $member.Id
  }

  Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $extractPath -Recurse -Force -ErrorAction SilentlyContinue
}

$torrentHelper = Join-Path $destination 'nexfetch-torrent-helper.exe'
if (-not (Test-Path -LiteralPath $torrentHelper)) {
  Write-Warning 'Torrent helper is missing. Build it with: npm run build:torrent-helper'
}

Write-Host 'Installed:'
if (Test-Path -LiteralPath (Join-Path $destination 'yt-dlp.exe')) {
  & (Join-Path $destination 'yt-dlp.exe') --version
}
if (Test-Path -LiteralPath (Join-Path $destination 'ffmpeg.exe')) {
  & (Join-Path $destination 'ffmpeg.exe') -version | Select-Object -First 1
}
if (Test-Path -LiteralPath (Join-Path $destination 'ffprobe.exe')) {
  & (Join-Path $destination 'ffprobe.exe') -version | Select-Object -First 1
}
