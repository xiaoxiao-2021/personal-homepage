@echo off
setlocal
cd /d "%~dp0"
set "APP_EXE=%~dp0node_modules\electron\dist\electron.exe"

if not exist "%APP_EXE%" (
  echo.
  echo Personal Homepage startup file was not found:
  echo %APP_EXE%
  echo Keep the personal-homepage-app folder intact. If this continues, share this window.
  pause
  exit /b 1
)

"%APP_EXE%" --disable-gpu .
set "APP_EXIT=%ERRORLEVEL%"

if not "%APP_EXIT%"=="0" (
  echo.
  echo Personal Homepage did not start. Exit code: %APP_EXIT%
  echo Keep this window open and share the message above.
  pause
)

exit /b %APP_EXIT%
