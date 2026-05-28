param(
  [string]$RepositoryZipUrl = "https://github.com/sh4dowf0x/pantheon-parser/archive/refs/heads/main.zip",
  [string]$Destination = ""
)

$ErrorActionPreference = "Stop"

if (-not $Destination) {
  $destinationPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
} else {
  $destinationPath = (Resolve-Path $Destination).Path
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("pantheon-parser-update-" + [System.Guid]::NewGuid().ToString("N"))
$zipPath = Join-Path $tempRoot "pantheon-parser-main.zip"
$extractPath = Join-Path $tempRoot "extract"

try {
  New-Item -ItemType Directory -Force -Path $tempRoot, $extractPath | Out-Null

  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

  Write-Host "Downloading latest Pantheon Parser from GitHub..."
  Invoke-WebRequest -Uri $RepositoryZipUrl -OutFile $zipPath -UseBasicParsing

  Write-Host "Extracting update..."
  Expand-Archive -LiteralPath $zipPath -DestinationPath $extractPath -Force

  $source = Get-ChildItem -LiteralPath $extractPath -Directory | Select-Object -First 1
  if (-not $source) {
    throw "Downloaded archive did not contain a project folder."
  }

  Write-Host "Copying updated files..."
  $robocopyArgs = @(
    $source.FullName,
    $destinationPath,
    "/E",
    "/R:2",
    "/W:1",
    "/NFL",
    "/NDL",
    "/NP",
    "/XD",
    ".git",
    "data",
    "node_modules",
    "/XF",
    "config.json",
    "npm-debug.log*",
    ".DS_Store",
    "Thumbs.db"
  )

  & robocopy @robocopyArgs | Out-Host
  if ($LASTEXITCODE -gt 7) {
    throw "File copy failed with robocopy exit code $LASTEXITCODE."
  }

  Write-Host "GitHub ZIP update completed."
} finally {
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

exit 0
