@echo off
REM Removes the Pickora shortcuts. Your event data stays in the Pickora folder.
setlocal EnableExtensions
title Pickora Uninstall
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"
pause
exit /b 0
