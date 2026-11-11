@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-local.ps1" -App
if errorlevel 1 pause
exit /b %errorlevel%
