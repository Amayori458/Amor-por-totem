@echo off
setlocal
title Amor por Fotos - Totem
cd /d "%~dp0"

rem  Duplo clique: abre o totem em tela cheia, imprimindo direto na impressora padrao.
rem  "Iniciar-Teste.bat" chama este arquivo com o parametro "teste" (janela normal).
set "MODO=--totem"
if /i "%~1"=="teste" set "MODO=--teste"

set "NODE="
if exist "%~dp0runtime\node\node.exe" set "NODE=%~dp0runtime\node\node.exe"
if not defined NODE for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE set "NODE=%%i"
if defined NODE goto iniciar

echo.
echo   O Node.js ainda nao esta neste computador.
echo   Vou baixar uma copia so para o totem (cerca de 30 MB). Aguarde...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar-node.ps1"
if errorlevel 1 goto falha
set "NODE=%~dp0runtime\node\node.exe"
if not exist "%NODE%" goto falha

:iniciar
"%NODE%" server.js %MODO%
if errorlevel 1 pause
goto :eof

:falha
echo.
echo   Nao consegui baixar o Node.js. Confira a internet e tente de novo,
echo   ou instale pelo site https://nodejs.org (botao LTS) e abra este arquivo outra vez.
echo.
pause
