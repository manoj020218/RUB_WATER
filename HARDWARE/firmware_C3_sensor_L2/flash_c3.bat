@echo off
title FloodGuard C3 Sensor — Flash Tool
cd /d "%~dp0"

:: ─── Build once if binary is missing ────────────────────────────────────────
set BIN=.pio\build\esp32-c3-devkitm-1\firmware.bin

if not exist "%BIN%" (
    echo.
    echo  [BUILD] No firmware.bin found — building now, please wait...
    echo.
    call pio run -e esp32-c3-devkitm-1
    if errorlevel 1 (
        echo.
        echo  [FAIL] Build failed. Fix errors above, then run again.
        pause
        exit /b 1
    )
    echo.
    echo  [OK] Build complete.
)

:: ─── Flash loop — press Enter for each board ─────────────────────────────────
:LOOP
echo.
echo  ============================================================
echo   FloodGuard ESP32-C3 Sensor Module Flasher
echo   Firmware: %BIN%
echo  ============================================================
echo.
echo   1. Connect ESP32-C3 via USB-C
echo   2. Make sure no serial monitor is open on that port
echo   3. Press ENTER to flash  ^|  type Q + ENTER to quit
echo.
set /p CHOICE=  >
if /i "%CHOICE%"=="q" goto :EOF

echo.
echo  [FLASH] Detecting port and uploading...
echo.
call pio run -e esp32-c3-devkitm-1 -t upload

if errorlevel 1 (
    echo.
    echo  [FAIL] Flash failed. Common causes:
    echo    - USB cable not connected or cable is charge-only
    echo    - Serial monitor still open on this port
    echo    - Driver not installed (check Device Manager for COM port)
    echo    - Board needs manual boot: hold BOOT button, press RST, release BOOT
    echo.
) else (
    echo.
    echo  ============================================================
    echo   [SUCCESS] Board flashed!
    echo  ============================================================
    echo.
    echo   Next steps for this board:
    echo     WiFi SSID : FgSensXXXXXX  (check serial monitor for exact name)
    echo     Password  : (none — open network)
    echo     Config URL: http://192.168.4.1
    echo     Login     : Hanuman#2026
    echo.
    echo   Setup checklist:
    echo     [ ] Set Current Value as Zero Reference (sensor at dry ground)
    echo     [ ] Set Level 1 and Level 2 thresholds
    echo     [ ] Set Trigger Delay and Clear Delay
    echo     [ ] Hide SSID (Network Visibility card)
    echo     [ ] Record device MAC / SSID name for maintenance log
    echo.
)

echo  Press ENTER to flash the next board, or type Q + ENTER to quit.
goto LOOP
