@echo off
REM Duplo clique para abrir o Life Dashboard no Windows.
REM Deixe esta janela aberta enquanto usa o painel. Para encerrar: Ctrl+C ou feche a janela.
cd /d "%~dp0.."
where node >nul 2>nul || (echo Node.js nao encontrado. Instale a versao LTS em https://nodejs.org && pause && exit /b 1)
start "" http://localhost:4310
npm start
pause
