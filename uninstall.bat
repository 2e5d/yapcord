@echo off
setlocal
cd /d "%~dp0"
echo.
python patcher.py uninstall
echo.
pause
