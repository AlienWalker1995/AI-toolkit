@echo off
REM One-command entry for Windows cmd.exe — same as .\ai-toolkit.ps1
set "SCRIPT=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%ai-toolkit.ps1" %*
