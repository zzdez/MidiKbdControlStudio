@echo off
setlocal

echo --- 1. ACTIVATION VENV ---
if exist venv\Scripts\activate.bat (
    call venv\Scripts\activate.bat
) else (
    echo ERREUR : 'venv' introuvable.
    pause
    exit /b
)

echo.
echo --- 2. NETTOYAGE ---
:: On nettoie le nouvel EXE
if exist "AirstepStudio.exe" del /F /Q "AirstepStudio.exe"
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist
if exist *.spec del *.spec
if exist src\build rmdir /s /q src\build
if exist src\dist rmdir /s /q src\dist
if exist src\*.spec del src\*.spec

echo.
echo --- 3. COMPILATION (MODE WEB) ---
cd src

:: COMMANDE PYINSTALLER POUR FASTAPI/WEB :
:: --add-data "../web;web" : Indispensable pour embarquer le site
:: --hidden-import : On ajoute uvicorn et fastapi pour eviter les erreurs
:: On retire Tkinter/PIL qui ne servent plus
pyinstaller --noconfirm --onefile --windowed ^
 --name "AirstepStudio" ^
 --add-data "../config.json;." ^
 --add-data "../web;web" ^
 --hidden-import "uvicorn" ^
 --hidden-import "fastapi" ^
 --hidden-import "websockets" ^
 --hidden-import "mido.backends.rtmidi" ^
 --hidden-import "bleak" ^
 --paths "." ^
 main.py

cd ..

echo.
echo --- 4. RECUPERATION ---
if exist "src\dist\AirstepStudio.exe" (
    move /Y "src\dist\AirstepStudio.exe" "AirstepStudio.exe"
    echo.
    echo ====================================================
    echo  SUCCES : AirstepStudio.exe est pret a la racine !
    echo ====================================================
) else (
    echo.
    echo ====================================================
    echo  ECHEC : Compilation ratee.
    echo ====================================================
    pause
)

:: Nettoyage final
if exist src\build rmdir /s /q src\build
if exist src\dist rmdir /s /q src\dist
if exist src\*.spec del src\*.spec

echo Termine.
pause