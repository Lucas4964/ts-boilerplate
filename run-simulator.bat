@echo off
REM ===================================================================
REM  Circuit Simulator launcher (Windows)
REM  Double-click this file to build and open the simulator in your
REM  browser. Requires Node.js (https://nodejs.org). Closing this
REM  window stops the local server.
REM ===================================================================
setlocal
cd /d "%~dp0"

echo.
echo   Circuit Simulator - starting...
echo.

REM --- Node.js present? ---
where node >nul 2>nul
if errorlevel 1 (
    echo   [X] Node.js was not found.
    echo       Install it from https://nodejs.org then run this file again.
    echo.
    pause
    exit /b 1
)

REM --- Dependencies installed? ---
if not exist "node_modules" (
    echo   Installing dependencies ^(first run only^)...
    call npm install
    if errorlevel 1 (
        echo   [X] npm install failed. Check your internet connection.
        echo.
        pause
        exit /b 1
    )
)

REM --- Build (fast). If it fails, fall back to the last committed build. ---
echo   Building...
call npm run build
if errorlevel 1 (
    echo   [!] Build failed - serving the previous build instead.
)
if not exist "dist\index.html" (
    echo   [X] No build available to serve.
    echo.
    pause
    exit /b 1
)

REM --- Serve dist/ over HTTP and open the browser ---
echo.
echo   Opening the simulator at http://localhost:4173
echo   ^(Close this window to stop the server.^)
echo.
call npm run preview -- --open --port 4173 --strictPort

pause
endlocal
