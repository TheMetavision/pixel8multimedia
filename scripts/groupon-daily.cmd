@echo off
REM Pixel8 - daily Groupon voucher round.
REM Run by Windows Task Scheduler. Appends to groupon-exports\daily.log.

cd /d "%~dp0.."

set "LOG=groupon-exports\daily.log"

echo.>> "%LOG%"
echo ================================================>> "%LOG%"
echo %DATE% %TIME%>> "%LOG%"
echo ================================================>> "%LOG%"

REM Task Scheduler does not always inherit your interactive PATH, and a missing
REM node would otherwise fail silently and leave nothing but a timestamp.
where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: node was not found on PATH. Set the task to run as your own user,>> "%LOG%"
  echo or replace "node" below with the full path from: where node>> "%LOG%"
  exit /b 1
)

node --env-file=.env scripts\groupon-daily.mjs>> "%LOG%" 2>&1
set RC=%ERRORLEVEL%

if %RC%==0 echo [run finished: nothing needs attention]>> "%LOG%"
if %RC%==10 echo [run finished: SOMETHING NEEDS ATTENTION]>> "%LOG%"
if not %RC%==0 if not %RC%==10 echo [run FAILED with exit code %RC%]>> "%LOG%"

exit /b %RC%
