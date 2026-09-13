param([string]$AppUrl = 'https://linkingoscar.github.io/journal-radar/')
$ErrorActionPreference = 'Stop'
$radarEdge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe", "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $radarEdge) { throw '未找到 Microsoft Edge。请用浏览器打开在线地址并选择安装应用。' }
if ($AppUrl -notmatch '^https://[a-zA-Z0-9.-]+/[a-zA-Z0-9_./-]*$') { throw '请提供有效的 HTTPS 应用地址。' }
$radarDesktop = [Environment]::GetFolderPath('Desktop')
$radarLink = Join-Path $radarDesktop '期刊雷达.lnk'
$radarShell = New-Object -ComObject WScript.Shell
if (Test-Path -LiteralPath $radarLink) {
    $radarExisting = $radarShell.CreateShortcut($radarLink)
    if ($radarExisting.Arguments -ne "--app=$AppUrl") { throw '桌面已存在同名快捷方式，为避免覆盖，请先重命名。' }
}
$radarShortcut = $radarShell.CreateShortcut($radarLink)
$radarShortcut.TargetPath = $radarEdge
$radarShortcut.Arguments = "--app=$AppUrl"
$radarShortcut.IconLocation = Join-Path $PSScriptRoot 'radar\web\icon.ico'
$radarShortcut.Description = '期刊雷达 · 核心10 / FT50 / UTD24'
$radarShortcut.WorkingDirectory = $PSScriptRoot
$radarShortcut.Save()
Write-Output "已创建：$radarLink"
