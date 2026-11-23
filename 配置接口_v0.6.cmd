@echo off
setlocal
chcp 65001 >nul
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0工具_v0.6\启动.ps1" -Configure
set "task_exit=%errorlevel%"
pause
exit /b %task_exit%
