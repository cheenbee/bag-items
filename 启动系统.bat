@echo off
chcp 65001 >nul
cd /d "%~dp0"
docker compose up -d --build
if errorlevel 1 (
  echo.
  echo 启动失败，请确认 Docker Desktop 已安装并正在运行。
  pause
  exit /b 1
)
echo.
echo 系统已启动：http://localhost:8080
echo 局域网访问：http://本机IP:8080
start "" http://localhost:8080
pause
