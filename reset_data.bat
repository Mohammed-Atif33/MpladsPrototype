@echo off
cd /d "%~dp0"
echo.
echo  This will DELETE ALL DATA in the database and reload the demo data.
echo  (Users, projects, complaints, decisions - everything you created.)
echo.
set /p ok=Type YES to continue: 
if /i not "%ok%"=="YES" (
  echo Cancelled.
  pause
  exit /b
)
.venv\Scripts\python.exe -m database.seed --reset
echo.
pause
