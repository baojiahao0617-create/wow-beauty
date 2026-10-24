"""
WOW!美炸了 — 本地/服务器 API 代理
用百炼兼容模式调用通义视觉与文本模型，避免前端暴露 Key。
"""
from __future__ import annotations

import base64
import json
import mimetypes
import os
import re
from typing import Any, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from openai import OpenAI

ROOT = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(ROOT, ".env"), override=True)

API_KEY = os.getenv("DASHSCOPE_API_KEY", "").strip()
BASE_URL = os.getenv(
    "DASHSCOPE_BASE_URL",
    "https://dashscope.aliyuncs.com/compatible-mode/v1",
).strip()
VL_MODEL = os.getenv("VL_MODEL", "qwen3-vl-plus").strip()
TEXT_MODEL = os.getenv("TEXT_MODEL", "qwen-plus").strip()
# 视觉模型回退列表（部分账号已下线旧名 qwen-vl-plus）
VL_MODEL_FALLBACKS = [
    m.strip()
    for m in os.getenv("VL_MODEL_FALLBACKS", "qwen3-vl-plus,qwen-vl-plus,qwen2.5-vl-plus").split(",")
    if m.strip()
]
PORT = int(os.getenv("PORT", "8787"))

app = FastAPI(title="WOW Beauty API", version="1.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 欧莱雅集团可演示选品库（巴黎欧莱雅 / 美宝莲纽约均为欧莱雅集团品牌）
LOREAL_CATALOG: list[dict[str, Any]] = [
    {
        "id": "true-match-foundation",
        "brand": "L'Oréal Paris",
        "brand_zh": "巴黎欧莱雅",
        "name": "真配粉底液",
        "name_en": "True Match Foundation",
        "category": "底妆",
        "price": "¥189",
        "difficulty": "低",
        "tags": ["暖皮", "冷皮", "中性", "底妆", "遮瑕", "新手", "均匀肤色"],
        "blurb": "按色号贴近肤色，质地轻薄好推开，新手不易结块斑驳。",
        "search": "欧莱雅真配粉底液",
        "image": "/static/images/products/foundation.jpg",
        "accent": "#C4A484",
    },
    {
        "id": "revitalift-serum",
        "brand": "L'Oréal Paris",
        "brand_zh": "巴黎欧莱雅",
        "name": "复颜专研抗皱精华",
        "name_en": "Revitalift Serum",
        "category": "护肤打底",
        "price": "¥259",
        "difficulty": "低",
        "tags": ["干燥", "暗沉", "提亮", "护肤", "新手", "气色"],
        "blurb": "上妆前一滴打底，肌肤更润更有光泽，减少粉底卡粉。",
        "search": "欧莱雅复颜抗皱精华",
        "image": "/static/images/products/serum.jpg",
        "accent": "#E8D5C4",
    },
    {
        "id": "color-riche-lipstick",
        "brand": "L'Oréal Paris",
        "brand_zh": "巴黎欧莱雅",
        "name": "纷泽滋润唇膏",
        "name_en": "Color Riche Lipstick",
        "category": "唇妆",
        "price": "¥129",
        "difficulty": "低",
        "tags": ["唇色", "暖皮", "气色", "新手", "低容错", "日常"],
        "blurb": "一抹提气色，滋润不干，零基础也能画出「有精神」的唇。",
        "search": "欧莱雅纷泽滋润唇膏",
        "image": "/static/images/products/lipstick.jpg",
        "accent": "#B34A5C",
    },
    {
        "id": "rouge-signature",
        "brand": "L'Oréal Paris",
        "brand_zh": "巴黎欧莱雅",
        "name": "印迹唇釉",
        "name_en": "Rouge Signature",
        "category": "唇妆",
        "price": "¥139",
        "difficulty": "低",
        "tags": ["唇色", "冷皮", "哑光", "持久", "新手", "显白"],
        "blurb": "轻薄哑光，晕开也好看，适合怕画唇线失败的新手。",
        "search": "欧莱雅印迹唇釉",
        "image": "/static/images/products/lipgloss.jpg",
        "accent": "#8B3A4A",
    },
    {
        "id": "infallible-blush",
        "brand": "L'Oréal Paris",
        "brand_zh": "巴黎欧莱雅",
        "name": "恒放溢彩腮红",
        "name_en": "Infallible Blush",
        "category": "腮红",
        "price": "¥119",
        "difficulty": "低",
        "tags": ["腮红", "气色", "暖皮", "新手", "日常", "提亮"],
        "blurb": "粉质细腻易晕染，一点点就能找回好气色。",
        "search": "欧莱雅恒放溢彩腮红",
        "image": "/static/images/products/blush.jpg",
        "accent": "#E8A0A8",
    },
    {
        "id": "paradise-mascara",
        "brand": "L'Oréal Paris",
        "brand_zh": "巴黎欧莱雅",
        "name": "惊艳特翘睫毛膏",
        "name_en": "Paradise Mascara",
        "category": "眼妆",
        "price": "¥109",
        "difficulty": "中",
        "tags": ["眼妆", "睫毛", "新手", "提神", "日常"],
        "blurb": "刷头好控制，先刷根部再拉长，眼睛立刻有精神。",
        "search": "欧莱雅惊艳特翘睫毛膏",
        "image": "/static/images/products/mascara.jpg",
        "accent": "#2A2A2A",
    },
    {
        "id": "la-palette-nude",
        "brand": "L'Oréal Paris",
        "brand_zh": "巴黎欧莱雅",
        "name": "浮生若梦眼影盘",
        "name_en": "La Palette Nude",
        "category": "眼妆",
        "price": "¥169",
        "difficulty": "中",
        "tags": ["眼妆", "眼影", "暖皮", "冷皮", "进阶", "日常"],
        "blurb": "大地色系容错高，先浅后深，跟着教练三步就能完成。",
        "search": "欧莱雅浮生若梦眼影盘",
        "image": "/static/images/products/eyeshadow.jpg",
        "accent": "#A67C52",
    },
    {
        "id": "uv-defender",
        "brand": "L'Oréal Paris",
        "brand_zh": "巴黎欧莱雅",
        "name": "多重防护隔离乳",
        "name_en": "UV Defender",
        "category": "妆前",
        "price": "¥149",
        "difficulty": "低",
        "tags": ["妆前", "防晒", "提亮", "新手", "日常", "暗沉"],
        "blurb": "妆前一步防晒+轻提亮，皮肤更干净，后续底妆更服帖。",
        "search": "欧莱雅多重防护隔离乳",
        "image": "/static/images/products/sunscreen.jpg",
        "accent": "#F5E6D3",
    },
    {
        "id": "maybelline-fit-me",
        "brand": "Maybelline New York",
        "brand_zh": "美宝莲纽约",
        "name": "FIT me 粉底液",
        "name_en": "Fit Me Foundation",
        "category": "底妆",
        "price": "¥89",
        "difficulty": "低",
        "tags": ["底妆", "预算", "新手", "学生", "遮瑕", "中性", "暖皮"],
        "blurb": "欧莱雅集团入门神器，百元内好上手，学生党友好。",
        "search": "美宝莲 FIT me 粉底液",
        "image": "/static/images/products/fitme.jpg",
        "accent": "#D4B896",
    },
    {
        "id": "maybelline-superstay",
        "brand": "Maybelline New York",
        "brand_zh": "美宝莲纽约",
        "name": "超持久唇釉",
        "name_en": "Superstay Vinyl Ink",
        "category": "唇妆",
        "price": "¥79",
        "difficulty": "低",
        "tags": ["唇色", "预算", "持久", "新手", "学生", "显白"],
        "blurb": "颜色饱和却好涂，忙一天也不轻易花掉。",
        "search": "美宝莲超持久唇釉",
        "image": "/static/images/products/vinyl.jpg",
        "accent": "#9B2D3A",
    },
    {
        "id": "age-perfect-cream",
        "brand": "L'Oréal Paris",
        "brand_zh": "巴黎欧莱雅",
        "name": "金致臻颜面霜",
        "name_en": "Age Perfect Cream",
        "category": "护肤打底",
        "price": "¥299",
        "difficulty": "低",
        "tags": ["干燥", "成熟肌", "护肤", "滋润", "气色"],
        "blurb": "妆前厚敷一点，皮肤更饱满，减少细纹处卡粉。",
        "search": "欧莱雅金致臻颜面霜",
        "image": "/static/images/products/cream.jpg",
        "accent": "#C9A86C",
    },
    {
        "id": "brow-artist",
        "brand": "L'Oréal Paris",
        "brand_zh": "巴黎欧莱雅",
        "name": "眉笔造型三件套",
        "name_en": "Brow Artist",
        "category": "眉妆",
        "price": "¥99",
        "difficulty": "中",
        "tags": ["眉妆", "新手", "提神", "日常", "眼妆"],
        "blurb": "细笔芯好描画，先定眉头再补眉峰，脸型立刻更清晰。",
        "search": "欧莱雅眉笔",
        "image": "/static/images/products/brow.jpg",
        "accent": "#6B5344",
    },
]


def shop_links(search: str) -> dict[str, str]:
    from urllib.parse import quote

    q = quote(search)
    return {
        "taobao": f"https://s.taobao.com/search?q={q}",
        "jd": f"https://search.jd.com/Search?keyword={q}",
        "douyin": f"https://www.douyin.com/search/{q}",
    }


def enrich_product(p: dict[str, Any], reason: str = "") -> dict[str, Any]:
    out = dict(p)
    out["reason"] = reason or p.get("blurb", "")
    out["links"] = shop_links(p["search"])
    # 缓存刷新：保证前端拿到最新本地产品图
    img = out.get("image") or ""
    if img.startswith("/static/") and "?" not in img:
        out["image"] = img + "?v=3"
    return out


def catalog_by_id() -> dict[str, dict[str, Any]]:
    return {p["id"]: p for p in LOREAL_CATALOG}


def get_client() -> OpenAI:
    if not API_KEY or "xxxx" in API_KEY or len(API_KEY) < 20:
        raise HTTPException(
            status_code=500,
            detail="请先在 .env 中填写真实的 DASHSCOPE_API_KEY（阿里云百炼控制台创建）",
        )
    return OpenAI(api_key=API_KEY, base_url=BASE_URL)


async def file_to_data_url(upload: UploadFile) -> str:
    raw = await upload.read()
    if not raw:
        raise HTTPException(status_code=400, detail="图片为空")
    if len(raw) > 8 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="图片请小于 8MB")
    mime = upload.content_type or mimetypes.guess_type(upload.filename or "")[0] or "image/jpeg"
    if not mime.startswith("image/"):
        raise HTTPException(status_code=400, detail="请上传图片文件")
    b64 = base64.b64encode(raw).decode("ascii")
    return f"data:{mime};base64,{b64}"


def chat_text(client: OpenAI, system: str, user: str) -> str:
    resp = client.chat.completions.create(
        model=TEXT_MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.7,
    )
    return (resp.choices[0].message.content or "").strip()


def chat_vision(client: OpenAI, prompt: str, *image_urls: str) -> str:
    global VL_MODEL
    content = [{"type": "image_url", "image_url": {"url": u}} for u in image_urls]
    content.append({"type": "text", "text": prompt})
    models: list[str] = []
    for m in [VL_MODEL, *VL_MODEL_FALLBACKS]:
        if m and m not in models:
            models.append(m)
    last_err: Exception | None = None
    for model in models:
        try:
            resp = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": content}],
                temperature=0.6,
            )
            if model != VL_MODEL:
                VL_MODEL = model
            return (resp.choices[0].message.content or "").strip()
        except Exception as e:
            last_err = e
            msg = str(e).lower()
            if "model_not_found" in msg or "model not exist" in msg or "does not exist" in msg:
                continue
            raise
    raise last_err or RuntimeError("视觉模型调用失败")


ANALYSIS_PROMPT = """你是「WOW!美炸了」包容性美妆助手，服务化妆新手与需要辅助的用户。
请基于这张素颜/半妆自拍，用中文输出温暖、具体、可执行的分析。不要羞辱式打分。

请按以下结构输出（用 Markdown）：
## 一眼看见的优点
（3 条具体夸奖，结合五官/气色/气质）

## 脸型与气色简读
（脸型倾向、冷暖皮猜测、适合的妆容方向，各 1-2 句）

## 今日低门槛妆容建议
（只推荐 3 个简单步骤，新手 10 分钟内能完成）

## 选品关键词
（明确写出：冷暖皮倾向、需要重点改善的点、预算建议；方便匹配欧莱雅产品）

语气要像旁边温柔的朋友，而不是评审。"""


COMPARE_PROMPT = """你是「WOW!美炸了」美妆教练。图1是妆前，图2是妆后。
请用中文输出：
## 变化亮点
（2-3 条具体进步）
## 一句鼓励
## 下次微调小建议
（只给 1 条，温和可执行）
不要贬低妆前的样子。"""


COACH_PROMPT = """你是实时化妆教练。用户正在第 {step} 步：{step_name}。
{extra}
请用中文给出：
1) 当前这一步怎么做（3 句以内，口语化）
2) 常见错误提醒（1 句）
3) 做完如何自检（1 句）
适合零基础，语速慢、好懂。可点名使用欧莱雅相关品类（粉底/唇膏/睫毛膏等），但不要编造货号。"""


LIVE_FEEDBACK_PROMPT = """你是实时化妆教练，正在看用户摄像头截图。
当前步骤：第 {step} 步 · {step_name}
重点部位：{focus}
请用中文极简输出（总字数不超过 36 字），严格两行：
状态：好 / 需调整
提示：一句具体动作（点名部位，如「左颊再推匀一点」）
不要客套，不要列表。"""


def extract_json_obj(text: str) -> Optional[dict]:
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def heuristic_picks(context: str, n: int = 3) -> list[dict[str, Any]]:
    """无模型或解析失败时的关键词匹配兜底。"""
    ctx = context.lower()
    scores: list[tuple[int, dict]] = []
    for p in LOREAL_CATALOG:
        score = 0
        for tag in p["tags"]:
            if tag.lower() in ctx or tag in context:
                score += 2
        if "冷" in context and "冷皮" in p["tags"]:
            score += 3
        if "暖" in context and "暖皮" in p["tags"]:
            score += 3
        if any(k in context for k in ("学生", "预算", "便宜", "百元")) and "预算" in p["tags"]:
            score += 3
        if any(k in context for k in ("唇", "气色")) and p["category"] == "唇妆":
            score += 2
        if any(k in context for k in ("底妆", "粉底", "斑", "均匀")) and p["category"] == "底妆":
            score += 2
        if any(k in context for k in ("眼", "睫毛")) and p["category"] == "眼妆":
            score += 2
        if any(k in context for k in ("干", "暗沉")) and p["category"] in ("护肤打底", "妆前"):
            score += 2
        scores.append((score, p))
    scores.sort(key=lambda x: (-x[0], x[1]["name"]))
    # 保证品类多样
    picked: list[dict] = []
    seen_cat: set[str] = set()
    for sc, p in scores:
        if len(picked) >= n:
            break
        if p["category"] in seen_cat and sc < 2:
            continue
        picked.append(
            enrich_product(
                p,
                reason=f"根据你的面部分析，{p['blurb']}",
            )
        )
        seen_cat.add(p["category"])
    if len(picked) < n:
        for _, p in scores:
            if p["id"] in {x["id"] for x in picked}:
                continue
            picked.append(enrich_product(p, reason=p["blurb"]))
            if len(picked) >= n:
                break
    return picked[:n]


def ai_pick_products(client: OpenAI, context: str) -> list[dict[str, Any]]:
    catalog_brief = [
        {
            "id": p["id"],
            "name": p["name"],
            "brand_zh": p["brand_zh"],
            "category": p["category"],
            "tags": p["tags"],
            "difficulty": p["difficulty"],
            "price": p["price"],
        }
        for p in LOREAL_CATALOG
    ]
    system = (
        "你是欧莱雅集团美妆选品助手。只能从给定产品库里选 3 个不同品类的产品。"
        "优先巴黎欧莱雅，预算敏感可选美宝莲（同属欧莱雅集团）。"
        "面向化妆新手：低容错、好上手。输出严格 JSON，不要 Markdown。"
        '格式：{"summary":"一句话总评","picks":[{"id":"产品id","reason":"为什么适合此人（25字内）"}]}'
    )
    user = (
        f"用户面部/需求分析：\n{context[:3500]}\n\n"
        f"可选产品库：\n{json.dumps(catalog_brief, ensure_ascii=False)}"
    )
    raw = chat_text(client, system, user)
    data = extract_json_obj(raw)
    by_id = catalog_by_id()
    if not data or "picks" not in data:
        return heuristic_picks(context)
    products: list[dict[str, Any]] = []
    for pick in data.get("picks", [])[:3]:
        pid = (pick or {}).get("id")
        if pid in by_id:
            products.append(
                enrich_product(by_id[pid], reason=(pick.get("reason") or by_id[pid]["blurb"]))
            )
    if len(products) < 3:
        extra = heuristic_picks(context, n=5)
        for p in extra:
            if p["id"] not in {x["id"] for x in products}:
                products.append(p)
            if len(products) >= 3:
                break
    # 把 summary 挂在第一个上供前端取用
    if products and data.get("summary"):
        products[0]["_summary"] = data["summary"]
    return products[:3]


@app.get("/api/health")
def health():
    key_ok = bool(API_KEY) and ("xxxx" not in API_KEY) and len(API_KEY) >= 20
    return {
        "ok": True,
        "api_key_configured": key_ok,
        "api_key_len": len(API_KEY),
        "vl_model": VL_MODEL,
        "text_model": TEXT_MODEL,
        "catalog_size": len(LOREAL_CATALOG),
    }


@app.get("/api/catalog")
def catalog():
    return {
        "ok": True,
        "products": [enrich_product(p) for p in LOREAL_CATALOG],
    }


@app.post("/api/analyze")
async def analyze(image: UploadFile = File(...)):
    client = get_client()
    data_url = await file_to_data_url(image)
    try:
        text = chat_vision(client, ANALYSIS_PROMPT, data_url)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"模型调用失败：{e}") from e
    return {"ok": True, "result": text, "model": VL_MODEL}


@app.post("/api/compare")
async def compare(
    before: UploadFile = File(...),
    after: UploadFile = File(...),
):
    client = get_client()
    before_url = await file_to_data_url(before)
    after_url = await file_to_data_url(after)
    try:
        text = chat_vision(client, COMPARE_PROMPT, before_url, after_url)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"模型调用失败：{e}") from e
    return {"ok": True, "result": text, "model": VL_MODEL}


@app.post("/api/recommend")
async def recommend(context: str = Form(...)):
    """根据面部分析结果，从欧莱雅产品库匹配 3 款并返回可跳转链接。"""
    summary = ""
    try:
        client = get_client()
        products = ai_pick_products(client, context)
        if products and products[0].get("_summary"):
            summary = products[0].pop("_summary", "") or ""
        for p in products:
            p.pop("_summary", None)
        model = TEXT_MODEL
    except HTTPException:
        products = heuristic_picks(context)
        summary = "已为你匹配欧莱雅入门友好组合（本地智能匹配）"
        model = "local-match"
    except Exception as e:
        products = heuristic_picks(context)
        summary = f"模型暂不可用，已用规则匹配欧莱雅产品。({e})"
        model = "local-match"

    if not summary:
        summary = "根据你的脸部状态，精选 3 款欧莱雅集团入门友好产品"

    # 兼容旧前端：同时给 markdown
    md_lines = [f"## {summary}", ""]
    for i, p in enumerate(products, 1):
        md_lines.append(f"### {i}. {p['brand_zh']} · {p['name']}")
        md_lines.append(f"- 品类：{p['category']}｜{p['price']}｜上手难度：{p['difficulty']}")
        md_lines.append(f"- 为什么适合你：{p['reason']}")
        md_lines.append(f"- 搜索关键词：{p['search']}")
        md_lines.append("")

    return {
        "ok": True,
        "summary": summary,
        "products": products,
        "result": "\n".join(md_lines),
        "model": model,
    }


@app.post("/api/coach")
async def coach(
    step: int = Form(1),
    note: Optional[str] = Form(""),
    image: Optional[UploadFile] = File(None),
):
    client = get_client()
    steps = {1: "底妆", 2: "眼妆", 3: "唇妆收尾"}
    step_name = steps.get(step, f"步骤{step}")
    extra = f"用户补充：{note}" if note else "无额外补充。"
    prompt = COACH_PROMPT.format(step=step, step_name=step_name, extra=extra)

    try:
        if image is not None and image.filename:
            data_url = await file_to_data_url(image)
            text = chat_vision(
                client,
                prompt + "\n若图中可见面部，请结合画面给出针对性提醒。",
                data_url,
            )
        else:
            text = chat_text(
                client,
                "你是包容性美妆实时教练，语气温柔简短。",
                prompt,
            )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"模型调用失败：{e}") from e
    return {
        "ok": True,
        "result": text,
        "step": step,
        "step_name": step_name,
        "model": VL_MODEL if image else TEXT_MODEL,
    }


@app.post("/api/coach/live")
async def coach_live(
    step: int = Form(1),
    image: UploadFile = File(...),
    note: Optional[str] = Form(""),
):
    """摄像头实时短反馈：看脸 + 点名部位。"""
    client = get_client()
    steps = {1: "底妆", 2: "眼妆", 3: "唇妆收尾"}
    focus_map = {
        1: "全脸（额头、双颊、下巴、鼻翼），粉底是否均匀",
        2: "双眼睑与眼尾，眼影/睫毛是否到位",
        3: "唇峰与嘴角，唇色是否清晰不溢出",
    }
    step_name = steps.get(step, f"步骤{step}")
    focus = focus_map.get(step, "面部整体")
    if note:
        focus = f"{focus}；用户当前正在练：{note[:80]}"
    data_url = await file_to_data_url(image)
    prompt = LIVE_FEEDBACK_PROMPT.format(step=step, step_name=step_name, focus=focus)
    try:
        text = chat_vision(client, prompt, data_url)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"模型调用失败：{e}") from e

    status = "需调整"
    tip = text.strip()
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("状态"):
            status = "好" if "好" in line and "需" not in line else "需调整"
        if line.startswith("提示"):
            tip = line.split("：", 1)[-1].split(":", 1)[-1].strip() or tip
    return {
        "ok": True,
        "status": status,
        "tip": tip[:80],
        "result": text,
        "step": step,
        "step_name": step_name,
        "focus": focus,
        "model": VL_MODEL,
    }


@app.get("/api/images/manifest")
def images_manifest():
    path = os.path.join(ROOT, "static", "images", "manifest.json")
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="图片资源清单不存在")
    return FileResponse(path, media_type="application/json")


@app.get("/")
def index():
    return FileResponse(os.path.join(ROOT, "index.html"))


# 本地图片库：/static/images/...
_static_dir = os.path.join(ROOT, "static")
os.makedirs(os.path.join(_static_dir, "images"), exist_ok=True)
app.mount("/static", StaticFiles(directory=_static_dir), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="0.0.0.0", port=PORT, reload=True)
