@echo off
chcp 65001 >nul
cd /d "%~dp0"
where python >nul 2>nul || (echo 请先安装 Python 3.10+ & pause & exit /b 1)
if not exist .env (
  echo 请先复制 .env.example 为 .env 并填入 DASHSCOPE_API_KEY
  pause
  exit /b 1
)
python -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple -q
start "" cmd /c "ping -n 3 127.0.0.1 >nul & start http://127.0.0.1:8787/"
python -m uvicorn server:app --host 127.0.0.1 --port 8787
pause
