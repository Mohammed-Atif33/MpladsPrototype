@echo off
cd /d "%~dp0"
where py >nul 2>nul && (py -3 setup.py %*) || (python setup.py %*)
echo.
pause
