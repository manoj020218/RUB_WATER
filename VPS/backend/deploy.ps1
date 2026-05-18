[CmdletBinding()]
param(
  [ValidateSet('foreground', 'background')]
  [string]$Mode = 'foreground',
  [switch]$SkipInstall,
  [switch]$SkipTests,
  [switch]$InsecureRegistry
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:BackendRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$script:ConfigPath = Join-Path $script:BackendRoot 'VPS_SHIFT_CONFIG.json'
$script:NpmCachePath = Join-Path $script:BackendRoot '.npm-cache'
$script:LogsPath = Join-Path $script:BackendRoot 'logs'

function Write-Step {
  param([string]$Message)
  Write-Host "[deploy] $Message" -ForegroundColor Cyan
}

function Fail {
  param([string]$Message)
  throw "[deploy] $Message"
}

function Get-NestedValue {
  param(
    [Parameter(Mandatory = $true)]
    [object]$InputObject,
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $current = $InputObject
  foreach ($segment in $Path.Split('.')) {
    if ($null -eq $current) {
      return $null
    }

    $property = $current.PSObject.Properties[$segment]
    if ($null -eq $property) {
      return $null
    }

    $current = $property.Value
  }

  return $current
}

function Validate-ShiftConfig {
  if (-not (Test-Path -LiteralPath $script:ConfigPath)) {
    Fail "Missing required file: $script:ConfigPath"
  }

  $raw = Get-Content -Raw -LiteralPath $script:ConfigPath
  try {
    $config = $raw | ConvertFrom-Json
  } catch {
    Fail "Invalid JSON in VPS_SHIFT_CONFIG.json. $_"
  }

  $errors = New-Object System.Collections.Generic.List[string]

  $requiredStrings = @(
    'deployment.nodeEnv',
    'deployment.timezone',
    'domains.publicApiBaseUrl',
    'domains.vpsFqdn',
    'database.mongoUri',
    'database.mongoDbName',
    'messaging.mqttHost',
    'security.apiKey',
    'security.jwtSecret'
  )

  foreach ($path in $requiredStrings) {
    $value = Get-NestedValue -InputObject $config -Path $path
    if ($null -eq $value -or [string]::IsNullOrWhiteSpace([string]$value)) {
      $errors.Add("Missing or empty value: $path")
    }
  }

  $deploymentPort = Get-NestedValue -InputObject $config -Path 'deployment.port'
  $portOk = $false
  $portInt = 0
  if ($deploymentPort -ne $null) {
    $portOk = [int]::TryParse([string]$deploymentPort, [ref]$portInt)
  }

  if (-not $portOk -or $portInt -lt 1 -or $portInt -gt 65535) {
    $errors.Add('deployment.port must be an integer between 1 and 65535')
  }

  $mqttPort = Get-NestedValue -InputObject $config -Path 'messaging.mqttPort'
  $mqttPortOk = $false
  $mqttPortInt = 0
  if ($mqttPort -ne $null) {
    $mqttPortOk = [int]::TryParse([string]$mqttPort, [ref]$mqttPortInt)
  }

  if (-not $mqttPortOk -or $mqttPortInt -lt 1 -or $mqttPortInt -gt 65535) {
    $errors.Add('messaging.mqttPort must be an integer between 1 and 65535')
  }

  $publicApiBaseUrl = [string](Get-NestedValue -InputObject $config -Path 'domains.publicApiBaseUrl')
  if (-not ($publicApiBaseUrl -match '^https?://')) {
    $errors.Add('domains.publicApiBaseUrl must start with http:// or https://')
  }

  $mongoUri = [string](Get-NestedValue -InputObject $config -Path 'database.mongoUri')
  if (-not ($mongoUri -match '^mongodb(\+srv)?:\/\/')) {
    $errors.Add('database.mongoUri must start with mongodb:// or mongodb+srv://')
  }

  $jwtSecret = [string](Get-NestedValue -InputObject $config -Path 'security.jwtSecret')
  $nodeEnv = [string](Get-NestedValue -InputObject $config -Path 'deployment.nodeEnv')
  if ($nodeEnv.ToLowerInvariant() -eq 'production' -and $jwtSecret -eq 'CHANGE_THIS_IN_PRODUCTION') {
    $errors.Add('security.jwtSecret is still placeholder value in production mode')
  }

  if ($errors.Count -gt 0) {
    $message = "VPS_SHIFT_CONFIG.json validation failed:`n - " + ($errors -join "`n - ")
    Fail $message
  }

  return $config
}

function Resolve-NodeExe {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($null -eq $node) {
    Fail 'Node.js was not found in PATH'
  }
  return $node.Source
}

function Resolve-NpmCli {
  $candidates = @()

  if ($env:ProgramFiles) {
    $candidates += (Join-Path $env:ProgramFiles 'nodejs\node_modules\npm\bin\npm-cli.js')
  }

  if (${env:ProgramFiles(x86)}) {
    $candidates += (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node_modules\npm\bin\npm-cli.js')
  }

  $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
  if ($npmCommand) {
    $npmRoot = Split-Path -Parent $npmCommand.Source
    $candidates += (Join-Path $npmRoot 'node_modules\npm\bin\npm-cli.js')
  }

  foreach ($candidate in $candidates | Select-Object -Unique) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }

  Fail 'Unable to locate npm-cli.js. Please reinstall Node.js/npm.'
}

function Invoke-NpmCli {
  param(
    [Parameter(Mandatory = $true)]
    [string]$NodeExe,
    [Parameter(Mandatory = $true)]
    [string]$NpmCli,
    [Parameter(Mandatory = $true)]
    [string[]]$Args
  )

  & $NodeExe $NpmCli @Args
  if ($LASTEXITCODE -ne 0) {
    Fail "npm command failed: npm $($Args -join ' ')"
  }
}

Push-Location $script:BackendRoot
try {
  Write-Step "Validating VPS shift config at $script:ConfigPath"
  $config = Validate-ShiftConfig

  $nodeExe = Resolve-NodeExe
  $npmCli = Resolve-NpmCli
  Write-Step "Using Node: $nodeExe"
  Write-Step "Using npm-cli: $npmCli"

  if (-not (Test-Path -LiteralPath $script:NpmCachePath)) {
    New-Item -ItemType Directory -Path $script:NpmCachePath | Out-Null
  }

  if (-not $SkipInstall) {
    Write-Step 'Installing dependencies'
    $installArgs = @('--cache', '.\.npm-cache')
    if ($InsecureRegistry) {
      $installArgs += '--strict-ssl=false'
    }
    $installArgs += @('install', '--no-audit', '--no-fund')
    Invoke-NpmCli -NodeExe $nodeExe -NpmCli $npmCli -Args $installArgs
  } else {
    Write-Step 'Skipping dependency install'
  }

  if (-not $SkipTests) {
    Write-Step 'Running regression tests'
    & $nodeExe --test '.\tests\api.regression.test.js' '.\tests\mqtt.ingestion.test.js'
    if ($LASTEXITCODE -ne 0) {
      Fail 'Regression tests failed'
    }
  } else {
    Write-Step 'Skipping regression tests'
  }

  if ($Mode -eq 'foreground') {
    Write-Step 'Starting backend in foreground mode'
    $env:NODE_ENV = [string]$config.deployment.nodeEnv
    & $nodeExe '.\src\server.js'
    exit $LASTEXITCODE
  }

  if (-not (Test-Path -LiteralPath $script:LogsPath)) {
    New-Item -ItemType Directory -Path $script:LogsPath | Out-Null
  }

  $stdoutLog = Join-Path $script:LogsPath 'backend.stdout.log'
  $stderrLog = Join-Path $script:LogsPath 'backend.stderr.log'

  Write-Step 'Starting backend in background mode'
  $process = Start-Process -FilePath $nodeExe `
                          -ArgumentList '.\src\server.js' `
                          -WorkingDirectory $script:BackendRoot `
                          -WindowStyle Hidden `
                          -RedirectStandardOutput $stdoutLog `
                          -RedirectStandardError $stderrLog `
                          -PassThru

  Write-Step "Backend started. PID: $($process.Id)"
  Write-Step "Stdout log: $stdoutLog"
  Write-Step "Stderr log: $stderrLog"
}
finally {
  Pop-Location
}
