@echo off
REM Pixel8 - daily Groupon voucher round.
REM Run by Windows Task Scheduler. Appends to groupon-exports\daily.log.

cd /d "%~dp0.."

echo.>> groupon-exports\daily.log
echo ================================================>> groupon-exports\daily.log
echo %DATE% %TIME%>> groupon-exports\daily.log
echo ================================================>> groupon-exports\daily.log

node --env-file=.env scripts\groupon-daily.mjs>> groupon-exports\daily.log 2>&1

REM Exit code 10 means something needs attention; 0 means a quiet day.
exit /b %ERRORLEVEL%
