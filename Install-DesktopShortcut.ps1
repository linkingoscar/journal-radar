param([string]$AppUrl = 'https://linkingoscar.github.io/journal-radar/')
$ErrorActionPreference = 'Stop'
$radarEdge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe", "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $radarEdge) { throw '未找到 Microsoft Edge。请用浏览器打开在线地址并选择安装应用。' }
if ($AppUrl -notmatch '^https://[a-zA-Z0-9.-]+/[a-zA-Z0-9_./-]*$') { throw '请提供有效的 HTTPS 应用地址。' }
$radarPwsh = 'C:\Users\Lenovo\AppData\Local\Programs\PowerShell\7\pwsh.exe'
if (-not (Test-Path -LiteralPath $radarPwsh)) { $radarPwsh=(Get-Command pwsh -ErrorAction Stop).Source }
$radarLaunch = Join-Path $PSScriptRoot 'Launch-JournalRadar.ps1'
$radarVenv = Join-Path $PSScriptRoot '.desktop-venv'
$radarPython = Join-Path $radarVenv 'Scripts\python.exe'
if (-not (Test-Path -LiteralPath $radarPython)) {
    $radarBasePython=(Get-Command python -ErrorAction Stop).Source
    & $radarBasePython -m venv $radarVenv
    if ($LASTEXITCODE -ne 0) { throw '无法建立本机采集环境。' }
}
& $radarPython -m pip install -r (Join-Path $PSScriptRoot 'radar\requirements.txt')
if ($LASTEXITCODE -ne 0) { throw '本机采集组件安装失败。' }
$radarDesktop = [Environment]::GetFolderPath('Desktop')
$radarLink = Join-Path $radarDesktop '期刊雷达.lnk'
$radarShell = New-Object -ComObject WScript.Shell
if (Test-Path -LiteralPath $radarLink) {
    $radarExisting = $radarShell.CreateShortcut($radarLink)
    if ($radarExisting.Arguments -ne "--app=$AppUrl" -and -not $radarExisting.Arguments.Contains($radarLaunch)) { throw '桌面已存在同名快捷方式，为避免覆盖，请先重命名。' }
}
$radarShortcut = $radarShell.CreateShortcut($radarLink)
$radarShortcut.TargetPath = $radarPwsh
$radarShortcut.Arguments = '-NoLogo -NoProfile -WindowStyle Hidden -File "'+$radarLaunch+'"'
$radarShortcut.WindowStyle = 7
$radarShortcut.IconLocation = Join-Path $PSScriptRoot 'radar\web\icon.ico'
$radarShortcut.Description = '期刊雷达 · 核心10 / FT50 / UTD24'
$radarShortcut.WorkingDirectory = $PSScriptRoot
$radarShortcut.Save()
Write-Output "已创建：$radarLink"
