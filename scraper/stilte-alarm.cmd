@echo off
REM Wrapper voor de Windows-taak "Stadsgeest stilte-alarm".
REM Reden voor deze omweg: het pad naar de projectmap bevat spaties, en de
REM combinatie van schtasks-argumentquoting en powershell -File liep daarop stuk.
REM De taak startte wel (resultaat 0) maar er gebeurde niets, ook geen logregel.
REM Met een .cmd staat alle quoting op één plek en is het te lezen.
setlocal
set "MAP=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%MAP%stilte-alarm.ps1"
exit /b %ERRORLEVEL%
