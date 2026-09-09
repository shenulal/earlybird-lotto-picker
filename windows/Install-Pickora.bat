@echo off
REM ===========================================================================
REM  Pickora - one-click installer for Windows
REM
REM  Double-click this file. It finds a runtime, checks the application files,
REM  creates Desktop and Start Menu shortcuts, and starts Pickora.
REM
REM  Works with no internet connection provided either:
REM    - Node.js is already installed, or
REM    - a Node.js installer / portable build sits in the "vendor" folder.
REM ===========================================================================

setlocal EnableExtensions EnableDelayedExpansion
title Pickora Setup

REM PowerShell does the work; this wrapper only exists so the user can
REM double-click a .bat, which Windows runs without a security prompt.
set "HERE=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%install.ps1" %*

if errorlevel 1 (
  echo.
  echo Setup did not finish. The message above explains why.
  echo.
  pause
  exit /b 1
)

exit /b 0
