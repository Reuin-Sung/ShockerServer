# PowerShell script to update code from git, update packages, and start the application
# Usage: .\update-and-start.ps1

# Exit on error
$ErrorActionPreference = "Stop"

Write-Host "🔄 Starting update process..." -ForegroundColor Yellow

# Get the directory where the script is located
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $SCRIPT_DIR

try {
    # Step 1: Update from git
    Write-Host "📥 Updating code from git..." -ForegroundColor Yellow
    git pull
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Git update completed" -ForegroundColor Green
    } else {
        Write-Host "❌ Git update failed" -ForegroundColor Red
        exit 1
    }

    # Step 2: Update npm packages
    Write-Host "📦 Updating npm packages..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Package update completed" -ForegroundColor Green
    } else {
        Write-Host "❌ Package update failed" -ForegroundColor Red
        exit 1
    }

    # Step 3: Start the application
    Write-Host "🚀 Starting application..." -ForegroundColor Yellow
    Write-Host "✅ All updates completed successfully!" -ForegroundColor Green
    Write-Host "⚠️  Application is starting... (Press Ctrl+C to stop)" -ForegroundColor Yellow
    npm start
} catch {
    Write-Host "❌ Error: $_" -ForegroundColor Red
    exit 1
}

