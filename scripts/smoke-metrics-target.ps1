param(
  [Parameter(Mandatory = $false)]
  [string]$MetricsUrl = "http://127.0.0.1:8000/metrics"
)

$ErrorActionPreference = "Stop"

$requiredMetrics = @(
  "cognivio_uploads_total",
  "cognivio_analysis_runs_total",
  "cognivio_jobs_queued",
  "cognivio_dependency_health"
)

Write-Host "Checking metrics endpoint:" $MetricsUrl
$response = Invoke-WebRequest -Uri $MetricsUrl -UseBasicParsing -TimeoutSec 20

if ($response.StatusCode -ne 200) {
  throw "Metrics endpoint returned status $($response.StatusCode)"
}

$body = [string]$response.Content
$missing = @()

foreach ($metric in $requiredMetrics) {
  if (-not $body.Contains($metric)) {
    $missing += $metric
  }
}

if ($missing.Count -gt 0) {
  throw "Missing required metrics: $($missing -join ', ')"
}

Write-Host "Metrics endpoint healthy."
Write-Host "Required metrics found:"
$requiredMetrics | ForEach-Object { Write-Host " - $_" }
