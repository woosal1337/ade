$ErrorActionPreference = 'Stop'
$adePackage = if ($env:ADE_PACKAGE) { $env:ADE_PACKAGE } else { 'github:woosal1337/ade' }
$adeSource = if ($args.Count -gt 0) { $args[0] } else { $env:ADE_SOURCE }
$minNode = 22

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "ade install: Node.js $minNode or later is not installed. Install it from https://nodejs.org, then run this script again."
}
$major = [int](& node -p 'process.versions.node.split(".")[0]')
if ($major -lt $minNode) {
  throw "ade install: Node.js $(& node --version) is too old. Install Node.js $minNode or later."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw 'ade install: npm is not installed.'
}

if ($env:ADE_SKIP_INSTALL -ne '1') {
  Write-Host "Installing ade from $adePackage"
  $failure = "ade install: npm could not build and install $adePackage. Make sure that Git is installed."
  if ($adePackage -match '\.(tgz|tar\.gz|tar)$') {
    & npm install -g $adePackage | Out-Host
    if ($LASTEXITCODE -ne 0) {
      throw $failure
    }
  } else {
    $sourceSpec = $adePackage
    if (Test-Path -LiteralPath $sourceSpec -PathType Container) {
      $sourceSpec = (Resolve-Path -LiteralPath $sourceSpec).Path
    }
    $work = Join-Path ([IO.Path]::GetTempPath()) ('ade-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $work | Out-Null
    try {
      Push-Location -LiteralPath $work
      try {
        & npm pack $sourceSpec --pack-destination $work --loglevel=error | Out-Null
        $packed = $LASTEXITCODE
      } finally {
        Pop-Location
      }
      $tarball = Get-ChildItem -LiteralPath $work -Filter '*.tgz' | Select-Object -First 1
      if ($packed -ne 0 -or -not $tarball) {
        throw $failure
      }
      & npm install -g $tarball.FullName | Out-Host
      if ($LASTEXITCODE -ne 0) {
        throw $failure
      }
    } finally {
      Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

$prefix = (& npm prefix -g).Trim()
$found = Get-Command ade -ErrorAction SilentlyContinue
$ade = if ($found) { $found.Source } else { Join-Path $prefix 'ade.cmd' }
if (-not (Test-Path $ade)) {
  throw "ade install: The ade command is not on the PATH. Add $prefix to the PATH."
}
Write-Host "ade $(& $ade --version)"

if (-not $adeSource) {
  Write-Host 'ade is installed. Next: run ade plan <source>'
  return
}

& $ade plan $adeSource
if ($LASTEXITCODE -ne 0) {
  throw 'ade install: The plan failed.'
}
if ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected -and -not [Console]::IsOutputRedirected) {
  & $ade apply $adeSource
} else {
  Write-Host "No terminal is available for the prompts. Next: run ade apply $adeSource"
}
