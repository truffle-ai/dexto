# Installs the Dexto CLI for the current Windows user, without admin rights.
#
#   $env:DEXTO_VERSION = 'next'; irm https://dexto.ai/install.ps1 | iex
#   $env:DEXTO_VERSION = '2.0.0'; irm https://dexto.ai/install.ps1 | iex
#   & ([scriptblock]::Create((irm https://dexto.ai/install.ps1))) -Version next -Yes
#
# The Windows counterpart of scripts/install.sh, with the same contract.
# Needs npm and Node.js 20 or later; 22 or later installs without a compiler. It installs the `dexto` npm package into %USERPROFILE%\.dexto\cli\<version>,
# after checking the downloaded tarball against the registry's sha512 integrity, then writes
# %USERPROFILE%\.dexto\bin\dexto.cmd (or $env:DEXTO_INSTALL_DIR\dexto.cmd) to run it, adds that
# directory to the user PATH, and records the install in %USERPROFILE%\.dexto\install.json, which
# `dexto upgrade` and `dexto uninstall` read.
#
# It never prompts and never reads credentials. Progress goes to the host; the last line of
# output is one JSON object, in the CLI's --json shape:
#   {"installed":{"action":"installed","version":"2.0.0",...}}
#   {"error":{"code":"node_missing","message":"...","fix":"..."}}
# Exit codes follow the CLI: 0 done, 1 failed, 2 invalid input, 5 version not found.

# The parameters are read inside the script block below; -Yes, -NonInteractive and -Json are
# accepted only so scripts written for other installers don't fail.
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSReviewUnusedParameter', '', Justification = 'Read inside the script block')]
param(
    [string]$Version = $env:DEXTO_VERSION,
    [string]$InstallDir = $env:DEXTO_INSTALL_DIR,
    [switch]$Force,
    [switch]$DryRun,
    [switch]$NoModifyPath,
    [switch]$Yes,
    [switch]$NonInteractive,
    [switch]$Json,
    [switch]$Help
)

# Everything runs inside one script block, so a download cut off midway runs nothing.
$DextoInstallState = @{ ExitCode = 0; StagingDir = $null; WorkDir = $null; LauncherTemp = $null }
try {
& {
    Set-StrictMode -Version 3.0
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'

    $DextoPackage = 'dexto'
    $MinNodeMajor = 20
    $state = $DextoInstallState

    function Write-Note([string]$Text) {
        [Console]::Error.WriteLine($Text)
    }

    # Prints the error line and stops the installer; the code after the script block exits.
    function Fail([string]$Code, [string]$Message, [string]$Fix) {
        Write-Note "error: $Message"
        if ($Fix) {
            Write-Note "fix: $Fix"
        }
        $fixValue = if ($Fix) { $Fix } else { $null }
        $line = [ordered]@{ error = [ordered]@{ code = $Code; message = $Message; fix = $fixValue } } |
            ConvertTo-Json -Compress -Depth 4
        [Console]::Out.WriteLine($line)
        $state.ExitCode = switch ($Code) {
            'invalid_input' { 2 }
            'version_not_found' { 5 }
            default { 1 }
        }
        throw 'dexto-installer-stopped'
    }

    # Windows PowerShell turns a native command's stderr into errors, which 'Stop' would throw on,
    # so native commands run here with stderr collected instead. They run from the home directory:
    # npm reads .npmrc from the working directory, and a project's settings shouldn't change what
    # gets installed.
    function Invoke-Native([string]$File, [string[]]$Arguments) {
        $ErrorActionPreference = 'Continue'
        $stdout = New-Object System.Collections.Generic.List[string]
        $stderr = New-Object System.Collections.Generic.List[string]
        Push-Location -LiteralPath $userHome
        try {
            & $File @Arguments 2>&1 | ForEach-Object {
                if ($_ -is [System.Management.Automation.ErrorRecord]) {
                    $stderr.Add($_.ToString())
                } else {
                    $stdout.Add([string]$_)
                }
            }
            $exitCode = $LASTEXITCODE
        } finally {
            Pop-Location
        }
        [pscustomobject]@{
            ExitCode = $exitCode
            Stdout = ($stdout -join "`n").Trim()
            Stderr = ($stderr -join "`n").Trim()
        }
    }

    function Test-PathListEntry([string]$PathList, [string]$Dir) {
        if (-not $PathList) {
            return $false
        }
        $wanted = $Dir.TrimEnd('\')
        foreach ($entry in $PathList.Split(';')) {
            if ($entry -and ([Environment]::ExpandEnvironmentVariables($entry).TrimEnd('\') -ieq $wanted)) {
                return $true
            }
        }
        return $false
    }

    if ($Help) {
        @'
Install the Dexto CLI for the current user.

Usage: irm https://dexto.ai/install.ps1 | iex
       & ([scriptblock]::Create((irm https://dexto.ai/install.ps1))) [options]

Options:
  -Version <version>     An exact version or an npm dist-tag (default: latest)
  -InstallDir <dir>      Where to put dexto.cmd (default: %USERPROFILE%\.dexto\bin)
  -Force                 Reinstall even when this version is already installed
  -DryRun                Resolve the version and report what would change, without writing
  -NoModifyPath          Don't add the install directory to the user PATH
  -Yes, -NonInteractive  Accepted for scripts; the installer never prompts
  -Json                  Accepted for scripts; the last output line is always JSON
  -Help                  Show this help

Environment:
  DEXTO_VERSION          Same as -Version
  DEXTO_INSTALL_DIR      Same as -InstallDir
  DEXTO_INSTALL_FORCE=1  Same as -Force
  DEXTO_NO_MODIFY_PATH=1 Same as -NoModifyPath

The default, latest, is the current release; set DEXTO_VERSION=next for the newest prerelease.
After install and PATH setup: dexto login --device
Then check your account: dexto whoami --json
'@ | Write-Output
        return
    }

    if ($env:DEXTO_INSTALL_FORCE -in @('1', 'true', 'yes')) {
        $Force = $true
    }
    if ($env:DEXTO_NO_MODIFY_PATH -in @('1', 'true', 'yes')) {
        $NoModifyPath = $true
    }

    $onWindows = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
    if (-not $onWindows) {
        Fail 'unsupported_platform' 'This installer is for Windows.' 'On macOS and Linux, run: curl -fsSL https://dexto.ai/install | sh'
    }

    $userHome = $env:USERPROFILE
    if (-not $userHome) {
        Fail 'failed' 'USERPROFILE is not set.' 'Run the installer from a normal user session.'
    }
    $dextoHome = Join-Path $userHome '.dexto'
    $cliRoot = Join-Path $dextoHome 'cli'
    $metadataPath = Join-Path $dextoHome 'install.json'
    if (-not $InstallDir) {
        $InstallDir = Join-Path $dextoHome 'bin'
    }
    if (-not [IO.Path]::IsPathRooted($InstallDir)) {
        Fail 'invalid_input' "The install directory must be an absolute path: $InstallDir" 'Pass an absolute path, such as -InstallDir "$env:USERPROFILE\.dexto\bin".'
    }
    $InstallDir = $InstallDir.TrimEnd('\')
    $launcherPath = Join-Path $InstallDir 'dexto.cmd'

    $versionSpec = if ($Version) { $Version } else { 'latest' }
    if ($versionSpec.StartsWith('dexto@')) {
        $versionSpec = $versionSpec.Substring('dexto@'.Length)
    }
    if ($versionSpec.StartsWith('v')) {
        $versionSpec = $versionSpec.Substring(1)
    }
    if ($versionSpec -notmatch '^[A-Za-z0-9.+-]+$') {
        Fail 'invalid_input' "Not a version or dist-tag: $Version" 'Pass an exact version such as 2.0.0, or a dist-tag such as latest or next.'
    }

    $arch = switch ($env:PROCESSOR_ARCHITECTURE) {
        'AMD64' { 'x64' }
        'ARM64' { 'arm64' }
        default { $null }
    }
    if (-not $arch) {
        Fail 'unsupported_platform' "Unsupported CPU architecture: $env:PROCESSOR_ARCHITECTURE." "Install with npm instead: npm install -g $DextoPackage"
    }

    $node = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $node) {
        Fail 'node_missing' "Node.js $MinNodeMajor or later is required, and node is not on PATH." "Install Node.js $MinNodeMajor or later (https://nodejs.org), then run the installer again."
    }
    $nodeVersion = (Invoke-Native $node.Path @('-p', 'process.versions.node')).Stdout
    $nodeMajor = 0
    if (-not [int]::TryParse(($nodeVersion -split '\.')[0], [ref]$nodeMajor)) {
        Fail 'node_missing' 'Could not read the Node.js version from node.' "Install Node.js $MinNodeMajor or later (https://nodejs.org), then run the installer again."
    }
    if ($nodeMajor -lt $MinNodeMajor) {
        Fail 'node_too_old' "Node.js $MinNodeMajor or later is required; found $nodeVersion." "Upgrade Node.js to $MinNodeMajor or later (https://nodejs.org), then run the installer again."
    }
    # npm.cmd, not npm.ps1, which an execution policy can block.
    $npm = Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $npm) {
        Fail 'npm_missing' 'npm is required and is not on PATH.' 'Install npm (it ships with Node.js), then run the installer again.'
    }
    $npmPath = $npm.Path

    Write-Note "Resolving $DextoPackage@$versionSpec..."
    $view = Invoke-Native $npmPath @('view', "$DextoPackage@$versionSpec", 'version', 'dist.integrity', 'dist.tarball', '--json')
    $viewStatus = $view.ExitCode
    $viewErrorText = $view.Stderr
    if ($viewStatus -ne 0 -and -not ($viewErrorText -match 'E404')) {
        if ($viewErrorText) {
            Write-Note $viewErrorText.Trim()
        }
        Fail 'registry_unreachable' "Could not read $DextoPackage@$versionSpec from the npm registry." 'Check your network and npm registry settings (npm config get registry), then run the installer again.'
    }
    # npm prints nothing for a version that doesn't exist, and a list for a range: take the newest.
    $resolved = $null
    $viewText = $view.Stdout
    if ($viewStatus -eq 0 -and $viewText) {
        $parsed = $viewText | ConvertFrom-Json
        if ($parsed -is [array]) {
            $parsed = $parsed[-1]
        }
        $props = $parsed.PSObject.Properties
        if ($props['version'] -and $props['dist.integrity'] -and $props['dist.tarball']) {
            $resolved = [pscustomobject]@{
                Version = [string]$parsed.version
                Integrity = [string]$parsed.'dist.integrity'
                Tarball = [string]$parsed.'dist.tarball'
            }
        }
    }
    if (-not $resolved) {
        Fail 'version_not_found' "No $DextoPackage release matches $versionSpec." "Check the versions with: npm view $DextoPackage dist-tags versions"
    }
    $targetVersion = $resolved.Version
    if ($targetVersion -notmatch '^[A-Za-z0-9.+-]+$') {
        Fail 'failed' "The registry returned an unexpected version: $targetVersion" ''
    }
    if (-not $resolved.Integrity.StartsWith('sha512-')) {
        Fail 'checksum_unavailable' "The registry has no sha512 integrity for $DextoPackage@$targetVersion." ''
    }

    $versionDir = Join-Path $cliRoot $targetVersion
    $versionCmd = Join-Path $versionDir 'dexto.cmd'
    # cmd.exe reads batch files in the OEM code page, so a profile path with non-ASCII letters is written
    # as %USERPROFILE%, keeping the launcher ASCII.
    $launcherTarget = $versionCmd
    if ($versionCmd.StartsWith("$userHome\", [StringComparison]::OrdinalIgnoreCase)) {
        $launcherTarget = '%USERPROFILE%' + $versionCmd.Substring($userHome.Length)
    }
    $launcherText = "@`"$launcherTarget`" %*`r`n"
    $launcherEncoding = [Text.Encoding]::ASCII
    if ($launcherText -match '[^\x00-\x7F]') {
        try {
            $launcherEncoding = [Text.Encoding]::GetEncoding([Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage)
        } catch {
            $launcherEncoding = [Text.Encoding]::Default
        }
    }

    $previousVersion = $null
    $previousPath = $null
    if (Test-Path -LiteralPath $metadataPath) {
        try {
            $meta = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
            if ($meta.version -is [string] -and $meta.installedPath -is [string]) {
                $previousVersion = $meta.version
                $previousPath = $meta.installedPath
            }
        } catch {
            $previousVersion = $null
        }
    }

    $alreadyInstalled = ($previousVersion -eq $targetVersion) -and
        ($previousPath -ieq $launcherPath) -and
        (Test-Path -LiteralPath $versionCmd) -and
        (Test-Path -LiteralPath $launcherPath) -and
        ([IO.File]::ReadAllText($launcherPath, $launcherEncoding) -eq $launcherText)

    $oldExe = Join-Path $InstallDir 'dexto.exe'
    $action = if ($alreadyInstalled -and -not $Force) {
        'unchanged'
    } elseif ($alreadyInstalled) {
        'reinstalled'
    } elseif ($previousVersion -or (Test-Path -LiteralPath $launcherPath) -or (Test-Path -LiteralPath $oldExe)) {
        'upgraded'
    } else {
        'installed'
    }

    function Write-Result([string]$ResultAction, [bool]$PathUpdated) {
        $active = Get-Command dexto -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        $onPath = Test-PathListEntry $env:Path $InstallDir
        $shadowedBy = $null
        if ($onPath -and -not $DryRun -and $active -and ($active.Source -ine $launcherPath)) {
            $shadowedBy = $active.Source
            Write-Note "warning: $shadowedBy comes before $launcherPath on your PATH, so ``dexto`` runs that one."
        }
        if (-not $onPath) {
            Write-Note "$InstallDir is not on your PATH. Add it to your user PATH, or run the installer without -NoModifyPath."
        }
        $line = [ordered]@{
            installed = [ordered]@{
                action = $ResultAction
                version = $targetVersion
                previous_version = $previousVersion
                path = $launcherPath
                on_path = $onPath
                path_updated = $PathUpdated
                shadowed_by = $shadowedBy
                dry_run = [bool]$DryRun
            }
        } | ConvertTo-Json -Compress -Depth 4
        [Console]::Out.WriteLine($line)
    }

    # Adds the install dir to the user and current-session PATH unless -NoModifyPath or -DryRun;
    # returns whether the user PATH changed. An unchanged run calls it too, so a rerun repairs the
    # PATH an earlier -NoModifyPath run skipped.
    function Invoke-UserPathSetup {
        if ($NoModifyPath -or $DryRun) {
            return $false
        }
        $pathUpdated = $false
        # Read and written as stored, so entries like %LOCALAPPDATA%\... stay unexpanded.
        $envKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
        try {
            $userPath = [string]$envKey.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
            if (-not (Test-PathListEntry $userPath $InstallDir)) {
                $newUserPath = if ($userPath) { "$InstallDir;$userPath" } else { $InstallDir }
                $envKey.SetValue('Path', $newUserPath, [Microsoft.Win32.RegistryValueKind]::ExpandString)
                $pathUpdated = $true
            }
        } finally {
            $envKey.Dispose()
        }
        if ($pathUpdated) {
            # Setting a user variable through .NET tells Explorer, and so new terminals, to re-read
            # the environment.
            [Environment]::SetEnvironmentVariable('DEXTO_INSTALL_PATH_REFRESH', '1', 'User')
            [Environment]::SetEnvironmentVariable('DEXTO_INSTALL_PATH_REFRESH', $null, 'User')
            Write-Note "Added $InstallDir to your user PATH. Open a new terminal to use it there."
        }
        if (-not (Test-PathListEntry $env:Path $InstallDir)) {
            $env:Path = "$InstallDir;$env:Path"
        }
        return $pathUpdated
    }

    if ($action -eq 'unchanged') {
        Write-Note "$DextoPackage $targetVersion is already installed at $launcherPath."
        Write-Result 'unchanged' (Invoke-UserPathSetup)
        return
    }

    if ($DryRun) {
        $planned = switch ($action) {
            'installed' { 'install' }
            'upgraded' { 'upgrade' }
            default { 'reinstall' }
        }
        Write-Note "Dry run: would $planned $DextoPackage $targetVersion at $launcherPath. Nothing was changed."
        Write-Result $planned $false
        return
    }

    try {
        New-Item -ItemType Directory -Force -Path $cliRoot, $InstallDir | Out-Null
    } catch {
        Fail 'failed' "Could not create $cliRoot or $InstallDir." 'Check that you can write to them, or pass another -InstallDir.'
    }
    $state.WorkDir = Join-Path $cliRoot (".download-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $state.WorkDir | Out-Null

    Write-Note "Downloading $DextoPackage@$targetVersion..."
    $pack = Invoke-Native $npmPath @('pack', "$DextoPackage@$targetVersion", '--pack-destination', $state.WorkDir, '--loglevel=error')
    if ($pack.Stderr) {
        Write-Note $pack.Stderr
    }
    if ($pack.ExitCode -ne 0) {
        Fail 'download_failed' "Could not download $DextoPackage@$targetVersion from the npm registry." 'Check your network and npm registry settings, then run the installer again.'
    }
    $tarball = Get-ChildItem -LiteralPath $state.WorkDir -Filter '*.tgz' | Select-Object -First 1
    if (-not $tarball) {
        Fail 'download_failed' "npm pack did not produce a tarball for $DextoPackage@$targetVersion." ''
    }

    $sha512 = [Security.Cryptography.SHA512]::Create()
    try {
        $hash = $sha512.ComputeHash([IO.File]::ReadAllBytes($tarball.FullName))
    } finally {
        $sha512.Dispose()
    }
    $actualIntegrity = 'sha512-' + [Convert]::ToBase64String($hash)
    if ($actualIntegrity -cne $resolved.Integrity) {
        Fail 'checksum_mismatch' "The downloaded $DextoPackage@$targetVersion tarball does not match the registry's sha512 integrity." 'Run the installer again; if it keeps failing, report it at https://github.com/truffle-ai/dexto/issues'
    }
    Write-Note "Checksum verified ($($resolved.Integrity.Substring(0, 17))...)."

    $state.StagingDir = Join-Path $cliRoot (".staging-$targetVersion-" + [guid]::NewGuid().ToString('N'))
    Write-Note "Installing into $versionDir..."
    $install = Invoke-Native $npmPath @('install', '--global', '--prefix', $state.StagingDir, '--no-audit', '--no-fund', '--loglevel=error', $tarball.FullName)
    if ($install.Stderr) {
        Write-Note $install.Stderr
    }
    if ($install.ExitCode -ne 0) {
        # Node.js 20 has no prebuilt SQLite binary, so npm builds it and needs a C++ compiler.
        $installFix = if ($nodeMajor -lt 22) { "Upgrade to Node.js 22 or later (https://nodejs.org); Node.js $nodeMajor needs Python and a C++ compiler to build SQLite. Then run the installer again." } else { 'See the npm output above, then run the installer again.' }
        Fail 'install_failed' "npm could not install $DextoPackage@$targetVersion." $installFix
    }
    $stagedCmd = Join-Path $state.StagingDir 'dexto.cmd'
    if (-not (Test-Path -LiteralPath $stagedCmd)) {
        Fail 'install_failed' 'The installed package has no dexto command.' ''
    }
    $reportedVersion = (Invoke-Native $stagedCmd @('--version')).Stdout
    if (-not $reportedVersion.Contains($targetVersion)) {
        $got = if ($reportedVersion) { $reportedVersion } else { 'nothing' }
        Fail 'verify_failed' "The installed dexto did not report version $targetVersion (got: $got)." 'Run the installer again with -Force.'
    }

    # Reinstalling a version moves the current copy aside rather than deleting it: it may be the
    # one running `dexto upgrade`. Windows refuses the move while a dexto has its files loaded.
    $replacedDir = $null
    if (Test-Path -LiteralPath $versionDir) {
        $replacedDir = Join-Path $cliRoot (".replaced-$targetVersion-" + [guid]::NewGuid().ToString('N') + "-$PID")
        try {
            Move-Item -LiteralPath $versionDir -Destination $replacedDir
        } catch {
            Fail 'install_failed' "Could not replace $versionDir, which is in use." 'Close any running dexto, then run the installer again.'
        }
    }
    try {
        Move-Item -LiteralPath $state.StagingDir -Destination $versionDir
    } catch {
        if ($replacedDir) {
            Move-Item -LiteralPath $replacedDir -Destination $versionDir -ErrorAction SilentlyContinue
        }
        Fail 'install_failed' "Could not move the install into $versionDir." ''
    }
    $state.StagingDir = $null

    $launcherTemp = "$launcherPath.tmp-$PID"
    $state.LauncherTemp = $launcherTemp
    [IO.File]::WriteAllText($launcherTemp, $launcherText, $launcherEncoding)

    # A 1.x standalone dexto.exe would run before dexto.cmd. It may be the running `dexto upgrade`,
    # which Windows won't delete but will rename, so move it aside first.
    foreach ($stale in @(Get-ChildItem -LiteralPath $InstallDir -Filter 'dexto.exe*' -ErrorAction SilentlyContinue)) {
        $aside = $stale.FullName
        if ($stale.Name -ieq 'dexto.exe') {
            $aside = Join-Path $InstallDir ("dexto.exe.old-" + [guid]::NewGuid().ToString('N'))
            Move-Item -LiteralPath $stale.FullName -Destination $aside
        }
        Remove-Item -LiteralPath $aside -Force -ErrorAction SilentlyContinue
    }

    Move-Item -LiteralPath $launcherTemp -Destination $launcherPath -Force
    $state.LauncherTemp = $null

    $meta = [ordered]@{
        schemaVersion = 1
        method = 'native'
        installedPath = $launcherPath
        installedAt = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        version = $targetVersion
        sourceUrl = $resolved.Tarball
        releaseTag = "dexto@$targetVersion"
        platform = 'win32'
        arch = $arch
    }
    $metaTemp = "$metadataPath.tmp-$PID"
    [IO.File]::WriteAllText($metaTemp, ($meta | ConvertTo-Json -Depth 4) + "`n", (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $metaTemp -Destination $metadataPath -Force

    # A launcher left in another install dir would point at a version removed below.
    if ($previousPath -and ($previousPath -ine $launcherPath) -and (Test-Path -LiteralPath $previousPath)) {
        $previousText = Get-Content -LiteralPath $previousPath -Raw -ErrorAction SilentlyContinue
        # Launchers name the CLI dir as %USERPROFILE%\.dexto\cli, older ones by its full path.
        if ($previousText -and [Environment]::ExpandEnvironmentVariables($previousText).Contains($cliRoot)) {
            Remove-Item -LiteralPath $previousPath -Force -ErrorAction SilentlyContinue
        }
    }

    # The previous version stays until the next install: when `dexto upgrade` runs this, cmd.exe is
    # still reading that version's dexto.cmd, and would fail once node exits if it were gone.
    $keepDir = if ($previousVersion) { Join-Path $cliRoot $previousVersion } else { $null }
    foreach ($oldDir in @(Get-ChildItem -LiteralPath $cliRoot -Directory)) {
        if (-not $oldDir.Name.StartsWith('.') -and ($oldDir.FullName -ine $versionDir) -and ($oldDir.FullName -ine $keepDir)) {
            Remove-Item -LiteralPath $oldDir.FullName -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    # Leftovers of runs that were killed before cleaning up: downloads and staging dirs over a day
    # old, and copies moved aside by a run that has exited. A moved copy keeps its old timestamp, so
    # it's matched by the PID at the end of its name instead.
    $staleBefore = [DateTime]::Now.AddDays(-1)
    foreach ($leftover in @(Get-ChildItem -LiteralPath $cliRoot -Directory -Force)) {
        $isReplaced = $false
        if ($leftover.Name.StartsWith('.replaced-') -and ($leftover.FullName -ine $replacedDir)) {
            $ownerPid = $leftover.Name.Substring($leftover.Name.LastIndexOf('-') + 1)
            $isReplaced = ($ownerPid -match '^[0-9]+$') -and -not (Get-Process -Id ([int]$ownerPid) -ErrorAction SilentlyContinue)
        }
        $isAbandoned = ($leftover.Name.StartsWith('.download-') -or $leftover.Name.StartsWith('.staging-')) -and
            ($leftover.LastWriteTime -lt $staleBefore)
        if ($isReplaced -or $isAbandoned) {
            Remove-Item -LiteralPath $leftover.FullName -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    Remove-Item -LiteralPath $state.WorkDir -Recurse -Force -ErrorAction SilentlyContinue
    $state.WorkDir = $null

    $pathUpdated = Invoke-UserPathSetup

    Write-Note "Installed $DextoPackage $targetVersion at $launcherPath."
    Write-Result $action $pathUpdated
}
} catch {
    if ("$_" -ne 'dexto-installer-stopped') {
        $message = "The installer stopped unexpectedly: $_"
        [Console]::Error.WriteLine("error: $message")
        $line = [ordered]@{ error = [ordered]@{ code = 'failed'; message = $message; fix = 'Run the installer again; if it keeps failing, report it at https://github.com/truffle-ai/dexto/issues' } } |
            ConvertTo-Json -Compress -Depth 4
        [Console]::Out.WriteLine($line)
        $DextoInstallState.ExitCode = 1
    }
} finally {
    foreach ($leftover in @($DextoInstallState.StagingDir, $DextoInstallState.WorkDir, $DextoInstallState.LauncherTemp)) {
        if ($leftover -and (Test-Path -LiteralPath $leftover)) {
            Remove-Item -LiteralPath $leftover -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

# `exit` in a script run by `irm | iex` would close the person's PowerShell window, so the exit
# code is only returned when PowerShell was started just to run this (as `dexto upgrade` and
# agents do); otherwise it is left in $LASTEXITCODE.
if ($DextoInstallState.ExitCode -ne 0) {
    $hostArgs = @([Environment]::GetCommandLineArgs() | Select-Object -Skip 1)
    $startedForCommand = @($hostArgs | Where-Object { $_ -match '^[-/](c|co|com|comm|comma|comman|command|f|fi|fil|file|e|ec|en|enc|encodedcommand)$' }).Count -gt 0
    $keepsWindowOpen = @($hostArgs | Where-Object { $_ -match '^[-/]noe(x|xi|xit)?$' }).Count -gt 0
    if (($startedForCommand -and -not $keepsWindowOpen) -or -not [Environment]::UserInteractive) {
        exit $DextoInstallState.ExitCode
    }
    $global:LASTEXITCODE = $DextoInstallState.ExitCode
}
