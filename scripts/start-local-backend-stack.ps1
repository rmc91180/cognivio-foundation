$ErrorActionPreference = "Stop"

$repoRoot = Split-Path $PSScriptRoot -Parent
$portableRoot = if ($env:MONGO_PORTABLE_ROOT) {
  $env:MONGO_PORTABLE_ROOT
} else {
  Join-Path (Split-Path $repoRoot -Parent) "mongodb-portable"
}

$mongod = Get-ChildItem -Path $portableRoot -Recurse -Filter "mongod.exe" -ErrorAction SilentlyContinue |
  Sort-Object FullName |
  Select-Object -First 1

if (-not $mongod) {
  throw "mongod.exe was not found under '$portableRoot'. Set MONGO_PORTABLE_ROOT to your Mongo portable directory."
}

$mongoData = Join-Path $portableRoot "data\\db"
$mongoLog = Join-Path $portableRoot "mongod.log"
$backendLog = Join-Path $repoRoot "backend_uvicorn.log"
$backendErrLog = Join-Path $repoRoot "backend_uvicorn.err.log"

New-Item -ItemType Directory -Force -Path $mongoData | Out-Null

$mongoListening = $false
try {
  $mongoListening = (Test-NetConnection -ComputerName 127.0.0.1 -Port 27017 -WarningAction SilentlyContinue).TcpTestSucceeded
} catch {
  $mongoListening = $false
}

if (-not $mongoListening) {
  Start-Process -FilePath $mongod.FullName `
    -ArgumentList "--dbpath", $mongoData, "--bind_ip", "127.0.0.1", "--port", "27017", "--logpath", $mongoLog `
    | Out-Null
  Start-Sleep -Seconds 3
}

$backendListening = $false
try {
  $backendListening = (Test-NetConnection -ComputerName 127.0.0.1 -Port 8000 -WarningAction SilentlyContinue).TcpTestSucceeded
} catch {
  $backendListening = $false
}

if (-not $backendListening) {
  $env:MONGO_URL = "mongodb://127.0.0.1:27017"
  $env:DEMO_MODE = if ($env:DEMO_MODE) { $env:DEMO_MODE } else { "true" }
  $env:PYTHONUNBUFFERED = "1"

  Start-Process -FilePath "python" `
    -ArgumentList "-m", "uvicorn", "backend.server:app", "--host", "127.0.0.1", "--port", "8000" `
    -WorkingDirectory $repoRoot `
    -RedirectStandardOutput $backendLog `
    -RedirectStandardError $backendErrLog `
    | Out-Null

  Start-Sleep -Seconds 5
}

Write-Host "MongoDB port 27017:" ((Test-NetConnection -ComputerName 127.0.0.1 -Port 27017 -WarningAction SilentlyContinue).TcpTestSucceeded)
Write-Host "Backend port 8000:" ((Test-NetConnection -ComputerName 127.0.0.1 -Port 8000 -WarningAction SilentlyContinue).TcpTestSucceeded)
Write-Host "Mongo log:" $mongoLog
Write-Host "Backend log:" $backendLog
