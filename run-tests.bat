@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-tests.ps1"
exit /b %errorlevel%
