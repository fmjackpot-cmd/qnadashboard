@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\allow-server-firewall.ps1" %*
pause
