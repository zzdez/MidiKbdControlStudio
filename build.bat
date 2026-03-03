@echo off
setlocal enabledelayedexpansion

echo ========================================================
echo   COMPILATION MIDI-KBD CONTROL STUDIO (FULL MUTAGEN SUPPORT)
echo ========================================================

:: 1. TUER L'APPLICATION
taskkill /F /IM "MidiKbdControlStudio.exe" >nul 2>&1
timeout /t 1 /nobreak >nul

:: 2. VERIFICATION ENV
if exist venv\Scripts\activate.bat (
    call venv\Scripts\activate.bat
) else (
    echo [ERREUR] venv introuvable.
    pause
    exit /b
)

:: 3. PREPARATION FICHIERS
if exist _BUILD_TEMP rmdir /s /q _BUILD_TEMP
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist
if exist *.spec del *.spec
if exist MidiKbdControlStudio.exe del MidiKbdControlStudio.exe

mkdir _BUILD_TEMP
copy src\*.py _BUILD_TEMP\ >nul
copy config.json _BUILD_TEMP\ >nul

if exist web (
    mkdir _BUILD_TEMP\web
    xcopy web _BUILD_TEMP\web /s /e /y >nul
)
if exist assets (
    mkdir _BUILD_TEMP\assets
    xcopy assets _BUILD_TEMP\assets /s /e /y >nul
)
if exist locales (
    mkdir _BUILD_TEMP\locales
    xcopy locales _BUILD_TEMP\locales /s /e /y >nul
)

:: 4. COMPILATION
cd _BUILD_TEMP

:: COMMANDE AVEC TOUS LES MODULES MUTAGEN EXPLICITES
pyinstaller --noconfirm --onefile --windowed ^
 --name "MidiKbdControlStudio" ^
 --add-data "config.json;." ^
 --add-data "web;web" ^
 --add-data "assets;assets" ^
 --add-data "locales;locales" ^
 --hidden-import "uvicorn" ^
 --hidden-import "uvicorn.logging" ^
 --hidden-import "uvicorn.loops" ^
 --hidden-import "uvicorn.loops.auto" ^
 --hidden-import "uvicorn.protocols" ^
 --hidden-import "uvicorn.protocols.http" ^
 --hidden-import "uvicorn.protocols.http.auto" ^
 --hidden-import "uvicorn.protocols.websockets" ^
 --hidden-import "uvicorn.protocols.websockets.auto" ^
 --hidden-import "uvicorn.lifespan" ^
 --hidden-import "uvicorn.lifespan.on" ^
 --hidden-import "fastapi" ^
 --hidden-import "websockets" ^
 --hidden-import "requests" ^
 --hidden-import "customtkinter" ^
 --hidden-import "context_monitor" ^
 --hidden-import "pystray" ^
 --hidden-import "PIL" ^
 --hidden-import "mido.backends.rtmidi" ^
 --hidden-import "bleak" ^
 --hidden-import "mutagen" ^
 --hidden-import "mutagen.mp3" ^
 --hidden-import "mutagen.easyid3" ^
 --hidden-import "mutagen.oggvorbis" ^
 --hidden-import "mutagen.flac" ^
 --hidden-import "mutagen.wave" ^
 --hidden-import "mutagen.mp4" ^
 --hidden-import "mutagen.easymp4" ^
 --hidden-import "musicbrainzngs" ^
 --hidden-import "yt_dlp" ^
 --hidden-import "numpy" ^
 --hidden-import "soundfile" ^
 --hidden-import "_cffi_backend" ^
 --collect-all "pygame" ^
 main.py
:: ... (Existing content skipped, ensuring Hidden Imports remain) ...

:: 5. FINALISATION
cd ..
if exist "_BUILD_TEMP\dist\MidiKbdControlStudio.exe" (
    move /Y "_BUILD_TEMP\dist\MidiKbdControlStudio.exe" "MidiKbdControlStudio.exe" >nul
    echo.
    echo [SUCCES] MidiKbdControlStudio.exe est pret !
) else (
    echo [ECHEC] L'executable n'a pas ete cree.
    pause
    exit /b
)

rmdir /s /q _BUILD_TEMP
rmdir /s /q build
rmdir /s /q dist
del *.spec

echo Termine.
pause