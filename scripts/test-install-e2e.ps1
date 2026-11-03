# End-to-end check of scripts/install.ps1 against the real npm registry, for clean Windows runners
# in CI. It runs the installer the way `dexto upgrade` does (a new PowerShell process with
# -Command and `iex`), then checks the result, a no-op re-run and the installed CLI.
#
#   scripts/test-install-e2e.ps1 -Installer scripts/install.ps1 -Version next -Shell powershell

param(
    [Parameter(Mandatory = $true)][string]$Installer,
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$Shell
)

$ErrorActionPreference = 'Stop'
$installerPath = (Resolve-Path -LiteralPath $Installer).Path

function Invoke-Installer([string]$Arguments) {
    $command = "& ([scriptblock]::Create((Get-Content -LiteralPath '$installerPath' -Raw))) $Arguments"
    $output = & $Shell -NoProfile -ExecutionPolicy Bypass -Command $command 2>$null
    $status = $LASTEXITCODE
    $line = @($output)[-1]
    [pscustomobject]@{ Status = $status; Line = [string]$line; Result = ([string]$line | ConvertFrom-Json) }
}

function Assert-That([bool]$Condition, [string]$Message) {
    if (-not $Condition) {
        throw $Message
    }
}

$first = Invoke-Installer "-Yes -Version $Version"
Write-Output "first run: $($first.Line)"
Assert-That ($first.Status -eq 0) "expected exit 0, got $($first.Status)"
Assert-That ($first.Result.installed.action -eq 'installed') 'expected action installed'
Assert-That ($first.Result.installed.path_updated -eq $true) 'expected the user PATH to be updated'

$launcher = $first.Result.installed.path
$version = $first.Result.installed.version
$reported = (& $launcher --version | Out-String).Trim()
Write-Output "dexto --version: $reported"
Assert-That ($reported.Contains($version)) "expected dexto --version to report $version"

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
Assert-That ($userPath.Split(';') -contains (Split-Path -Parent $launcher)) 'the install dir is not on the user PATH'

$meta = Get-Content -LiteralPath (Join-Path $env:USERPROFILE '.dexto\install.json') -Raw | ConvertFrom-Json
Assert-That ($meta.method -eq 'native') 'install.json is missing method native'
Assert-That ($meta.installedPath -eq $launcher) 'install.json has the wrong installedPath'

$env:DEXTO_VERSION = $Version
$second = Invoke-Installer '-Yes'
Remove-Item Env:DEXTO_VERSION
Write-Output "second run: $($second.Line)"
Assert-That ($second.Status -eq 0) "expected exit 0, got $($second.Status)"
Assert-That ($second.Result.installed.action -eq 'unchanged') 'expected a no-op second run'

$bad = Invoke-Installer "-Version 'not a version'"
Write-Output "invalid version: $($bad.Line)"
Assert-That ($bad.Status -eq 2) "expected exit 2, got $($bad.Status)"
Assert-That ($bad.Result.error.code -eq 'invalid_input') 'expected invalid_input'

$missing = Invoke-Installer '-Version 0.0.0-does-not-exist'
Write-Output "missing version: $($missing.Line)"
Assert-That ($missing.Status -eq 5) "expected exit 5, got $($missing.Status)"
Assert-That ($missing.Result.error.code -eq 'version_not_found') 'expected version_not_found'

& $launcher --help | Out-Null
Assert-That ($LASTEXITCODE -eq 0) 'dexto --help failed'
Write-Output "ok: installed $version with $Shell, re-run was a no-op, dexto --help runs"
