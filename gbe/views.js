"use strict";

const { GENERAL_CAP, SPECIAL_CAP, EXEMPT_REASONS, FOUNDATION_LABEL, LEVEL_LABEL, TARGET_LEVEL_OPTIONS } = require("./schema");

const ROLE_LABEL = {
  super_admin: "총괄 관리자",
  project_manager: "공모사업 관리자",
  school_user: "학교 사용자",
};

function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function fmtDate(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });
}

const BASE_STYLE = `
:root{--accent:#0b4f9e;--accent-700:#083a74;--ink:#18181b;--muted:#52525b;--faint:#71717a;--line:rgba(0,0,0,.08);--line-2:rgba(0,0,0,.05);--bg:#fafafa;--surface:#fff;--well:#f4f4f5;--ok:#15803d;--ok-bg:#f0fdf4;--warn:#b45309;--warn-bg:#fffbeb;--danger:#b91c1c;--danger-bg:#fef2f2;}
*{margin:0;padding:0;box-sizing:border-box;}
html{-webkit-text-size-adjust:100%;}
body{font-family:"Pretendard",-apple-system,BlinkMacSystemFont,"Segoe UI","Malgun Gothic",sans-serif;background:var(--bg);color:var(--ink);line-height:1.6;-webkit-font-smoothing:antialiased;}
a{color:var(--accent);text-decoration:none;}
a:hover{text-decoration:underline;}
.nav{background:var(--surface);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:10;}
.nav-in{max-width:1120px;margin:0 auto;padding:0 20px;height:60px;display:flex;align-items:center;gap:16px;}
.brand{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:600;color:var(--ink);}
.brand .mk{width:30px;height:30px;border-radius:7px;background:var(--accent);color:#fff;display:grid;place-items:center;font-size:14px;font-weight:600;flex-shrink:0;}
.nav-links{display:flex;gap:4px;margin-left:8px;flex:1;flex-wrap:wrap;}
.nav-links a{padding:7px 12px;border-radius:7px;color:var(--muted);font-size:14px;font-weight:500;}
.nav-links a:hover{background:var(--well);color:var(--ink);text-decoration:none;}
.nav-links a.on{background:var(--well);color:var(--accent);}
.nav-right{display:flex;align-items:center;gap:12px;font-size:13px;color:var(--faint);}
.chip{font-size:12px;font-weight:600;color:var(--accent);background:#eaf2fc;padding:3px 9px;border-radius:999px;}
.wrap{max-width:1120px;margin:0 auto;padding:32px 20px 64px;}
.page-h{margin-bottom:24px;}
.page-h h1{font-size:22px;font-weight:600;letter-spacing:-.02em;}
.page-h p{color:var(--muted);font-size:14px;margin-top:4px;}
.grid{display:grid;gap:16px;}
.cols-2{grid-template-columns:repeat(2,1fr);}
.cols-3{grid-template-columns:repeat(3,1fr);}
.cols-4{grid-template-columns:repeat(4,1fr);}
@media(max-width:720px){.cols-2,.cols-3,.cols-4{grid-template-columns:1fr;}.nav-in{height:auto;padding:12px 20px;flex-wrap:wrap;}}
.card{background:var(--surface);border-radius:12px;padding:20px 22px;box-shadow:0 1px 2px rgba(0,0,0,.03);outline:1px solid var(--line);}
.card h2{font-size:15px;font-weight:600;margin-bottom:14px;letter-spacing:-.01em;}
.stat .l{font-size:13px;color:var(--muted);}
.stat .v{font-size:30px;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums;margin-top:6px;color:var(--ink);}
.stat .s{font-size:12px;color:var(--faint);margin-top:4px;}
table{width:100%;border-collapse:collapse;font-size:14px;}
th{text-align:left;font-size:12px;font-weight:600;color:var(--faint);padding:10px 12px;border-bottom:1px solid var(--line);white-space:nowrap;}
td{padding:11px 12px;border-bottom:1px solid var(--line-2);vertical-align:middle;}
td.num,th.num{font-variant-numeric:tabular-nums;}
tr:last-child td{border-bottom:none;}
.tbl-wrap{overflow-x:auto;}
.tag{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;padding:3px 9px;border-radius:999px;white-space:nowrap;}
.tag.ok{color:var(--ok);background:var(--ok-bg);}
.tag.warn{color:var(--warn);background:var(--warn-bg);}
.tag.muted{color:var(--muted);background:var(--well);}
.tag.danger{color:var(--danger);background:var(--danger-bg);}
.tag.accent{color:var(--accent);background:#eaf2fc;}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;font-family:inherit;font-size:14px;font-weight:500;padding:9px 14px;border-radius:8px;border:none;cursor:pointer;transition:background .15s;}
.btn-primary{background:var(--accent);color:#fff;}
.btn-primary:hover{background:var(--accent-700);text-decoration:none;}
.btn-ghost{background:transparent;color:var(--muted);outline:1px solid var(--line);}
.btn-ghost:hover{background:var(--well);color:var(--ink);text-decoration:none;}
.btn-sm{font-size:13px;padding:6px 11px;}
.btn:disabled{opacity:.45;cursor:not-allowed;}
.btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px;}
label{display:block;font-size:13px;font-weight:500;margin-bottom:6px;color:var(--ink);}
input,select,textarea{width:100%;font-family:inherit;font-size:16px;padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:var(--surface);color:var(--ink);}
@media(min-width:640px){input,select,textarea{font-size:14px;}}
input:focus,select:focus,textarea:focus{outline:2px solid var(--accent);outline-offset:-1px;border-color:transparent;}
.field{margin-bottom:16px;}
.row-actions{display:flex;gap:8px;flex-wrap:wrap;}
.notice{padding:12px 14px;border-radius:8px;font-size:13.5px;margin-bottom:20px;}
.notice.ok{background:var(--ok-bg);color:var(--ok);}
.notice.err{background:var(--danger-bg);color:var(--danger);}
.notice.info{background:#eaf2fc;color:var(--accent-700);}
.muted{color:var(--muted);}
.empty{text-align:center;color:var(--faint);padding:36px 12px;font-size:14px;}
.hint{font-size:12.5px;color:var(--faint);margin-top:6px;}
ul.plain{list-style:none;}
`;

function layout({ title, user, active, body, flash }) {
  const links = navFor(user, active);
  const flashHtml = flash
    ? `<div class="notice ${esc(flash.type)}">${esc(flash.msg)}</div>`
    : "";
  return `<!DOCTYPE html><html lang="ko"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · 경상북도교육청 공모사업관리</title>
<style>${BASE_STYLE}</style></head><body>
<nav class="nav"><div class="nav-in">
  <div class="brand"><span class="mk">경</span><span>공모사업관리시스템</span></div>
  <div class="nav-links">${links}</div>
  <div class="nav-right">
    <span class="chip">${esc(ROLE_LABEL[user.role])}</span>
    <span>${esc(user.name)}</span>
    <a href="/logout" class="btn btn-ghost btn-sm">로그아웃</a>
  </div>
</div></nav>
<div class="wrap">${flashHtml}${body}</div>
</body></html>`;
}

function navFor(user, active) {
  const items = [["/", "대시보드"], ["/projects", "공모사업"]];
  if (user.role === "school_user") items.push(["/my", "신청 현황"]);
  if (user.role === "super_admin" || user.role === "project_manager") {
    items.push(["/manage/projects", "사업 관리"]);
    items.push(["/manage/schools", "학교/상한 현황"]);
  }
  if (user.role === "super_admin") items.push(["/admin", "회원·데이터 관리"]);
  return items
    .map(([href, label]) => `<a href="${href}" class="${active === href ? "on" : ""}">${esc(label)}</a>`)
    .join("");
}

function loginPage({ error } = {}) {
  return `<!DOCTYPE html><html lang="ko"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>로그인 · 경상북도교육청 공모사업관리</title>
<style>${BASE_STYLE}
.login-wrap{min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--surface);}
.login-card{width:100%;max-width:380px;}
.login-head{text-align:center;margin-bottom:28px;}
.login-head .mk{width:48px;height:48px;border-radius:12px;background:var(--accent);color:#fff;display:grid;place-items:center;font-size:20px;font-weight:600;margin:0 auto 16px;}
.login-head h1{font-size:19px;font-weight:600;letter-spacing:-.02em;}
.login-head p{font-size:13.5px;color:var(--muted);margin-top:4px;}
</style></head><body>
<div class="login-wrap"><div class="login-card">
  <div class="login-head">
    <div class="mk">경</div>
    <h1>경상북도교육청 공모사업관리</h1>
    <p>학교별 공모사업 선정 상한제 운영 시스템</p>
  </div>
  ${error ? `<div class="notice err">${esc(error)}</div>` : ""}
  <form method="POST" action="/login">
    <div class="field">
      <label for="username">아이디</label>
      <input id="username" name="username" type="text" autocomplete="username" required autofocus>
    </div>
    <div class="field">
      <label for="password">비밀번호</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
    </div>
    <button type="submit" class="btn btn-primary" style="width:100%">로그인</button>
  </form>
  <p class="hint" style="text-align:center;margin-top:20px">계정은 총괄 관리자가 발급합니다.</p>
</div></div></body></html>`;
}

module.exports = { ROLE_LABEL, esc, fmtDate, layout, loginPage, GENERAL_CAP, SPECIAL_CAP, EXEMPT_REASONS, FOUNDATION_LABEL, LEVEL_LABEL, TARGET_LEVEL_OPTIONS };
