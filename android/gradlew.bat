@echo off
setlocal EnableExtensions
set "GRADLE_VERSION=8.9"
set "GRADLE_HOME=%USERPROFILE%\.gradle\shot_or_bootstrap\gradle-%GRADLE_VERSION%"
set "GRADLE_ZIP=%USERPROFILE%\.gradle\shot_or_bootstrap\gradle-%GRADLE_VERSION%-bin.zip"
set "GRADLE_URL=https://services.gradle.org/distributions/gradle-%GRADLE_VERSION%-bin.zip"

if not exist "%GRADLE_HOME%\bin\gradle.bat" (
  echo Gradle %GRADLE_VERSION% is not cached. Downloading it now.
  echo An internet connection is required for this first run.
  if not exist "%USERPROFILE%\.gradle\shot_or_bootstrap" mkdir "%USERPROFILE%\.gradle\shot_or_bootstrap"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Invoke-WebRequest -Uri '%GRADLE_URL%' -OutFile '%GRADLE_ZIP%'; Expand-Archive -LiteralPath '%GRADLE_ZIP%' -DestinationPath '%USERPROFILE%\.gradle\shot_or_bootstrap' -Force"
  if errorlevel 1 (
    echo ERROR: Gradle download or extraction failed. Check internet access and try again.
    exit /b 1
  )
)

call "%GRADLE_HOME%\bin\gradle.bat" %*
set "RESULT=%ERRORLEVEL%"
endlocal & exit /b %RESULT%
