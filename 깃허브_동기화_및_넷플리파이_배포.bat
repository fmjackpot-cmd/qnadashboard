@echo off
title GitHub Sync & Netlify Deploy

echo ====================================================
echo   GitHub Sync and Netlify Auto Deploy
echo ====================================================
echo.

if not exist ".git" (
    echo [Step 1] Initializing Git repository...
    git init
    git branch -M main
)

rem Ensure remote origin is set
git remote remove origin >nul 2>nul
git remote add origin https://github.com/fmjackpot-cmd/qnadashboard.git
git branch -M main

rem Auto configure user identity for commits
git config user.name "fmjackpot-cmd"
git config user.email "fmjackpot-cmd@users.noreply.github.com"

echo [Step 2] Adding files to git...
git add index.html style.css app.js manifest.json .gitignore .env.example
git add *.html *.txt *.bat *.pdf *.hwpx

echo [Step 3] Committing changes...
git commit -m "Update smart budget dashboard"

echo [Step 4] Pushing to GitHub...
git push -u origin main

if %errorlevel% equ 0 (
    echo.
    echo ====================================================
    echo   SUCCESS! Pushed to GitHub successfully!
    echo   Netlify will automatically deploy in 10~20 seconds.
    echo ====================================================
) else (
    echo.
    echo ====================================================
    echo   [Notice] If browser popup appears, please click
    echo   'Sign in with your browser' to authenticate GitHub.
    echo ====================================================
)

echo.
pause
