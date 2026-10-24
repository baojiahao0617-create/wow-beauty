# WOW!美炸了 — 无界体验家

欧莱雅 Beauty Techathon 赛题三「无界体验家」参赛作品。

**队伍：** 美炸小队  
**一句话：** 看懂你的脸，匹配欧莱雅好上手产品，镜头标出该涂哪里。

## 功能

1. **看见自己** — 上传素颜照，通义视觉给出优点优先分析  
2. **安心选购** — 从巴黎欧莱雅 / 美宝莲目录推荐 3 支  
3. **手把手学** — MediaPipe FaceMesh + 实时教练反馈  
4. **看见成长** — 妆前妆后对比，鼓励式点评  

无障碍：大字号 / 高对比 / 语音导览

## 技术栈

- FastAPI + Uvicorn  
- 通义千问：`qwen3-vl-plus`（视觉）/ `qwen-plus`（选品）  
- MediaPipe FaceMesh、Web Speech API  

## 本地运行

1. 安装 Python 3.10+
2. 复制 `.env.example` 为 `.env`，填入你的 [DashScope API Key](https://dashscope.console.aliyun.com/)
3. 安装依赖并启动：

```bash
pip install -r requirements.txt
python -m uvicorn server:app --host 127.0.0.1 --port 8787
```

浏览器打开 http://127.0.0.1:8787

Windows 也可双击 `双击启动网站.bat`。

## 在线 Demo

若服务器在线：https://116.62.84.244:8787  
（自签证书首次需点「高级 → 继续访问」；本地启动更适合体验摄像头。）

## 许可证

本仓库仅用于黑客松演示与学习交流。
