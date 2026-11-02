"use strict";

const { esc, fmtDate, layout, GENERAL_CAP, SPECIAL_CAP, EXEMPT_REASONS, FOUNDATION_LABEL, LEVEL_LABEL, TARGET_LEVEL_OPTIONS } = require("./views");

function statCard(label, value, sub) {
  return `<div class="card stat"><div class="l">${esc(label)}</div><div class="v">${esc(value)}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ""}</div>`;
}

function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}

function isApplyClosed(applyEnd) {
  if (!applyEnd) return false;
  const todaySeoul = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const endSeoul = new Date(applyEnd).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  return todaySeoul > endSeoul;
}

function projectStatusTag(status, applyEnd) {
  if (status === "decided") return `<span class="tag accent">완료</span>`;
  if (status === "closed" || isApplyClosed(applyEnd)) return `<span class="tag warn">선정중</span>`;
  return `<span class="tag ok">공고중</span>`;
}

function appStatusTag(status) {
  if (status === "applied") return `<span class="tag warn">신청</span>`;
  if (status === "selected") return `<span class="tag ok">선정</span>`;
  return `<span class="tag danger">미선정</span>`;
}

function targetLevelText(levels) {
  const arr = Array.isArray(levels) ? levels : [];
  if (!arr.length) return "전체 학교급";
  return arr.map((l) => LEVEL_LABEL[l] || l).join(", ");
}

function dateInputValue(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "";
  return dt.toISOString().slice(0, 10);
}

function dashboard({ user, stats, flash, mySchool }) {
  let cards = "";
  if (user.role === "school_user" && mySchool) {
    const cap = mySchool.category === "special" ? SPECIAL_CAP : GENERAL_CAP;
    cards = `<div class="grid cols-4">
      ${statCard("소속 학교", mySchool.name, `${LEVEL_LABEL[mySchool.level] || "기타"} · ${FOUNDATION_LABEL[mySchool.foundation] || "공립"} · ${mySchool.category === "special" ? "특정학교" : "일반학교"}`)}
      ${statCard("신청·선정 상한", `${cap}개`, "신청+선정 합산, 제외 사업 미포함")}
      ${statCard("현재 신청·선정", `${stats.used}개`, `잔여 ${Math.max(0, cap - stats.used)}개`)}
      ${statCard("신청 / 선정", `${stats.applied} / ${stats.selected}`, "대기 / 확정")}
    </div>`;
  } else {
    cards = `<div class="grid cols-4">
      ${statCard("전체 공모사업", `${stats.projects}건`, `공고중 ${stats.open}건`)}
      ${statCard("등록 학교", `${stats.schools}개교`, `특정학교 ${stats.special}개교`)}
      ${statCard("누적 신청", `${stats.applications}건`)}
      ${statCard("선정 완료", `${stats.selected}건`)}
    </div>`;
  }

  const rules = `<div class="card" style="margin-top:16px">
    <h2>선정 상한제 운영 기준</h2>
    <div class="grid cols-2">
      <div>
        <p class="muted" style="font-size:13px;margin-bottom:10px">공모사업 선정 상한 (제외 사업 미포함)</p>
        <table><tbody>
          <tr><td>일반학교</td><td class="num"><span class="tag accent">${GENERAL_CAP}개 이하</span></td></tr>
          <tr><td>특정학교</td><td class="num"><span class="tag accent">${SPECIAL_CAP}개 이하</span></td></tr>
        </tbody></table>
        <p class="hint">특정학교 명단은 총괄 관리자가 엑셀로 업로드하여 관리합니다.</p>
      </div>
      <div>
        <p class="muted" style="font-size:13px;margin-bottom:10px">상한제 제외 대상 사업</p>
        <ul class="plain" style="font-size:13.5px;display:flex;flex-direction:column;gap:8px">
          ${EXEMPT_REASONS.map((r) => `<li style="display:flex;gap:8px"><span class="tag muted" style="flex-shrink:0">제외</span><span>${esc(r)}</span></li>`).join("")}
        </ul>
      </div>
    </div>
  </div>`;

  const body = `<div class="page-h"><h1>대시보드</h1><p>경상북도교육청 공모사업 선정 상한제 운영 현황</p></div>${cards}${rules}`;
  return layout({ title: "대시보드", user, active: "/", body, flash });
}

function projectsList({ user, projects, flash, canApplyMap, q }) {
  const rows = projects.length
    ? projects.map((p) => {
        return `<tr>
          <td><a href="/projects/${p.id}">${esc(p.title)}</a></td>
          <td>${fmtDate(p.apply_start)} ~ ${fmtDate(p.apply_end)}</td>
          <td>${projectStatusTag(p.status, p.apply_end)}</td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="3"><div class="empty">${q ? `"${esc(q)}" 검색 결과가 없습니다.` : "등록된 공모사업이 없습니다."}</div></td></tr>`;

  const qv = q || "";
  const searchForm = `<form method="GET" action="/projects" style="display:flex;gap:8px;margin-bottom:14px">
    <input name="q" value="${esc(qv)}" placeholder="사업명으로 검색" style="flex:1;max-width:320px">
    <button type="submit" class="btn btn-primary btn-sm">검색</button>
    ${qv ? `<a href="/projects" class="btn btn-ghost btn-sm">초기화</a>` : ""}
  </form>`;

  const body = `<div class="page-h"><h1>공모사업 공고</h1><p>사업명을 클릭하면 상세 내용과 첨부파일을 확인하고 신청할 수 있습니다.</p></div>
  <div class="card">${searchForm}<div class="tbl-wrap"><table>
    <thead><tr><th>사업명</th><th>신청기간</th><th>상태</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div></div>`;
  return layout({ title: "공모사업", user, active: "/projects", body, flash });
}

function projectView({ user, project, files, applyState, flash }) {
  const fileList = (files && files.length)
    ? files.map((f) => `<li style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line-2)">
        <span class="tag muted" style="flex-shrink:0">파일</span>
        <a href="/projects/${project.id}/files/${f.id}">${esc(f.filename)}</a>
        <span class="hint" style="margin-left:auto">${fmtSize(f.size_bytes)}</span>
      </li>`).join("")
    : `<li class="muted" style="padding:8px 0;font-size:13.5px">첨부파일이 없습니다.</li>`;

  let applyBox = "";
  if (user.role === "school_user") {
    if (project.status !== "open") {
      applyBox = `<div class="notice info">현재 신청 기간이 아닙니다 (${project.status === "closed" ? "마감" : "선정 완료"}).</div>`;
    } else if (applyState && applyState.applied) {
      applyBox = `<div class="notice ok">이미 신청한 사업입니다. 현재 상태: ${appStatusTag(applyState.status)}</div>`;
    } else if (applyState && applyState.ok === false) {
      applyBox = `<div class="notice err">신청할 수 없습니다: ${esc(applyState.reason)}</div>`;
    } else {
      applyBox = `<form method="POST" action="/apply/${project.id}"><button class="btn btn-primary" type="submit">이 공모사업에 신청하기</button></form>`;
    }
  }

  const info = `<div class="card" style="margin-bottom:16px"><h2>사업 정보</h2>
    <table><tbody>
      <tr><td style="width:160px" class="muted">담당부서</td><td>${esc(project.department || "-")}</td></tr>
      <tr><td class="muted">신청 기간</td><td>${fmtDate(project.apply_start)} ~ ${fmtDate(project.apply_end)}</td></tr>
      <tr><td class="muted">사업 수행 기간</td><td>${fmtDate(project.project_start)} ~ ${fmtDate(project.project_end)}</td></tr>
      <tr><td class="muted">신청 대상 학교급</td><td>${esc(targetLevelText(project.target_levels))}</td></tr>
      <tr><td class="muted">대상 학교 수</td><td>${project.max_schools != null ? esc(project.max_schools) + "개교" : "-"}</td></tr>
      <tr><td class="muted">상한제 적용</td><td>${project.exempt ? `상한제 제외 (${esc(project.exempt_reason || "")})` : "상한제 적용"}</td></tr>
      ${project.description ? `<tr><td class="muted" style="vertical-align:top">사업 설명</td><td>${esc(project.description)}</td></tr>` : ""}
    </tbody></table>
    <h2 style="margin-top:20px">첨부파일</h2>
    <ul class="plain">${fileList}</ul>
  </div>`;

  const body = `<div class="page-h"><h1>${esc(project.title)}</h1><p>${esc(project.department || "담당부서 미지정")} · ${projectStatusTag(project.status, project.apply_end)}</p></div>
  ${applyBox ? `<div class="card" style="margin-bottom:16px">${applyBox}</div>` : ""}
  ${info}
  <div style="margin-top:16px"><a href="/projects" class="btn btn-ghost btn-sm">목록으로</a></div>`;
  return layout({ title: project.title, user, active: "/projects", body, flash });
}

function mySchoolPage({ user, school, apps, quota, flash }) {
  const rows = apps.length
    ? apps.map((a) => {
        const canCancel = a.status === "applied" && a.project_status === "open";
        const action = canCancel
          ? `<form method="POST" action="/cancel/${a.project_id}" style="display:inline" onsubmit="return confirm('신청을 취소하시겠습니까?')"><button class="btn btn-ghost btn-sm" type="submit">신청 취소</button></form>`
          : `<span class="muted">-</span>`;
        return `<tr>
        <td>${esc(a.title)}${a.exempt ? ` <span class="tag muted">상한제외</span>` : ""}</td>
        <td class="muted">${esc(a.department || "-")}</td>
        <td>${fmtDate(a.applied_at)}</td>
        <td>${appStatusTag(a.status)}</td>
        <td><div class="row-actions">${action}</div></td>
      </tr>`;
      }).join("")
    : `<tr><td colspan="5"><div class="empty">신청 내역이 없습니다.</div></td></tr>`;

  const cap = school.category === "special" ? SPECIAL_CAP : GENERAL_CAP;
  const body = `<div class="page-h"><h1>신청 현황</h1><p>${esc(school.name)} · ${LEVEL_LABEL[school.level] || "기타"} · ${FOUNDATION_LABEL[school.foundation] || "공립"} · ${school.category === "special" ? "특정학교" : "일반학교"}</p></div>
  <div class="grid cols-3" style="margin-bottom:16px">
    ${statCard("신청·선정 상한", `${cap}개`, "신청+선정 합산, 제외 사업 미포함")}
    ${statCard("현재 신청·선정", `${quota.used}개`, `잔여 ${Math.max(0, quota.remaining)}개`)}
    ${statCard("상한 상태", quota.full ? "상한 도달" : "신청 가능", quota.full ? "추가 신청 불가" : "제외 사업은 상한 무관")}
  </div>
  <div class="card"><h2>신청·선정 내역</h2>
  <p class="hint" style="margin-bottom:14px">공고가 진행 중(공고중)인 사업은 선정 전까지 신청을 취소할 수 있습니다.</p>
  <div class="tbl-wrap"><table>
    <thead><tr><th>사업명</th><th>담당부서</th><th>신청일</th><th>결과</th><th>관리</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div></div>`;
  return layout({ title: "신청 현황", user, active: "/my", body, flash });
}

function manageProjects({ user, projects, flash }) {
  const rows = projects.length
    ? projects.map((p) => `<tr>
        <td>${esc(p.title)}${p.exempt ? ` <span class="tag muted">상한제외</span>` : ""}</td>
        <td class="muted">${esc(p.department || "-")}</td>
        <td>${projectStatusTag(p.status, p.apply_end)}</td>
        <td class="num">${esc(p.applicant_count)}</td>
        <td class="num">${esc(p.selected_count)}</td>
        <td><div class="row-actions">
          ${p.status !== "decided" ? `<a class="btn btn-ghost btn-sm" href="/manage/projects/${p.id}">선정 처리</a>` : `<a class="btn btn-ghost btn-sm" href="/manage/projects/${p.id}">결과 보기</a>`}
          <a class="btn btn-ghost btn-sm" href="/manage/projects/${p.id}/edit">수정</a>
        </div></td>
      </tr>`).join("")
    : `<tr><td colspan="6"><div class="empty">등록된 공모사업이 없습니다. 아래에서 새로 등록하세요.</div></td></tr>`;

  const exemptOptions = EXEMPT_REASONS.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join("");

  const body = `<div class="page-h"><h1>사업 관리</h1><p>공모사업을 등록하고 신청 학교를 선정합니다.</p></div>
  <div class="card" style="margin-bottom:16px"><h2>공모사업 목록</h2><div class="tbl-wrap"><table>
    <thead><tr><th>사업명</th><th>담당부서</th><th>상태</th><th class="num">신청</th><th class="num">선정</th><th>관리</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div></div>
  <div class="card"><h2>새 공모사업 등록</h2>
  <form method="POST" action="/manage/projects" enctype="multipart/form-data" onsubmit="return gbeValidateProject(this)">
    <div class="grid cols-2">
      <div class="field"><label for="title">사업명</label><input id="title" name="title" required></div>
      <div class="field"><label for="department">담당부서</label><input id="department" name="department" required></div>
    </div>
    <div class="field"><label for="description">사업 설명</label><textarea id="description" name="description" rows="2" required></textarea></div>
    <div class="grid cols-2">
      <div class="field"><label for="apply_start">신청 시작일</label><input id="apply_start" name="apply_start" type="date" required></div>
      <div class="field"><label for="apply_end">신청 마감일</label><input id="apply_end" name="apply_end" type="date" required></div>
    </div>
    <div class="grid cols-2">
      <div class="field"><label for="project_start">사업 수행 시작일</label><input id="project_start" name="project_start" type="date" required></div>
      <div class="field"><label for="project_end">사업 수행 종료일</label><input id="project_end" name="project_end" type="date" required></div>
    </div>
    <p class="hint" style="margin:-4px 0 14px">신청 기간과 별개로 실제 공모사업이 진행되는 기간입니다.</p>
    <div class="field">
      <label for="max_schools">대상 학교 수 (모집 정원)</label>
      <input id="max_schools" name="max_schools" type="number" min="1" step="1" required>
      <p class="hint">이 사업으로 선정할 최대 학교 수입니다. (표시용)</p>
    </div>
    <div class="field">
      <label>신청 대상 학교급</label>
      <div style="display:flex;flex-wrap:wrap;gap:14px;margin-top:2px">
        ${TARGET_LEVEL_OPTIONS.map((lv) => `<label style="display:flex;align-items:center;gap:6px;font-weight:400;margin-bottom:0;cursor:pointer">
          <input type="checkbox" name="target_levels" value="${esc(lv)}" style="width:auto">
          <span>${esc(LEVEL_LABEL[lv] || lv)}</span>
        </label>`).join("")}
      </div>
      <p class="hint">선택한 학교급의 학교만 신청할 수 있습니다. 최소 1개 이상 선택해야 합니다. (중복 선택 가능)</p>
    </div>
    <div class="field">
      <label for="attachments">첨부파일 (선택)</label>
      <input id="attachments" name="attachments" type="file" multiple>
      <p class="hint">공고문·양식 등 최대 5개 첨부 (파일당 최대 20MB). 여러 개 선택 가능.</p>
    </div>
    <div class="field">
      <label for="exempt_reason">상한제 제외 여부</label>
      <select id="exempt_reason" name="exempt_reason">
        <option value="">해당 없음 (상한제 적용)</option>
        ${exemptOptions}
      </select>
      <p class="hint">제외 사유를 선택하면 선정 상한 계산에서 제외됩니다.</p>
    </div>
    <button type="submit" class="btn btn-primary">공모사업 등록</button>
  </form></div>
  <script>function gbeValidateProject(f){if(![].some.call(f.target_levels&&f.target_levels.length?f.target_levels:[f.target_levels],function(c){return c&&c.checked})){alert('신청 대상 학교급을 최소 1개 이상 선택하세요.');return false;}return true;}</script>`;
  return layout({ title: "사업 관리", user, active: "/manage/projects", body, flash });
}

function projectDetail({ user, project, applications, files, flash }) {
  const rows = applications.length
    ? applications.map((a) => `<tr>
        <td>${esc(a.school_name)} <span class="tag ${a.category === "special" ? "warn" : "muted"}">${a.category === "special" ? "특정" : "일반"}</span></td>
        <td class="num">${esc(a.used)}/${esc(a.cap)}</td>
        <td>${appStatusTag(a.status)}</td>
        <td><div class="row-actions">
          ${a.status !== "selected" ? `<form method="POST" action="/manage/select/${a.id}" style="display:inline"><button class="btn btn-primary btn-sm" type="submit">선정</button></form>` : ""}
          ${a.status !== "rejected" ? `<form method="POST" action="/manage/reject/${a.id}" style="display:inline"><button class="btn btn-ghost btn-sm" type="submit">미선정</button></form>` : ""}
        </div></td>
      </tr>`).join("")
    : `<tr><td colspan="4"><div class="empty">신청한 학교가 없습니다.</div></td></tr>`;

  const fileList = (files && files.length)
    ? files.map((f) => `<li style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line-2)">
        <span class="tag muted" style="flex-shrink:0">파일</span>
        <a href="/projects/${project.id}/files/${f.id}">${esc(f.filename)}</a>
        <span class="hint" style="margin-left:auto">${fmtSize(f.size_bytes)}</span>
      </li>`).join("")
    : `<li class="muted" style="padding:8px 0;font-size:13.5px">첨부파일이 없습니다.</li>`;

  const info = `<div class="card" style="margin-bottom:16px"><h2>사업 정보</h2>
    <table><tbody>
      <tr><td style="width:160px" class="muted">신청 기간</td><td>${fmtDate(project.apply_start)} ~ ${fmtDate(project.apply_end)}</td></tr>
      <tr><td class="muted">사업 수행 기간</td><td>${fmtDate(project.project_start)} ~ ${fmtDate(project.project_end)}</td></tr>
      <tr><td class="muted">신청 대상 학교급</td><td>${esc(targetLevelText(project.target_levels))}</td></tr>
      <tr><td class="muted">대상 학교 수</td><td>${project.max_schools != null ? esc(project.max_schools) + "개교" : "-"}</td></tr>
      ${project.description ? `<tr><td class="muted" style="vertical-align:top">사업 설명</td><td>${esc(project.description)}</td></tr>` : ""}
    </tbody></table>
    <h2 style="margin-top:20px">첨부파일</h2>
    <ul class="plain">${fileList}</ul>
  </div>`;

  const bulkCard = `<div class="card" style="margin-bottom:16px"><h2>엑셀로 일괄 선정</h2>
  <p class="hint" style="margin-bottom:14px">엑셀 열: <b>code, name</b> (학교코드·학교명). 업로드하면 명단에 포함된 신청 학교만 선정되고, <b>명단에 없는 기존 선정 학교는 미선정으로 전환</b>됩니다. 신청하지 않은 학교가 명단에 있으면 오류로 안내됩니다.</p>
  <form method="POST" action="/manage/projects/${project.id}/select-bulk" enctype="multipart/form-data">
    <div class="field"><label for="selectfile">선정 명단 엑셀 (.xlsx)</label><input id="selectfile" name="file" type="file" accept=".xlsx,.xls" required></div>
    <div class="row-actions">
      <button type="submit" class="btn btn-primary">엑셀로 일괄 선정</button>
      <a href="/manage/projects/${project.id}/select-template" class="btn btn-ghost">양식 다운로드</a>
    </div>
  </form></div>`;

  const body = `<div class="page-h"><h1>${esc(project.title)}</h1><p>${esc(project.department || "담당부서 미지정")} · ${project.exempt ? "상한제 제외 사업" : "상한제 적용 사업"}</p></div>
  ${project.exempt ? `<div class="notice info">이 사업은 상한제 제외 대상(${esc(project.exempt_reason || "")})으로, 선정 시 학교 선정 상한에 포함되지 않습니다.</div>` : ""}
  ${info}
  ${bulkCard}
  <div class="card"><h2>신청 학교 선정 처리</h2>
  <p class="hint" style="margin-bottom:14px">상한(신청+선정 합산)은 학교가 신청하는 시점에 적용되므로, 신청된 학교는 상한 내에 있습니다. 선정현황은 해당 학교의 신청·선정 합산/상한을 나타냅니다.</p>
  <div class="tbl-wrap"><table>
    <thead><tr><th>학교</th><th class="num">신청·선정/상한</th><th>결과</th><th>처리</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div></div>
  <div class="row-actions" style="margin-top:16px">
    <a href="/manage/projects" class="btn btn-ghost btn-sm">목록으로</a>
    <a href="/manage/projects/${project.id}/edit" class="btn btn-primary btn-sm">사업 수정</a>
  </div>`;
  return layout({ title: project.title, user, active: "/manage/projects", body, flash });
}

function projectEdit({ user, project, files, flash }) {
  const levels = Array.isArray(project.target_levels) ? project.target_levels : [];
  const exemptOptions = EXEMPT_REASONS.map(
    (r) => `<option value="${esc(r)}"${project.exempt_reason === r ? " selected" : ""}>${esc(r)}</option>`
  ).join("");
  const statusOptions = [
    ["open", "공고중"],
    ["closed", "마감"],
    ["decided", "선정완료"],
  ].map(([v, label]) => `<option value="${v}"${project.status === v ? " selected" : ""}>${esc(label)}</option>`).join("");

  const fileList = (files && files.length)
    ? files.map((f) => `<li style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line-2)">
        <label style="display:flex;align-items:center;gap:8px;font-weight:400;margin-bottom:0;cursor:pointer;flex:1">
          <input type="checkbox" name="delete_files" value="${f.id}" style="width:auto;flex-shrink:0">
          <span class="tag muted" style="flex-shrink:0">파일</span>
          <span>${esc(f.filename)}</span>
          <span class="hint" style="margin-left:auto">${fmtSize(f.size_bytes)}</span>
        </label>
      </li>`).join("")
    : `<li class="muted" style="padding:8px 0;font-size:13.5px">첨부파일이 없습니다.</li>`;

  const body = `<div class="page-h"><h1>사업 수정</h1><p>${esc(project.title)} · 등록된 공모사업의 내용을 수정합니다.</p></div>
  <div class="card">
  <form method="POST" action="/manage/projects/${project.id}/edit" enctype="multipart/form-data" onsubmit="return gbeValidateProject(this)">
    <div class="grid cols-2">
      <div class="field"><label for="title">사업명</label><input id="title" name="title" value="${esc(project.title)}" required></div>
      <div class="field"><label for="department">담당부서</label><input id="department" name="department" value="${esc(project.department || "")}" required></div>
    </div>
    <div class="field"><label for="description">사업 설명</label><textarea id="description" name="description" rows="2" required>${esc(project.description || "")}</textarea></div>
    <div class="grid cols-2">
      <div class="field"><label for="apply_start">신청 시작일</label><input id="apply_start" name="apply_start" type="date" value="${dateInputValue(project.apply_start)}" required></div>
      <div class="field"><label for="apply_end">신청 마감일</label><input id="apply_end" name="apply_end" type="date" value="${dateInputValue(project.apply_end)}" required></div>
    </div>
    <div class="grid cols-2">
      <div class="field"><label for="project_start">사업 수행 시작일</label><input id="project_start" name="project_start" type="date" value="${dateInputValue(project.project_start)}" required></div>
      <div class="field"><label for="project_end">사업 수행 종료일</label><input id="project_end" name="project_end" type="date" value="${dateInputValue(project.project_end)}" required></div>
    </div>
    <div class="field">
      <label for="max_schools">대상 학교 수 (모집 정원)</label>
      <input id="max_schools" name="max_schools" type="number" min="1" step="1" value="${project.max_schools != null ? esc(project.max_schools) : ""}" required>
      <p class="hint">이 사업으로 선정할 최대 학교 수입니다. (표시용)</p>
    </div>
    <div class="field">
      <label for="status">공고 상태</label>
      <select id="status" name="status">${statusOptions}</select>
      <p class="hint">공고중이어야 학교가 신청할 수 있습니다. 마감/선정완료로 바꾸면 신규 신청이 차단됩니다.</p>
    </div>
    <div class="field">
      <label>신청 대상 학교급</label>
      <div style="display:flex;flex-wrap:wrap;gap:14px;margin-top:2px">
        ${TARGET_LEVEL_OPTIONS.map((lv) => `<label style="display:flex;align-items:center;gap:6px;font-weight:400;margin-bottom:0;cursor:pointer">
          <input type="checkbox" name="target_levels" value="${esc(lv)}"${levels.includes(lv) ? " checked" : ""} style="width:auto">
          <span>${esc(LEVEL_LABEL[lv] || lv)}</span>
        </label>`).join("")}
      </div>
      <p class="hint">선택한 학교급의 학교만 신청할 수 있습니다. 최소 1개 이상 선택해야 합니다. 이미 신청한 학교가 있는 경우 대상 변경 시 주의하세요.</p>
    </div>
    <div class="field">
      <label for="exempt_reason">상한제 제외 여부</label>
      <select id="exempt_reason" name="exempt_reason">
        <option value="">해당 없음 (상한제 적용)</option>
        ${exemptOptions}
      </select>
      <p class="hint">제외 사유를 선택하면 선정 상한 계산에서 제외됩니다.</p>
    </div>
    <div class="field">
      <label>기존 첨부파일</label>
      <ul class="plain">${fileList}</ul>
      <p class="hint">삭제할 파일을 체크하면 저장 시 함께 삭제됩니다.</p>
    </div>
    <div class="field">
      <label for="attachments">첨부파일 추가 (선택)</label>
      <input id="attachments" name="attachments" type="file" multiple>
      <p class="hint">새로 추가할 파일을 선택하세요. 기존 파일과 합쳐 최대 5개까지 보관됩니다 (파일당 최대 20MB).</p>
    </div>
    <div class="row-actions">
      <button type="submit" class="btn btn-primary">변경사항 저장</button>
      <a href="/manage/projects/${project.id}" class="btn btn-ghost">취소</a>
    </div>
  </form></div>
  <script>function gbeValidateProject(f){if(![].some.call(f.target_levels&&f.target_levels.length?f.target_levels:[f.target_levels],function(c){return c&&c.checked})){alert('신청 대상 학교급을 최소 1개 이상 선택하세요.');return false;}return true;}</script>`;
  return layout({ title: "사업 수정", user, active: "/manage/projects", body, flash });
}

function schoolsPage({ user, schools, flash, q, level }) {
  const rows = schools.length
    ? schools.map((s) => {
        const cap = s.category === "special" ? SPECIAL_CAP : GENERAL_CAP;
        const full = s.selected >= cap;
        return `<tr>
          <td class="muted">${esc(s.code)}</td>
          <td>${esc(s.name)}</td>
          <td>${esc(LEVEL_LABEL[s.level] || "기타")}</td>
          <td><span class="tag ${s.foundation === "private" ? "accent" : "muted"}">${esc(FOUNDATION_LABEL[s.foundation] || "공립")}</span></td>
          <td><span class="tag ${s.category === "special" ? "warn" : "muted"}">${s.category === "special" ? "특정학교" : "일반학교"}</span></td>
          <td class="num">${esc(cap)}</td>
          <td class="num">${esc(s.selected)}</td>
          <td>${full ? `<span class="tag danger">상한 도달</span>` : `<span class="tag ok">여유 ${cap - s.selected}</span>`}</td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="8"><div class="empty">${(q || level) ? "검색 결과가 없습니다." : "등록된 학교가 없습니다."}</div></td></tr>`;

  const qv = q || "";
  const lv = level || "";
  const levelOpts = TARGET_LEVEL_OPTIONS.map((l) => `<option value="${esc(l)}"${lv === l ? " selected" : ""}>${esc(LEVEL_LABEL[l] || l)}</option>`).join("");
  const searchForm = `<form method="GET" action="/manage/schools" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
    <input name="q" value="${esc(qv)}" placeholder="학교명으로 검색" style="flex:1;min-width:200px;max-width:320px">
    <select name="level" style="width:auto"><option value="">전체 학교급</option>${levelOpts}</select>
    <button type="submit" class="btn btn-primary btn-sm">검색</button>
    ${(qv || lv) ? `<a href="/manage/schools" class="btn btn-ghost btn-sm">초기화</a>` : ""}
  </form>`;

  const body = `<div class="page-h"><h1>학교/상한 현황</h1><p>학교별 선정 상한 대비 현재 선정 현황 (상한제 제외 사업 미포함)</p></div>
  <div class="card">${searchForm}<div class="tbl-wrap"><table>
    <thead><tr><th>학교코드</th><th>학교명</th><th>학교급</th><th>설립</th><th>구분</th><th class="num">상한</th><th class="num">선정</th><th>상태</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div></div>`;
  return layout({ title: "학교/상한 현황", user, active: "/manage/schools", body, flash });
}

function adminPage({ user, counts, flash }) {
  const body = `<div class="page-h"><h1>회원·데이터 관리</h1><p>엑셀 업로드로 회원 계정과 특정학교 명단을 일괄 등록합니다.</p></div>
  <div class="grid cols-3" style="margin-bottom:16px">
    ${statCard("전체 회원", `${counts.users}명`, `관리자 ${counts.managers}명 · 학교 ${counts.schoolUsers}명`)}
    ${statCard("등록 학교", `${counts.schools}개교`)}
    ${statCard("특정학교", `${counts.special}개교`, "상한 2개 적용")}
  </div>
  <div class="grid cols-2">
    <div class="card"><h2>회원 일괄 등록</h2>
      <p class="hint" style="margin-bottom:14px">엑셀 열: <b>username, password, role, name, school_code</b><br>role 값: super_admin / project_manager / school_user</p>
      <form method="POST" action="/admin/import-users" enctype="multipart/form-data">
        <div class="field"><label for="userfile">회원 엑셀 파일 (.xlsx)</label><input id="userfile" name="file" type="file" accept=".xlsx,.xls" required></div>
        <div class="row-actions">
          <button type="submit" class="btn btn-primary">업로드</button>
          <a href="/admin/template/users" class="btn btn-ghost">양식 다운로드</a>
        </div>
      </form>
    </div>
    <div class="card"><h2>특정학교 명단 등록</h2>
      <p class="hint" style="margin-bottom:14px">엑셀 열: <b>code, name</b><br>업로드된 학교는 특정학교(상한 2개)로 분류됩니다.</p>
      <form method="POST" action="/admin/import-special" enctype="multipart/form-data">
        <div class="field"><label for="spfile">특정학교 엑셀 파일 (.xlsx)</label><input id="spfile" name="file" type="file" accept=".xlsx,.xls" required></div>
        <div class="row-actions">
          <button type="submit" class="btn btn-primary">업로드</button>
          <a href="/admin/template/special" class="btn btn-ghost">양식 다운로드</a>
        </div>
      </form>
    </div>
  </div>
  <div class="card" style="margin-top:16px"><h2>학교 일괄 등록</h2>
    <p class="hint" style="margin-bottom:14px">엑셀 열: <b>code, name, category, foundation, level</b><br>category: general 또는 special · foundation: 공립 또는 사립 · level: 유치원/초등학교/중학교/고등학교/특수학교</p>
    <form method="POST" action="/admin/import-schools" enctype="multipart/form-data">
      <div class="field"><label for="schfile">학교 엑셀 파일 (.xlsx)</label><input id="schfile" name="file" type="file" accept=".xlsx,.xls" required></div>
      <div class="row-actions">
        <button type="submit" class="btn btn-primary">업로드</button>
        <a href="/admin/template/schools" class="btn btn-ghost">양식 다운로드</a>
      </div>
    </form>
  </div>`;
  return layout({ title: "회원·데이터 관리", user, active: "/admin", body, flash });
}

module.exports = {
  dashboard, projectsList, projectView, mySchoolPage, manageProjects,
  projectDetail, projectEdit, schoolsPage, adminPage,
};
