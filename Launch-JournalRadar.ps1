param([switch]$NoWindow)
$ErrorActionPreference = 'Stop'
$radarUrl = 'http://127.0.0.1:8766/'
$radarPython = Join-Path $PSScriptRoot '.desktop-venv\Scripts\pythonw.exe'
$radarEntry = Join-Path $PSScriptRoot 'radar\desktop.py'
$radarData = Join-Path $PSScriptRoot '.desktop-data'
if (-not (Test-Path -LiteralPath $radarPython)) { throw '请先运行 Install-DesktopShortcut.ps1 安装本机采集组件。' }
New-Item -ItemType Directory -Force -Path $radarData | Out-Null
$radarSession = $null
try { $radarSession = Invoke-RestMethod ($radarUrl + 'api/session') -TimeoutSec 2 } catch {}
if ($radarSession -and $radarSession.app -ne 'journal-radar-desktop') { throw '本机端口被其他程序使用，请检查 8766 端口。' }
if (-not $radarSession) {
    Start-Process -FilePath $radarPython -ArgumentList @(('"'+$radarEntry+'"'),'--data-dir',('"'+$radarData+'"')) -WindowStyle Hidden -RedirectStandardError (Join-Path $radarData 'desktop-error.log') -RedirectStandardOutput (Join-Path $radarData 'desktop.log') | Out-Null
    for ($radarAttempt=0; $radarAttempt -lt 40; $radarAttempt++) {
        Start-Sleep -Milliseconds 500
        try { $radarSession = Invoke-RestMethod ($radarUrl + 'api/session') -TimeoutSec 2; break } catch {}
    }
}
if (-not $radarSession -or $radarSession.app -ne 'journal-radar-desktop') { throw "本机组件未启动，请查看 $radarData\desktop-error.log" }
if (-not $radarSession.running -and (-not $radarSession.last_finished -or ((Get-Date) - [datetime]$radarSession.last_finished).TotalMinutes -ge 15)) {
    Invoke-RestMethod ($radarUrl + 'api/sync') -Method Post -Headers @{'X-Radar-Token'=$radarSession.token} | Out-Null
}
if (-not $NoWindow) {
    $radarEdge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe", "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $radarEdge) { throw '未找到 Microsoft Edge。' }
    # This window is the application explicitly opened by the user.
    Start-Process -FilePath $radarEdge -ArgumentList "--app=$radarUrl"
}
Write-Output '期刊雷达本机组件已就绪。'
