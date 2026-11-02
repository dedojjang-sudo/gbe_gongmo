"use strict";

const express = require("express");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

// onpod `--attach-db` injects DATABASE_URL automatically (internal host).
const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString,
  // onpod managed Postgres requires TLS; the managed cert is trusted by the
  // platform network but the CA chain isn't bundled in the image, so accept it.
  ssl: connectionString && connectionString.includes("sslmode=require")
    ? { rejectUnauthorized: false }
    : false,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// Ensure the schema exists on boot. Retries a few times so the app can start
// while the DB host finishes booting (managed DB takes 2-3 min to come up).
async function initDb(retries = 10) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS visits (
          id    BIGSERIAL PRIMARY KEY,
          seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
          agent TEXT
        )
      `);
      console.log("[db] schema ready");
      return;
    } catch (err) {
      console.error(`[db] init attempt ${attempt}/${retries} failed: ${err.message}`);
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function page({ dbOk, total, recent, errorMsg }) {
  const rows = recent.map((r) => {
    const t = new Date(r.seen).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
    return `<tr><td>#${r.id}</td><td>${escapeHtml(t)}</td></tr>`;
  }).join("");

  const dbBadge = dbOk
    ? '<span class="badge ok"><span class="dot ok"></span>DB 연결됨</span>'
    : '<span class="badge err"><span class="dot err"></span>DB 연결 실패</span>';

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>경상북도교육청 테스트 페이지</title>
  <style>
    :root{--gbe:#0b4f9e;--ink:#1a2230;--muted:#5b6676;--line:#e4e8ef;--bg:#f5f7fa;}
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:"Pretendard",-apple-system,BlinkMacSystemFont,"Segoe UI","Malgun Gothic",sans-serif;background:var(--bg);color:var(--ink);-webkit-font-smoothing:antialiased;min-height:100vh;display:flex;flex-direction:column;}
    header{background:#fff;border-bottom:1px solid var(--line);}
    .bar{max-width:880px;margin:0 auto;padding:18px 24px;display:flex;align-items:center;gap:12px;}
    .mark{width:34px;height:34px;border-radius:8px;background:var(--gbe);color:#fff;display:grid;place-items:center;font-weight:700;font-size:15px;}
    .org{font-size:15px;font-weight:600;}
    main{flex:1;display:flex;align-items:center;justify-content:center;padding:48px 24px;}
    .card{width:100%;max-width:600px;background:#fff;border:1px solid var(--line);border-radius:16px;padding:48px;box-shadow:0 1px 2px rgba(16,24,40,.04),0 8px 24px rgba(16,24,40,.06);}
    .badges{display:flex;gap:8px;justify-content:center;margin-bottom:24px;flex-wrap:wrap;}
    .badge{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:600;padding:6px 12px;border-radius:999px;}
    .badge.ok{color:var(--gbe);background:#eaf2fc;}
    .badge.err{color:#b42318;background:#fef3f2;}
    .dot{width:7px;height:7px;border-radius:50%;}
    .dot.ok{background:#16a34a;box-shadow:0 0 0 3px rgba(22,163,74,.18);}
    .dot.err{background:#d92d20;box-shadow:0 0 0 3px rgba(217,45,32,.18);}
    h1{font-size:26px;line-height:1.35;letter-spacing:-.02em;text-align:center;margin-bottom:12px;}
    p.sub{font-size:14.5px;color:var(--muted);line-height:1.6;text-align:center;}
    .stat{margin:28px 0;padding:22px;background:var(--bg);border-radius:12px;text-align:center;}
    .stat .n{font-size:40px;font-weight:700;color:var(--gbe);letter-spacing:-.03em;line-height:1;}
    .stat .l{font-size:13px;color:var(--muted);margin-top:8px;}
    table{width:100%;border-collapse:collapse;margin-top:20px;font-size:13px;}
    th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);}
    th{color:var(--muted);font-weight:600;font-size:12px;}
    td{color:var(--ink);}
    .err-box{margin-top:16px;padding:12px 14px;background:#fef3f2;border:1px solid #fecdca;border-radius:8px;color:#b42318;font-size:12.5px;word-break:break-all;}
    footer{text-align:center;padding:24px;font-size:12.5px;color:var(--muted);}
  </style>
</head>
<body>
  <header><div class="bar"><div class="mark">경</div><div class="org">경상북도교육청</div></div></header>
  <main>
    <div class="card">
      <div class="badges">
        <span class="badge ok"><span class="dot ok"></span>앱 정상 작동 중</span>
        ${dbBadge}
      </div>
      <h1>경상북도교육청 테스트 페이지입니다.</h1>
      <p class="sub">이 페이지는 web+db 배포 연동 확인용 테스트 페이지입니다.<br>아래 방문 횟수는 접속할 때마다 데이터베이스에 기록됩니다.</p>
      <div class="stat"><div class="n">${dbOk ? total.toLocaleString("ko-KR") : "—"}</div><div class="l">누적 방문 횟수 (DB 저장)</div></div>
      ${dbOk ? `<table><thead><tr><th>기록 번호</th><th>방문 시각 (KST)</th></tr></thead><tbody>${rows || '<tr><td colspan="2">기록 없음</td></tr>'}</tbody></table>` : ""}
      ${errorMsg ? `<div class="err-box">DB 오류: ${escapeHtml(errorMsg)}</div>` : ""}
    </div>
  </main>
  <footer>&copy; 경상북도교육청 · web+db Test Deployment · Onpod</footer>
</body>
</html>`;
}

app.get("/healthz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({ status: "ok", db: "up" });
  } catch (err) {
    res.status(503).json({ status: "degraded", db: "down", error: err.message });
  }
});

app.get("/", async (req, res) => {
  let dbOk = false;
  let total = 0;
  let recent = [];
  let errorMsg = null;

  try {
    const agent = req.headers["user-agent"] || null;
    await pool.query("INSERT INTO visits (agent) VALUES ($1)", [agent]);
    const countRes = await pool.query("SELECT COUNT(*)::int AS c FROM visits");
    total = countRes.rows[0].c;
    const recentRes = await pool.query(
      "SELECT id, seen FROM visits ORDER BY id DESC LIMIT 5"
    );
    recent = recentRes.rows;
    dbOk = true;
  } catch (err) {
    errorMsg = err.message;
    console.error("[req] db error:", err.message);
  }

  res.status(200).type("html").send(page({ dbOk, total, recent, errorMsg }));
});

initDb()
  .catch((err) => console.error("[boot] initDb gave up:", err.message))
  .finally(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`[server] listening on :${PORT}`);
    });
  });
