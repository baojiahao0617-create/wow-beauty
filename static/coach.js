/* AI 镜头教练 v2：稳定识别 + 分区引导 + 实时姿势反馈 */
var liveFeedbackOn = false;
var liveTimer = null;
var poseTimer = null;
var faceMesh = null;
var faceMeshReady = false;
var faceMeshLoading = null;
var lastFaceLandmarks = null;
var lastFaceAt = 0;
var rafId = null;
var meshBusy = false;
var meshLastSend = 0;
var localTipIndex = 0;
var subStepIndex = 0;
var subStepStartedAt = 0;
var faceOkStreak = 0;
var canvasW = 0;
var canvasH = 0;

/* 每一步拆成「当前该涂哪里」的微步骤，镜头只高亮当前区 */
var STEP_META = {
  1: {
    title: "底妆",
    hud: "STEP 01 · 底妆",
    tip: "跟着金色区域涂，由内向外推开",
    focus: "全脸",
    dwell: 5000,
    zones: [
      { key: "cheekL", label: "左颊", idxs: [50, 101, 118, 117, 116, 123, 147, 213, 192, 214, 212, 216, 206, 203, 36, 142, 100, 47], tip: "左颊：从鼻翼旁向外轻推" },
      { key: "cheekR", label: "右颊", idxs: [280, 330, 347, 346, 345, 352, 376, 433, 416, 434, 432, 436, 426, 423, 266, 371, 329, 277], tip: "右颊：从鼻翼旁向外轻推" },
      { key: "nose", label: "鼻翼", idxs: [1, 2, 98, 327, 358, 279, 420, 360, 363, 281, 5, 51, 134, 131, 102, 48, 64, 98], tip: "鼻翼两侧：少量粉底点开，别厚涂" },
      { key: "forehead", label: "额头", idxs: [10, 338, 297, 332, 284, 251, 389, 368, 300, 293, 334, 296, 336, 9, 107, 66, 105, 63, 70, 156, 139, 34, 68, 104, 69, 67, 109], tip: "额头：从眉心向上、向两侧薄涂" },
      { key: "chin", label: "下巴", idxs: [175, 152, 377, 400, 378, 379, 365, 397, 288, 361, 215, 138, 135, 169, 170, 171, 140, 176, 148, 149, 150, 136, 172, 58], tip: "下巴与下颌线：向下晕开，别留分界" }
    ]
  },
  2: {
    title: "眼妆",
    hud: "STEP 02 · 眼妆",
    tip: "先浅后深，只涂高亮的眼睑区",
    focus: "眼部",
    dwell: 4500,
    zones: [
      { key: "eyeL", label: "左眼睑", idxs: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246], tip: "左眼：浅色从眼窝中心扫开" },
      { key: "eyeR", label: "右眼睑", idxs: [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398], tip: "右眼：同样先浅色打底" },
      { key: "tailL", label: "左眼尾", idxs: [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7], tip: "左眼尾：加深外眼角，略上挑" },
      { key: "tailR", label: "右眼尾", idxs: [362, 398, 384, 385, 386, 387, 388, 466, 263, 249, 390, 373, 374, 380, 381, 382], tip: "右眼尾：加深外眼角，保持对称" }
    ]
  },
  3: {
    title: "唇妆",
    hud: "STEP 03 · 唇妆",
    tip: "沿唇形描，先点唇峰再推向嘴角",
    focus: "唇部",
    dwell: 4000,
    zones: [
      { key: "cupid", label: "唇峰", idxs: [0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61, 185, 40, 39, 37], tip: "先点在唇峰，建立形状" },
      { key: "lipFull", label: "全唇", idxs: [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95, 185, 40, 39, 37, 0, 267, 269, 270, 409, 415, 310, 311, 312, 13, 82, 81, 80, 191], tip: "沿唇线向两边推开，填满唇瓣" },
      { key: "corners", label: "嘴角", idxs: [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291], tip: "嘴角轻轻带过，多余用指腹按开" }
    ]
  }
};

function currentMeta() {
  return STEP_META[coachStep] || STEP_META[1];
}

function currentZone() {
  var zones = currentMeta().zones || [];
  if (!zones.length) return null;
  return zones[subStepIndex % zones.length];
}

function updateFlow(stage) {
  document.querySelectorAll("#coachFlow [data-flow]").forEach(function (el) {
    el.classList.toggle("on", parseInt(el.getAttribute("data-flow"), 10) <= stage);
  });
}

function setProgress(pct, label) {
  var bar = document.getElementById("coachProgressBar");
  var text = document.getElementById("coachProgressText");
  if (bar) bar.style.width = Math.max(0, Math.min(100, pct)) + "%";
  if (text) text.textContent = label || "";
}

function updateStepUI() {
  var m = currentMeta();
  var z = currentZone();
  var t = document.getElementById("camStepTitle");
  if (t) t.textContent = m.title;
  var hs = document.getElementById("camHudStep");
  if (hs) hs.textContent = m.hud + (z ? " · 现在：" + z.label : "");
  var ht = document.getElementById("camHudTip");
  if (ht) ht.textContent = z ? z.tip : m.tip;
  document.querySelectorAll("#cameraModal [data-step], .coach-steps [data-step]").forEach(function (b) {
    b.classList.toggle("active", parseInt(b.getAttribute("data-step"), 10) === coachStep);
  });
  var zoneEl = document.getElementById("camZoneNow");
  if (zoneEl) zoneEl.textContent = z ? ("现在涂：" + z.label) : "选择步骤后开始";
  updateFlow(window.cameraStream ? (lastFaceLandmarks ? 3 : 2) : 1);
  var zones = m.zones || [];
  var pct = zones.length ? ((subStepIndex % zones.length) / zones.length) * 100 : 0;
  setProgress(pct, z ? ("微步骤 " + ((subStepIndex % zones.length) + 1) + "/" + zones.length + " · " + z.label) : "等待开始");
}

function setMarkers(text) {
  var el = document.getElementById("camMarkers");
  if (el) el.innerHTML = "<span>" + text + "</span>";
}

function setHudFeedback(text, ok) {
  var el = document.getElementById("camHudFb");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("ok", !!ok);
}

function setPoseBadge(text, level) {
  var el = document.getElementById("camPoseBadge");
  if (!el) return;
  el.textContent = text;
  el.className = "cam-pose " + (level || "");
}

function openCameraModal() {
  document.getElementById("cameraModal").classList.add("active");
  document.body.style.overflow = "hidden";
  subStepIndex = 0;
  subStepStartedAt = performance.now();
  updateStepUI();
  updateFlow(1);
  setHudFeedback("选好步骤，点「开始练习」", false);
  setPoseBadge("未开摄像头", "");
  ensureFaceMesh(); // 预加载，开摄像头更快
  announce("已打开镜头练习");
}

function closeCameraModal() {
  document.getElementById("cameraModal").classList.remove("active");
  document.body.style.overflow = "";
  stopLiveLoop();
  stopCamera();
}

function loadScript(src) {
  return new Promise(function (resolve, reject) {
    if (document.querySelector('script[src="' + src + '"]')) {
      resolve();
      return;
    }
    var s = document.createElement("script");
    s.src = src;
    s.crossOrigin = "anonymous";
    s.onload = function () { resolve(); };
    s.onerror = function () { reject(new Error("脚本加载失败")); };
    document.head.appendChild(s);
  });
}

async function ensureFaceMesh() {
  if (faceMeshReady) return true;
  if (faceMeshLoading) return faceMeshLoading;
  faceMeshLoading = (async function () {
    if (typeof FaceMesh === "undefined") {
      try {
        await loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js");
      } catch (e) {
        setMarkers("识别库加载失败");
        return false;
      }
    }
    if (typeof FaceMesh === "undefined") {
      setMarkers("识别库不可用");
      return false;
    }
    faceMesh = new FaceMesh({
      locateFile: function (file) {
        return "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/" + file;
      }
    });
    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6
    });
    faceMesh.onResults(function (results) {
      meshBusy = false;
      if (results.multiFaceLandmarks && results.multiFaceLandmarks[0]) {
        lastFaceLandmarks = results.multiFaceLandmarks[0];
        lastFaceAt = performance.now();
      } else if (performance.now() - lastFaceAt > 500) {
        lastFaceLandmarks = null;
      }
    });
    faceMeshReady = true;
    setMarkers("识别引擎就绪");
    return true;
  })();
  try {
    return await faceMeshLoading;
  } finally {
    faceMeshLoading = null;
  }
}

function pt(lm, i, w, h) {
  var p = lm[i];
  if (!p) return { x: w / 2, y: h / 2 };
  return { x: p.x * w, y: p.y * h };
}

function centroid(lm, idxs, w, h) {
  var sx = 0, sy = 0, n = 0;
  idxs.forEach(function (i) {
    if (!lm[i]) return;
    sx += lm[i].x * w;
    sy += lm[i].y * h;
    n += 1;
  });
  if (!n) return { x: w / 2, y: h / 2 };
  return { x: sx / n, y: sy / n };
}

function drawPoly(ctx, lm, idxs, w, h, fill, stroke, lineWidth) {
  if (!idxs || !idxs.length) return;
  ctx.beginPath();
  var started = false;
  idxs.forEach(function (i) {
    if (!lm[i]) return;
    var p = pt(lm, i, w, h);
    if (!started) {
      ctx.moveTo(p.x, p.y);
      started = true;
    } else ctx.lineTo(p.x, p.y);
  });
  if (!started) return;
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth || 2.5;
    ctx.stroke();
  }
}

function pulseDot(ctx, x, y, label, t) {
  var r = 8 + Math.sin(t / 160) * 3.5;
  ctx.beginPath();
  ctx.arc(x, y, r + 10, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(212,165,116,0.2)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,210,150,0.95)";
  ctx.fill();
  if (label) {
    ctx.font = "700 13px Outfit, PingFang SC, sans-serif";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.65)";
    ctx.fillStyle = "#fff";
    ctx.strokeText(label, x + 14, y - 10);
    ctx.fillText(label, x + 14, y - 10);
  }
}

function drawArrow(ctx, x1, y1, x2, y2, color) {
  var ang = Math.atan2(y2 - y1, x2 - x1);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - 10 * Math.cos(ang - 0.4), y2 - 10 * Math.sin(ang - 0.4));
  ctx.lineTo(x2 - 10 * Math.cos(ang + 0.4), y2 - 10 * Math.sin(ang + 0.4));
  ctx.closePath();
  ctx.fill();
}

/** 根据关键点估算脸是否居中、大小是否合适 */
function analyzePose(lm, w, h) {
  if (!lm) return { ok: false, level: "bad", text: "未检测到脸", tip: "请把正脸放到画面中央" };
  var nose = pt(lm, 1, w, h);
  var left = pt(lm, 234, w, h);
  var right = pt(lm, 454, w, h);
  var top = pt(lm, 10, w, h);
  var bottom = pt(lm, 152, w, h);
  var faceW = Math.abs(right.x - left.x);
  var faceH = Math.abs(bottom.y - top.y);
  var cx = (left.x + right.x) / 2;
  var cy = (top.y + bottom.y) / 2;
  var dx = Math.abs(cx - w / 2) / w;
  var dy = Math.abs(cy - h / 2) / h;
  var size = faceW / w;

  if (size < 0.18) return { ok: false, level: "warn", text: "离远了", tip: "靠近镜头一点，让脸更大一些", size: size, dx: dx, dy: dy };
  if (size > 0.62) return { ok: false, level: "warn", text: "太近了", tip: "稍微后退，露出完整面部", size: size, dx: dx, dy: dy };
  if (dx > 0.18 || dy > 0.16) return { ok: false, level: "warn", text: "请居中", tip: "把脸移到画面中央的椭圆内", size: size, dx: dx, dy: dy };

  // 粗略左右偏转：鼻尖相对脸颊中线
  var midX = (left.x + right.x) / 2;
  var yaw = (nose.x - midX) / (faceW || 1);
  if (Math.abs(yaw) > 0.16) return { ok: false, level: "warn", text: "请正对镜头", tip: "脸正一点，不要侧太多", size: size, dx: dx, dy: dy };

  return { ok: true, level: "ok", text: "姿势很好", tip: "", size: size, dx: dx, dy: dy, faceH: faceH };
}

function advanceSubStepIfNeeded() {
  if (!window.cameraStream || !lastFaceLandmarks) return;
  var m = currentMeta();
  var dwell = m.dwell || 4500;
  if (performance.now() - subStepStartedAt < dwell) return;
  if (faceOkStreak < 8) return; // 姿势稳定一会儿再推进
  var zones = m.zones || [];
  if (!zones.length) return;
  subStepIndex = (subStepIndex + 1) % zones.length;
  subStepStartedAt = performance.now();
  var z = currentZone();
  setHudFeedback("→ 换区：" + (z ? z.label : "") + " — " + (z ? z.tip : ""), false);
  updateStepUI();
  speakZone(z);
}

function drawCoachOverlay() {
  var video = document.getElementById("camVideo");
  var canvas = document.getElementById("camOverlay");
  if (!video || !canvas || video.style.display === "none") return;

  var w = video.clientWidth || video.videoWidth || 640;
  var h = video.clientHeight || video.videoHeight || 400;
  if (w !== canvasW || h !== canvasH) {
    canvas.width = w;
    canvas.height = h;
    canvasW = w;
    canvasH = h;
  }
  var ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  var t = performance.now();
  var lm = lastFaceLandmarks;

  // 画面坐标与 CSS 镜像视频对齐
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);

  // 引导椭圆（始终显示）
  ctx.strokeStyle = lm ? "rgba(212,165,116,0.35)" : "rgba(212,165,116,0.7)";
  ctx.lineWidth = 2;
  ctx.setLineDash(lm ? [6, 6] : []);
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.48, w * 0.22, h * 0.32, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  if (!lm) {
    ctx.restore();
    setMarkers("寻找人脸…");
    setPoseBadge("未检测到脸", "bad");
    faceOkStreak = 0;
    return;
  }

  var pose = analyzePose(lm, w, h);
  setPoseBadge(pose.text, pose.level);
  if (pose.ok) {
    faceOkStreak += 1;
    setMarkers("识别中 · 跟着金色区涂");
    updateFlow(3);
  } else {
    faceOkStreak = Math.max(0, faceOkStreak - 2);
    setMarkers(pose.text);
  }

  var m = currentMeta();
  var z = currentZone();
  var allIdx = [];
  (m.zones || []).forEach(function (zone) {
    allIdx = allIdx.concat(zone.idxs || []);
  });

  // 非当前区：淡描；当前区：强高亮
  (m.zones || []).forEach(function (zone, i) {
    var active = zone === z;
    if (!active) {
      drawPoly(ctx, lm, zone.idxs, w, h, "rgba(255,255,255,0.03)", "rgba(255,255,255,0.12)", 1);
    }
  });

  // 脸部外轮廓，帮助用户对准
  var faceOval = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
  drawPoly(ctx, lm, faceOval, w, h, null, "rgba(255,255,255,0.22)", 1.5);

  if (z) {
    drawPoly(ctx, lm, z.idxs, w, h, "rgba(212,165,116,0.28)", "rgba(255,210,150,0.95)", 3);
    var c = centroid(lm, z.idxs, w, h);
    pulseDot(ctx, c.x, c.y, z.label, t);

    // 涂抹方向示意（由中心向外）
    var nose = pt(lm, 1, w, h);
    var ox = c.x + (c.x - nose.x) * 0.35;
    var oy = c.y + (c.y - nose.y) * 0.35;
    var pulse = (Math.sin(t / 200) + 1) / 2;
    var ax = c.x + (ox - c.x) * (0.4 + pulse * 0.6);
    var ay = c.y + (oy - c.y) * (0.4 + pulse * 0.6);
    drawArrow(ctx, c.x, c.y, ax, ay, "rgba(255,220,170,0.9)");
  }

  ctx.restore();

  // HUD 文案（不镜像）
  var ht = document.getElementById("camHudTip");
  if (ht) {
    if (!pose.ok) ht.textContent = pose.tip;
    else if (z) ht.textContent = z.tip;
  }
  var zoneEl = document.getElementById("camZoneNow");
  if (zoneEl) zoneEl.textContent = z ? ("现在涂：" + z.label) : "";

  // 微步骤进度
  var zones = m.zones || [];
  var dwell = m.dwell || 4500;
  var elapsed = performance.now() - subStepStartedAt;
  var base = zones.length ? ((subStepIndex % zones.length) / zones.length) * 100 : 0;
  var within = zones.length ? (Math.min(1, elapsed / dwell) / zones.length) * 100 : 0;
  if (!pose.ok) within *= 0.2;
  setProgress(base + within, z ? ("正在练习：" + z.label) : "");

  advanceSubStepIfNeeded();
}

async function processFaceFrame() {
  var video = document.getElementById("camVideo");
  if (!video || video.readyState < 2 || !faceMesh || meshBusy) return;
  var now = performance.now();
  if (now - meshLastSend < 66) return; // ~15fps，更稳
  meshBusy = true;
  meshLastSend = now;
  try {
    await faceMesh.send({ image: video });
  } catch (e) {
    meshBusy = false;
  }
}

function loopFace() {
  processFaceFrame();
  drawCoachOverlay();
  rafId = requestAnimationFrame(loopFace);
}

async function startCamera() {
  var btn = document.getElementById("startCameraBtn");
  var idle = document.getElementById("camIdle");
  var video = document.getElementById("camVideo");
  try {
    setHudFeedback("正在开启摄像头…", false);
    var okMesh = await ensureFaceMesh();
    var stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
      }
    });
    window.cameraStream = stream;
    video.srcObject = stream;
    video.style.display = "block";
    video.style.transform = "scaleX(-1)";
    await video.play();
    if (idle) idle.style.display = "none";
    btn.textContent = "● 练习中（点此关闭）";
    btn.onclick = stopCamera;
    updateFlow(2);
    subStepIndex = 0;
    subStepStartedAt = performance.now();
    faceOkStreak = 0;
    updateStepUI();
    setHudFeedback(okMesh ? "把脸放进椭圆，金色区就是现在要涂的地方" : "引导框模式：请正对镜头", false);
    if (rafId) cancelAnimationFrame(rafId);
    loopFace();
    liveFeedbackOn = true;
    startLiveLoop();
    announce("摄像头已开启，请把脸放进框内");
    setTimeout(function () { speakZone(currentZone()); }, 900);
  } catch (e) {
    var msg;
    if (!window.isSecureContext) {
      msg =
        "当前页面不是 HTTPS，浏览器禁止打开摄像头。\n请用带小锁的 https 地址打开本站后再试。";
    } else if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
      msg = "未获得摄像头权限，请在地址栏左侧允许摄像头后重试。";
    } else if (e.name === "NotFoundError" || e.name === "DevicesNotFoundError") {
      msg = "没有检测到摄像头，请确认电脑有前置摄像头并已启用。";
    } else {
      msg = "摄像头不可用：" + (e.message || e.name);
    }
    alert(msg);
    setHudFeedback(msg.split("\n")[0], true);
  }
}

function resetCameraUI() {
  var btn = document.getElementById("startCameraBtn");
  var idle = document.getElementById("camIdle");
  var video = document.getElementById("camVideo");
  var canvas = document.getElementById("camOverlay");
  if (video) {
    video.style.display = "none";
    video.srcObject = null;
  }
  if (canvas) {
    var ctx = canvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  canvasW = 0;
  canvasH = 0;
  if (idle) idle.style.display = "flex";
  if (btn) {
    btn.textContent = "▶ 开始练习";
    btn.onclick = startCamera;
  }
  setMarkers("等待开始");
  setPoseBadge("未开摄像头", "");
  setProgress(0, "等待开始");
  lastFaceLandmarks = null;
  updateFlow(1);
}

function stopCamera() {
  stopLiveLoop();
  liveFeedbackOn = false;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  meshBusy = false;
  if (window.cameraStream) {
    window.cameraStream.getTracks().forEach(function (t) {
      t.stop();
    });
    window.cameraStream = null;
  }
  resetCameraUI();
  announce("摄像头已关闭");
}

function captureVideoBlob() {
  return new Promise(function (resolve) {
    var video = document.getElementById("camVideo");
    if (!video || video.readyState < 2) {
      resolve(null);
      return;
    }
    var c = document.createElement("canvas");
    var vw = video.videoWidth || 640;
    var vh = video.videoHeight || 480;
    // 缩小上传，加快 AI
    var scale = Math.min(1, 720 / vw);
    c.width = Math.round(vw * scale);
    c.height = Math.round(vh * scale);
    c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
    c.toBlob(function (b) {
      resolve(b);
    }, "image/jpeg", 0.7);
  });
}

function speakZone(z) {
  if (!z) return;
  var text = "现在涂" + z.label + "。" + (z.tip || "");
  if (typeof announce === "function") announce(text);
  try {
    if (!("speechSynthesis" in window)) return;
    // 避免叠读
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    u.rate = 1;
    window.speechSynthesis.speak(u);
  } catch (e) {}
}

function applyZoneTip(forceOk) {
  var z = currentZone();
  var poseOk = !!lastFaceLandmarks && forceOk !== false;
  if (!lastFaceLandmarks) {
    setHudFeedback("→ 请把正脸放进椭圆框", false);
    return;
  }
  if (z) {
    setHudFeedback((poseOk ? "✓ " : "→ ") + z.tip, poseOk);
  } else {
    setHudFeedback("→ 跟着高亮部位慢慢涂", false);
  }
  var status = document.getElementById("coachStatus");
  if (status) status.textContent = "实时引导 · " + currentMeta().title + (z ? " · " + z.label : "");
}

async function tickLiveFeedback() {
  if (!liveFeedbackOn || !window.cameraStream) return;
  var status = document.getElementById("coachStatus");
  if (!lastFaceLandmarks) {
    setHudFeedback("→ 未检测到脸，请正对镜头、光线亮一点", false);
    if (status) status.textContent = "等待识别人脸…";
    return;
  }
  var z = currentZone();
  try {
    var blob = await captureVideoBlob();
    if (!blob) {
      applyZoneTip(true);
      return;
    }
    var fd = new FormData();
    fd.append("step", String(coachStep));
    fd.append("image", blob, "live.jpg");
    // 把当前微区告诉后端，反馈更准
    if (z) fd.append("note", "当前重点部位：" + z.label + "。请只针对这一部位给一句提示。");
    var j = await postForm("/api/coach/live", fd);
    var ok = j.status === "好";
    var tip = j.tip || j.result || "";
    tip = String(tip)
      .replace(/^状态[：:].*$/m, "")
      .replace(/^提示[：:]\s*/m, "")
      .trim() || tip;
    if (tip.length > 40) tip = tip.slice(0, 40) + "…";
    setHudFeedback((ok ? "✓ " : "→ ") + tip, ok);
    if (status) status.textContent = "AI 看脸反馈 · " + (j.step_name || "") + (z ? " · " + z.label : "");
  } catch (e) {
    applyZoneTip(true);
    if (status) status.textContent = "本地引导中（AI 稍后重试）";
  }
}

function startLiveLoop() {
  stopLiveLoop();
  applyZoneTip(false);
  // 每秒根据姿势给即时提示；AI 每 8 秒看一眼
  poseTimer = setInterval(function () {
    if (!window.cameraStream) return;
    if (!lastFaceLandmarks) {
      setHudFeedback("→ 找不到脸：面向镜头，光线均匀", false);
      return;
    }
    // 若刚换区，强调新区
    var z = currentZone();
    if (z && performance.now() - subStepStartedAt < 1200) {
      setHudFeedback("→ 现在涂 " + z.label + "：" + z.tip, false);
    }
  }, 1000);
  setTimeout(tickLiveFeedback, 1800);
  liveTimer = setInterval(tickLiveFeedback, 8000);
}

function stopLiveLoop() {
  if (liveTimer) {
    clearInterval(liveTimer);
    liveTimer = null;
  }
  if (poseTimer) {
    clearInterval(poseTimer);
    poseTimer = null;
  }
}

function resetSubSteps() {
  subStepIndex = 0;
  subStepStartedAt = performance.now();
  faceOkStreak = 0;
  localTipIndex = 0;
}

document.addEventListener("DOMContentLoaded", function () {
  var modal = document.getElementById("cameraModal");
  if (modal) {
    modal.addEventListener("click", function (e) {
      if (e.target === e.currentTarget) closeCameraModal();
    });
  }
  var next = document.getElementById("btnNextStep");
  if (next) {
    next.addEventListener("click", function () {
      var m = currentMeta();
      var zones = m.zones || [];
      // 先走完当前步骤的微区，再切大步骤
      if (zones.length && (subStepIndex % zones.length) < zones.length - 1) {
        subStepIndex += 1;
        subStepStartedAt = performance.now();
      } else {
        coachStep = coachStep >= 3 ? 1 : coachStep + 1;
        resetSubSteps();
      }
      updateStepUI();
      applyZoneTip(true);
      var st = document.getElementById("coachStatus");
      var z = currentZone();
      if (st) st.textContent = "已切换 · " + currentMeta().title + (z ? " · " + z.label : "");
      speakZone(z);
    });
  }
});

// 供 index.html 的 data-step 点击调用
function onCoachStepChanged() {
  resetSubSteps();
  updateStepUI();
  applyZoneTip(!!lastFaceLandmarks);
}
