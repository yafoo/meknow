@echo off
rem ============================================================
rem  MeNote Android - one-click release build
rem  Usage: double-click this file, or run from cmd
rem  Steps: set JDK 20 -> gradlew assembleRelease -> copy APK
rem         to this folder as MeNote-vX.Y-arm64.apk
rem ============================================================
setlocal
set "JAVA_HOME=D:\Program Files\Java\jdk-20"
set "PATH=%JAVA_HOME%\bin;%PATH%"

rem work in the folder where this script lives
cd /d "%~dp0"

echo === [1/3] Building release APK (JDK 20) ...
echo.
call gradlew.bat assembleRelease --no-daemon
if errorlevel 1 goto :fail

rem read versionName from app\build.gradle.kts  e.g.  versionName = "2.3"
for /f "tokens=2 delims== " %%v in ('findstr /c:"versionName" "app\build.gradle.kts"') do set "VER=%%~v"
if "%VER%"=="" set "VER=unknown"

echo.
echo === [2/3] Copying APK as MeNote-v%VER%-arm64.apk ...
copy /y "app\build\outputs\apk\release\app-release.apk" "MeNote-v%VER%-arm64.apk" >nul
if errorlevel 1 goto :fail

echo.
echo === [3/3] DONE:
echo     %~dp0MeNote-v%VER%-arm64.apk
echo.
pause
exit /b 0

:fail
echo.
echo === BUILD FAILED - see error messages above.
pause
exit /b 1
