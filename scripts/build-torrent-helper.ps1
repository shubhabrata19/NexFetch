param(
  [string]$Python = "py"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$helperRoot = Join-Path $root "tools\torrent-helper"
$venv = Join-Path $root ".venv-torrent-helper"
$pythonExe = Join-Path $venv "Scripts\python.exe"
$dist = Join-Path $root "resources\bin\win32-x64"

if (-not (Test-Path $pythonExe)) {
  if ($Python -eq "py") {
    & py -3.12 -m venv $venv
  } else {
    & $Python -m venv $venv
  }
}

& $pythonExe -m pip install --upgrade pip
& $pythonExe -m pip install -r (Join-Path $helperRoot "requirements.txt")

New-Item -ItemType Directory -Force -Path $dist | Out-Null
& (Join-Path $venv "Scripts\pyinstaller.exe") `
  --noconfirm `
  --clean `
  --onefile `
  --name nexfetch-torrent-helper `
  --distpath $dist `
  --workpath (Join-Path $venv "build") `
  --specpath $venv `
  (Join-Path $helperRoot "nexfetch_torrent_helper.py")

Write-Host "Built $dist\nexfetch-torrent-helper.exe"
