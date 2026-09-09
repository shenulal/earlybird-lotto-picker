@echo off
REM Starts Pickora and opens the draw board. Close this window to stop it.
setlocal EnableExtensions
title Pickora
set "HERE=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%start.ps1" %*
if errorlevel 1 pause
exit /b 0
