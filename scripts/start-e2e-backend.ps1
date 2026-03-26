$ErrorActionPreference = "Stop"

$repoRoot = Split-Path $PSScriptRoot -Parent
$defaultPortableRoot = Join-Path (Split-Path $repoRoot -Parent) "mongodb-portable"
$portableRoot = if ($env:MONGO_PORTABLE_ROOT) {
  $env:MONGO_PORTABLE_ROOT
} else {
  $defaultPortableRoot
}

function Test-TcpPort {
  param(
    [string]$TargetHost,
    [int]$Port
  )

  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $asyncResult = $client.BeginConnect($TargetHost, $Port, $null, $null)
    if (-not $asyncResult.AsyncWaitHandle.WaitOne(1000, $false)) {
      $client.Close()
      return $false
    }
    $client.EndConnect($asyncResult)
    $client.Close()
    return $true
  } catch {
    return $false
  }
}

function Wait-ForPort {
  param(
    [string]$TargetHost,
    [int]$Port,
    [int]$TimeoutSec = 30
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (Test-TcpPort -TargetHost $TargetHost -Port $Port) {
      return $true
    }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Resolve-MongoExecutable {
  param(
    [string]$PortableRoot
  )

  $portableMongo = Get-ChildItem -Path $PortableRoot -Recurse -Filter "mongod.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName |
    Select-Object -First 1
  if ($portableMongo) {
    return $portableMongo.FullName
  }

  $pathMongo = Get-Command mongod -ErrorAction SilentlyContinue
  if ($pathMongo) {
    return $pathMongo.Source
  }

  $installedMongo = Get-ChildItem -Path "C:\Program Files\MongoDB\Server" -Recurse -Filter "mongod.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending |
    Select-Object -First 1
  if ($installedMongo) {
    return $installedMongo.FullName
  }

  throw "mongod.exe was not found. Set MONGO_PORTABLE_ROOT or install MongoDB Community Server."
}

$mongoProcess = $null
$startedMongo = $false

if (-not (Test-TcpPort -TargetHost "127.0.0.1" -Port 27017)) {
  $mongodPath = Resolve-MongoExecutable -PortableRoot $portableRoot
  $mongoBaseRoot = Split-Path (Split-Path $mongodPath -Parent) -Parent
  $mongoData = Join-Path $mongoBaseRoot "data\db"
  $mongoLog = Join-Path $mongoBaseRoot "mongod-e2e.log"

  New-Item -ItemType Directory -Force -Path $mongoData | Out-Null

  $mongoProcess = Start-Process -FilePath $mongodPath `
    -ArgumentList @("--dbpath", $mongoData, "--bind_ip", "127.0.0.1", "--port", "27017", "--logpath", $mongoLog) `
    -PassThru `
    -WindowStyle Hidden
  $startedMongo = $true

  if (-not (Wait-ForPort -TargetHost "127.0.0.1" -Port 27017 -TimeoutSec 30)) {
    if ($mongoProcess -and -not $mongoProcess.HasExited) {
      Stop-Process -Id $mongoProcess.Id -Force -ErrorAction SilentlyContinue
    }
    throw "MongoDB did not become reachable on 127.0.0.1:27017."
  }
}

$env:SESSION_SECRET = if ($env:SESSION_SECRET) { $env:SESSION_SECRET } else { "e2e-session-secret" }
$env:JWT_SECRET = if ($env:JWT_SECRET) { $env:JWT_SECRET } else { "e2e-jwt-secret" }
$env:DEMO_MODE = if ($env:DEMO_MODE) { $env:DEMO_MODE } else { "true" }
$env:MONGO_URL = if ($env:MONGO_URL) { $env:MONGO_URL } else { "mongodb://127.0.0.1:27017" }
$env:DB_NAME = if ($env:DB_NAME) { $env:DB_NAME } else { "cognivio" }
$env:PYTHONUNBUFFERED = "1"

try {
  & python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --app-dir backend
} finally {
  if ($startedMongo -and $mongoProcess -and -not $mongoProcess.HasExited) {
    Stop-Process -Id $mongoProcess.Id -Force -ErrorAction SilentlyContinue
  }
}
