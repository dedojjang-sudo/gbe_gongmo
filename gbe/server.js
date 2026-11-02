"use strict";

const express = require("express");
const session = require("express-session");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const XLSX = require("xlsx");

const { pool, initDb } = require("./db");
const { canApply, quotaFor, levelAllowed } = require("./cap");
const { loginPage } = require("./views");
const { TARGET_LEVEL_OPTIONS } = require("./schema");
const pages = require("./pages");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "gbe-gongmo-dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 8 },
  })
);

const MAX_FILES = 5;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES } });

function uploadAttachments(req, res, next) {
  upload.array("attachments", MAX_FILES)(req, res, (err) => {
    if (!err) return next();
    let msg = "첨부파일 업로드 오류: " + err.message;
    if (err.code === "LIMIT_FILE_SIZE") msg = "첨부파일은 파일당 최대 20MB까지 가능합니다.";
    else if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") msg = "첨부파일은 최대 5개까지 가능합니다.";
    setFlash(req, "err", msg);
    res.redirect(req.get("referer") || "/manage/projects");
  });
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect("/login");
    if (!roles.includes(req.session.user.role)) return res.status(403).send("권한이 없습니다.");
    next();
  };
}
function canManageProject(user, project) {
  return user.role === "super_admin" || project.created_by === user.id;
}
function takeFlash(req) {
  const f = req.session.flash;
  req.session.flash = null;
  return f;
}
function setFlash(req, type, msg) {
  req.session.flash = { type, msg };
}

function sheetRows(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: "" });
}

// multer decodes multipart filenames as latin1; re-read as UTF-8 to recover Korean names.
function decodeFilename(name) {
  if (!name) return "file";
  const utf8 = Buffer.from(name, "latin1").toString("utf8");
  return utf8.includes("\uFFFD") ? name : utf8;
}

function normFoundation(v) {
  const s = String(v || "").trim();
  if (["private", "사립"].includes(s)) return "private";
  return "public";
}
function normLevel(v) {
  const s = String(v || "").trim();
  const map = {
    kinder: "kinder", 유치원: "kinder",
    elementary: "elementary", 초등학교: "elementary", 초등: "elementary", 초: "elementary",
    middle: "middle", 중학교: "middle", 중등: "middle", 중: "middle",
    high: "high", 고등학교: "high", 고등: "high", 고: "high",
    special: "special", 특수학교: "special", 특수: "special",
  };
  return map[s] || "etc";
}
function sendXlsx(res, rows, sheetName, filename) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buf);
}

function parseProjectInput(body) {
  const title = String(body.title || "").trim();
  const department = String(body.department || "").trim();
  const description = String(body.description || "").trim();
  const apply_start = String(body.apply_start || "").trim();
  const apply_end = String(body.apply_end || "").trim();
  const project_start = String(body.project_start || "").trim();
  const project_end = String(body.project_end || "").trim();
  const maxRaw = String(body.max_schools || "").trim();
  let targetLevels = body.target_levels || [];
  if (!Array.isArray(targetLevels)) targetLevels = [targetLevels];
  targetLevels = targetLevels.filter((l) => TARGET_LEVEL_OPTIONS.includes(l));

  const errors = [];
  if (!title) errors.push("사업명");
  if (!department) errors.push("담당부서");
  if (!description) errors.push("사업 설명");
  if (!apply_start) errors.push("신청 시작일");
  if (!apply_end) errors.push("신청 마감일");
  if (!project_start) errors.push("사업 수행 시작일");
  if (!project_end) errors.push("사업 수행 종료일");
  const maxSchools = parseInt(maxRaw, 10);
  if (!maxRaw || !Number.isInteger(maxSchools) || maxSchools < 1) errors.push("대상 학교 수(1 이상)");
  if (!targetLevels.length) errors.push("신청 대상 학교급(1개 이상)");

  return {
    errors, title, department, description,
    apply_start, apply_end, project_start, project_end,
    maxSchools: Number.isInteger(maxSchools) ? maxSchools : null,
    targetLevels,
  };
}

app.get("/healthz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", db: "up" });
  } catch (err) {
    res.status(503).json({ status: "degraded", db: "down", error: err.message });
  }
});

app.get("/login", (req, res) => {
  if (req.session.user) return res.redirect("/");
  res.type("html").send(loginPage());
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const { rows } = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).type("html").send(loginPage({ error: "아이디 또는 비밀번호가 올바르지 않습니다." }));
    }
    req.session.user = { id: user.id, username: user.username, role: user.role, name: user.name, school_id: user.school_id };
    res.redirect("/");
  } catch (err) {
    res.status(500).type("html").send(loginPage({ error: "로그인 처리 중 오류: " + err.message }));
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

app.get("/", requireAuth, async (req, res) => {
  const u = req.session.user;
  try {
    const flash = takeFlash(req);
    if (u.role === "school_user") {
      const sres = await pool.query("SELECT * FROM schools WHERE id = $1", [u.school_id]);
      const mySchool = sres.rows[0];
      const stats = { used: 0, applied: 0, selected: 0, cap: 0 };
      if (mySchool) {
        const q = await quotaFor(pool, mySchool);
        stats.used = q.used;
        stats.cap = q.cap;
        const ap = await pool.query(
          `SELECT
             COUNT(*) FILTER (WHERE a.status = 'applied' AND p.exempt = false)::int AS applied,
             COUNT(*) FILTER (WHERE a.status = 'selected' AND p.exempt = false)::int AS selected
           FROM applications a JOIN projects p ON p.id = a.project_id
           WHERE a.school_id = $1`,
          [mySchool.id]
        );
        stats.applied = ap.rows[0].applied;
        stats.selected = ap.rows[0].selected;
      }
      return res.type("html").send(pages.dashboard({ user: u, stats, flash, mySchool }));
    }
    const [p, sch, ap] = await Promise.all([
      pool.query("SELECT COUNT(*)::int c, COUNT(*) FILTER (WHERE status='open')::int o FROM projects"),
      pool.query("SELECT COUNT(*)::int c, COUNT(*) FILTER (WHERE category='special')::int sp FROM schools"),
      pool.query("SELECT COUNT(*)::int c, COUNT(*) FILTER (WHERE status='selected')::int sel FROM applications"),
    ]);
    const stats = {
      projects: p.rows[0].c, open: p.rows[0].o,
      schools: sch.rows[0].c, special: sch.rows[0].sp,
      applications: ap.rows[0].c, selected: ap.rows[0].sel,
    };
    res.type("html").send(pages.dashboard({ user: u, stats, flash }));
  } catch (err) {
    res.status(500).send("오류: " + err.message);
  }
});

app.get("/projects", requireAuth, async (req, res) => {
  const u = req.session.user;
  const q = (req.query.q || "").trim();
  try {
    const params = [];
    let where = "";
    if (q) { params.push(`%${q}%`); where = `WHERE p.title ILIKE $${params.length}`; }
    let { rows: projects } = await pool.query(`
      SELECT p.id, p.title, p.status, p.apply_start, p.apply_end, p.target_levels, p.exempt,
        (SELECT COUNT(*)::int FROM applications a WHERE a.project_id = p.id) AS applicant_count
      FROM projects p ${where} ORDER BY p.created_at DESC`, params);
    const canApplyMap = {};
    if (u.role === "school_user" && u.school_id) {
      const sres = await pool.query("SELECT * FROM schools WHERE id = $1", [u.school_id]);
      const school = sres.rows[0];
      const existing = await pool.query("SELECT project_id, status FROM applications WHERE school_id = $1", [u.school_id]);
      const byProject = {};
      existing.rows.forEach((r) => (byProject[r.project_id] = r.status));
      if (school) {
        projects = projects.filter((p) => levelAllowed(p, school) || byProject[p.id]);
      }
      for (const p of projects) {
        if (byProject[p.id]) {
          canApplyMap[p.id] = { applied: true, status: byProject[p.id] };
        } else if (school) {
          if (!levelAllowed(p, school)) {
            canApplyMap[p.id] = { ok: false, reason: "신청 대상 학교급이 아닙니다." };
          } else {
            canApplyMap[p.id] = await canApply(pool, school, p);
          }
        }
      }
    }
    res.type("html").send(pages.projectsList({ user: u, projects, flash: takeFlash(req), canApplyMap, q }));
  } catch (err) {
    res.status(500).send("오류: " + err.message);
  }
});

app.get("/projects/:id", requireAuth, async (req, res) => {
  const u = req.session.user;
  try {
    const pr = await pool.query("SELECT * FROM projects WHERE id = $1", [req.params.id]);
    const project = pr.rows[0];
    if (!project) return res.status(404).send("공모사업을 찾을 수 없습니다.");
    const files = (await pool.query(
      "SELECT id, filename, size_bytes, uploaded_at FROM project_files WHERE project_id = $1 ORDER BY uploaded_at",
      [project.id]
    )).rows;
    let applyState = null;
    if (u.role === "school_user" && u.school_id) {
      const school = (await pool.query("SELECT * FROM schools WHERE id = $1", [u.school_id])).rows[0];
      const existing = (await pool.query(
        "SELECT status FROM applications WHERE school_id = $1 AND project_id = $2", [u.school_id, project.id]
      )).rows[0];
      if (existing) applyState = { applied: true, status: existing.status };
      else if (school && !levelAllowed(project, school)) applyState = { ok: false, reason: "신청 대상 학교급이 아닙니다." };
      else if (school) applyState = await canApply(pool, school, project);
    }
    res.type("html").send(pages.projectView({ user: u, project, files, applyState, flash: takeFlash(req) }));
  } catch (err) {
    res.status(500).send("오류: " + err.message);
  }
});

app.post("/apply/:id", requireRole("school_user"), async (req, res) => {
  const u = req.session.user;
  const client = await pool.connect();
  try {
    if (!u.school_id) { setFlash(req, "err", "소속 학교가 지정되지 않았습니다."); return res.redirect("/projects"); }
    await client.query("BEGIN");
    const pr = await client.query("SELECT * FROM projects WHERE id = $1", [req.params.id]);
    const project = pr.rows[0];
    if (!project || project.status !== "open") {
      await client.query("ROLLBACK");
      setFlash(req, "err", "신청할 수 없는 사업입니다."); return res.redirect("/projects");
    }
    const sres = await client.query("SELECT * FROM schools WHERE id = $1 FOR UPDATE", [u.school_id]);
    const school = sres.rows[0];
    if (!school) {
      await client.query("ROLLBACK");
      setFlash(req, "err", "소속 학교 정보를 찾을 수 없습니다."); return res.redirect("/projects");
    }
    if (!levelAllowed(project, school)) {
      await client.query("ROLLBACK");
      setFlash(req, "err", "이 공모사업의 신청 대상 학교급이 아닙니다.");
      return res.redirect("/projects");
    }
    const verdict = await canApply(client, school, project);
    if (!verdict.ok) {
      await client.query("ROLLBACK");
      setFlash(req, "err", `신청 불가: ${verdict.reason}`);
      return res.redirect("/projects");
    }
    await client.query(
      "INSERT INTO applications (project_id, school_id) VALUES ($1,$2) ON CONFLICT (project_id, school_id) DO NOTHING",
      [project.id, u.school_id]
    );
    await client.query("COMMIT");
    setFlash(req, "ok", `'${project.title}' 신청이 접수되었습니다.`);
    res.redirect("/projects");
  } catch (err) {
    await client.query("ROLLBACK");
    setFlash(req, "err", "신청 오류: " + err.message);
    res.redirect("/projects");
  } finally {
    client.release();
  }
});

app.post("/cancel/:id", requireRole("school_user"), async (req, res) => {
  const u = req.session.user;
  const client = await pool.connect();
  try {
    if (!u.school_id) { setFlash(req, "err", "소속 학교가 지정되지 않았습니다."); return res.redirect("/my"); }
    await client.query("BEGIN");
    const ar = await client.query(`
      SELECT a.status, p.title, p.status AS project_status
      FROM applications a JOIN projects p ON p.id = a.project_id
      WHERE a.project_id = $1 AND a.school_id = $2 FOR UPDATE`, [req.params.id, u.school_id]);
    const a = ar.rows[0];
    if (!a) {
      await client.query("ROLLBACK");
      setFlash(req, "err", "신청 내역을 찾을 수 없습니다."); return res.redirect("/my");
    }
    if (a.status !== "applied") {
      await client.query("ROLLBACK");
      setFlash(req, "err", a.status === "selected" ? "이미 선정된 사업은 신청을 취소할 수 없습니다." : "이미 처리된 신청은 취소할 수 없습니다.");
      return res.redirect("/my");
    }
    if (a.project_status !== "open") {
      await client.query("ROLLBACK");
      setFlash(req, "err", "공고가 마감되어 신청을 취소할 수 없습니다.");
      return res.redirect("/my");
    }
    await client.query(
      "DELETE FROM applications WHERE project_id = $1 AND school_id = $2 AND status = 'applied'",
      [req.params.id, u.school_id]
    );
    await client.query("COMMIT");
    setFlash(req, "ok", `'${a.title}' 신청이 취소되었습니다.`);
    res.redirect("/my");
  } catch (err) {
    await client.query("ROLLBACK");
    setFlash(req, "err", "취소 오류: " + err.message);
    res.redirect("/my");
  } finally {
    client.release();
  }
});

app.get("/my", requireRole("school_user"), async (req, res) => {
  const u = req.session.user;
  try {
    const sres = await pool.query("SELECT * FROM schools WHERE id = $1", [u.school_id]);
    const school = sres.rows[0];
    if (!school) return res.status(400).send("소속 학교가 지정되지 않았습니다.");
    const { rows: apps } = await pool.query(`
      SELECT a.*, p.title, p.department, p.exempt, p.status AS project_status
      FROM applications a JOIN projects p ON p.id = a.project_id
      WHERE a.school_id = $1 ORDER BY a.applied_at DESC`, [school.id]);
    const quota = await quotaFor(pool, school);
    res.type("html").send(pages.mySchoolPage({ user: u, school, apps, quota, flash: takeFlash(req) }));
  } catch (err) {
    res.status(500).send("오류: " + err.message);
  }
});

app.get("/manage/projects", requireRole("super_admin", "project_manager"), async (req, res) => {
  try {
    const u = req.session.user;
    const ownOnly = u.role === "project_manager";
    const { rows: projects } = await pool.query(`
      SELECT p.*,
        (SELECT COUNT(*)::int FROM applications a WHERE a.project_id = p.id) AS applicant_count,
        (SELECT COUNT(*)::int FROM applications a WHERE a.project_id = p.id AND a.status='selected') AS selected_count
      FROM projects p ${ownOnly ? "WHERE p.created_by = $1" : ""} ORDER BY p.created_at DESC`,
      ownOnly ? [u.id] : []);
    res.type("html").send(pages.manageProjects({ user: req.session.user, projects, flash: takeFlash(req) }));
  } catch (err) {
    res.status(500).send("오류: " + err.message);
  }
});

app.post("/manage/projects", requireRole("super_admin", "project_manager"), uploadAttachments, async (req, res) => {
  const v = parseProjectInput(req.body);
  if (v.errors.length) {
    setFlash(req, "err", "필수 항목을 입력하세요: " + v.errors.join(", "));
    return res.redirect("/manage/projects");
  }
  const exempt = !!(req.body.exempt_reason && req.body.exempt_reason.trim());
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ins = await client.query(
      `INSERT INTO projects (title, description, department, exempt, exempt_reason, max_schools, apply_start, apply_end, project_start, project_end, target_levels, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [v.title, v.description, v.department, exempt, exempt ? req.body.exempt_reason : null, v.maxSchools,
       v.apply_start, v.apply_end, v.project_start, v.project_end, v.targetLevels, req.session.user.id]
    );
    const files = req.files || [];
    for (const f of files) {
      await client.query(
        `INSERT INTO project_files (project_id, filename, mime_type, size_bytes, data, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [ins.rows[0].id, decodeFilename(f.originalname), f.mimetype || "application/octet-stream",
         f.size, f.buffer, req.session.user.id]
      );
    }
    await client.query("COMMIT");
    setFlash(req, "ok", "공모사업이 등록되었습니다." + (files.length ? ` (첨부파일 ${files.length}건 포함)` : ""));
    res.redirect("/manage/projects");
  } catch (err) {
    await client.query("ROLLBACK");
    setFlash(req, "err", "등록 오류: " + err.message);
    res.redirect("/manage/projects");
  } finally {
    client.release();
  }
});

app.get("/manage/projects/:id", requireRole("super_admin", "project_manager"), async (req, res) => {
  try {
    const pr = await pool.query("SELECT * FROM projects WHERE id = $1", [req.params.id]);
    const project = pr.rows[0];
    if (!project) return res.status(404).send("사업을 찾을 수 없습니다.");
    if (!canManageProject(req.session.user, project)) return res.status(403).send("권한이 없습니다. 본인이 등록한 사업만 관리할 수 있습니다.");
    const files = (await pool.query(
      "SELECT id, filename, size_bytes, uploaded_at FROM project_files WHERE project_id = $1 ORDER BY uploaded_at",
      [project.id]
    )).rows;
    const { rows } = await pool.query(`
      SELECT a.*, s.name AS school_name, s.category, s.id AS sid
      FROM applications a JOIN schools s ON s.id = a.school_id
      WHERE a.project_id = $1 ORDER BY s.category DESC, s.name`, [project.id]);
    const applications = [];
    for (const a of rows) {
      const school = { id: a.sid, category: a.category };
      const q = await quotaFor(pool, school);
      applications.push({
        ...a, used: project.exempt ? "-" : q.used, cap: project.exempt ? "-" : q.cap,
      });
    }
    res.type("html").send(pages.projectDetail({ user: req.session.user, project, applications, files, flash: takeFlash(req) }));
  } catch (err) {
    res.status(500).send("오류: " + err.message);
  }
});

app.get("/manage/projects/:id/edit", requireRole("super_admin", "project_manager"), async (req, res) => {
  try {
    const pr = await pool.query("SELECT * FROM projects WHERE id = $1", [req.params.id]);
    const project = pr.rows[0];
    if (!project) return res.status(404).send("사업을 찾을 수 없습니다.");
    if (!canManageProject(req.session.user, project)) return res.status(403).send("권한이 없습니다. 본인이 등록한 사업만 수정할 수 있습니다.");
    const files = (await pool.query(
      "SELECT id, filename, size_bytes, uploaded_at FROM project_files WHERE project_id = $1 ORDER BY uploaded_at",
      [project.id]
    )).rows;
    res.type("html").send(pages.projectEdit({ user: req.session.user, project, files, flash: takeFlash(req) }));
  } catch (err) {
    res.status(500).send("오류: " + err.message);
  }
});

app.post("/manage/projects/:id/edit", requireRole("super_admin", "project_manager"), uploadAttachments, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const editUrl = "/manage/projects/" + id + "/edit";
  const v = parseProjectInput(req.body);
  if (v.errors.length) {
    setFlash(req, "err", "필수 항목을 입력하세요: " + v.errors.join(", "));
    return res.redirect(editUrl);
  }
  const exempt = !!(req.body.exempt_reason && req.body.exempt_reason.trim());
  const nextStatus = ["open", "closed", "decided"].includes(status) ? status : "open";
  let deleteIds = req.body.delete_files || [];
  if (!Array.isArray(deleteIds)) deleteIds = [deleteIds];
  deleteIds = deleteIds.map((x) => parseInt(x, 10)).filter((x) => Number.isInteger(x));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const pr = await client.query("SELECT id, created_by FROM projects WHERE id = $1 FOR UPDATE", [id]);
    if (!pr.rows[0]) {
      await client.query("ROLLBACK");
      setFlash(req, "err", "사업을 찾을 수 없습니다."); return res.redirect("/manage/projects");
    }
    if (!canManageProject(req.session.user, pr.rows[0])) {
      await client.query("ROLLBACK");
      return res.status(403).send("권한이 없습니다. 본인이 등록한 사업만 수정할 수 있습니다.");
    }
    await client.query(
      `UPDATE projects SET title=$1, description=$2, department=$3, exempt=$4, exempt_reason=$5,
         status=$6, max_schools=$7, apply_start=$8, apply_end=$9, project_start=$10, project_end=$11, target_levels=$12
       WHERE id=$13`,
      [v.title, v.description, v.department, exempt, exempt ? req.body.exempt_reason : null,
       nextStatus, v.maxSchools, v.apply_start, v.apply_end, v.project_start, v.project_end, v.targetLevels, id]
    );
    if (deleteIds.length) {
      await client.query("DELETE FROM project_files WHERE project_id = $1 AND id = ANY($2::bigint[])", [id, deleteIds]);
    }
    const remaining = (await client.query("SELECT COUNT(*)::int c FROM project_files WHERE project_id = $1", [id])).rows[0].c;
    const files = req.files || [];
    if (remaining + files.length > MAX_FILES) {
      await client.query("ROLLBACK");
      setFlash(req, "err", `첨부파일은 최대 ${MAX_FILES}개까지 보관할 수 있습니다. (현재 ${remaining}개 + 추가 ${files.length}개)`);
      return res.redirect(editUrl);
    }
    for (const f of files) {
      await client.query(
        `INSERT INTO project_files (project_id, filename, mime_type, size_bytes, data, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, decodeFilename(f.originalname), f.mimetype || "application/octet-stream",
         f.size, f.buffer, req.session.user.id]
      );
    }
    await client.query("COMMIT");
    const notes = [];
    if (deleteIds.length) notes.push(`첨부 ${deleteIds.length}건 삭제`);
    if (files.length) notes.push(`첨부 ${files.length}건 추가`);
    setFlash(req, "ok", "공모사업이 수정되었습니다." + (notes.length ? ` (${notes.join(", ")})` : ""));
    res.redirect("/manage/projects/" + id);
  } catch (err) {
    await client.query("ROLLBACK");
    setFlash(req, "err", "수정 오류: " + err.message);
    res.redirect(editUrl);
  } finally {
    client.release();
  }
});

app.get("/manage/projects/:id/select-template", requireRole("super_admin", "project_manager"), async (req, res) => {
  try {
    const pr = await pool.query("SELECT created_by FROM projects WHERE id = $1", [req.params.id]);
    if (!pr.rows[0]) return res.status(404).send("사업을 찾을 수 없습니다.");
    if (!canManageProject(req.session.user, pr.rows[0])) return res.status(403).send("권한이 없습니다.");
    sendXlsx(res, [{ code: "M001", name: "경북중학교" }], "선정명단", "select_template.xlsx");
  } catch (err) {
    res.status(500).send("오류: " + err.message);
  }
});

app.post("/manage/projects/:id/select-bulk", requireRole("super_admin", "project_manager"), upload.single("file"), async (req, res) => {
  const { id } = req.params;
  const detailUrl = "/manage/projects/" + id;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const pr = await client.query("SELECT id, created_by FROM projects WHERE id = $1 FOR UPDATE", [id]);
    if (!pr.rows[0]) {
      await client.query("ROLLBACK");
      setFlash(req, "err", "사업을 찾을 수 없습니다."); return res.redirect("/manage/projects");
    }
    if (!canManageProject(req.session.user, pr.rows[0])) {
      await client.query("ROLLBACK");
      return res.status(403).send("권한이 없습니다. 본인이 등록한 사업만 관리할 수 있습니다.");
    }
    if (!req.file) {
      await client.query("ROLLBACK");
      setFlash(req, "err", "엑셀 파일이 없습니다."); return res.redirect(detailUrl);
    }
    const rows = sheetRows(req.file.buffer);
    const appRows = (await client.query(
      `SELECT a.id AS app_id, a.school_id, a.status, s.code, s.name
       FROM applications a JOIN schools s ON s.id = a.school_id
       WHERE a.project_id = $1`, [id]
    )).rows;
    const appByKey = new Map();
    for (const r of appRows) appByKey.set(`${String(r.code).trim()}\u0000${String(r.name).trim()}`, r);

    const matchedAppIds = new Set();
    const notApplied = [];
    let seen = 0;
    for (const row of rows) {
      const code = String(row.code || "").trim();
      const name = String(row.name || "").trim();
      if (!code && !name) continue;
      seen++;
      const hit = appByKey.get(`${code}\u0000${name}`);
      if (hit) matchedAppIds.add(hit.app_id);
      else notApplied.push(name || code);
    }

    let selected = 0, unselected = 0;
    for (const r of appRows) {
      if (matchedAppIds.has(r.app_id)) {
        if (r.status !== "selected") {
          await client.query("UPDATE applications SET status='selected', decided_at=now() WHERE id=$1", [r.app_id]);
        }
        selected++;
      } else {
        if (r.status !== "rejected") {
          await client.query("UPDATE applications SET status='rejected', decided_at=now() WHERE id=$1", [r.app_id]);
          unselected++;
        }
      }
    }
    await client.query("COMMIT");

    let msg = `엑셀 일괄 선정 완료: ${selected}개교 선정, ${unselected}개교 미선정 전환 (명단 ${seen}건 처리).`;
    if (notApplied.length) {
      msg += ` 신청하지 않아 제외된 학교 ${notApplied.length}곳: ${notApplied.slice(0, 10).join(", ")}${notApplied.length > 10 ? " 외" : ""}.`;
      setFlash(req, "err", msg);
    } else {
      setFlash(req, "ok", msg);
    }
    res.redirect(detailUrl);
  } catch (err) {
    await client.query("ROLLBACK");
    setFlash(req, "err", "일괄 선정 오류: " + err.message);
    res.redirect(detailUrl);
  } finally {
    client.release();
  }
});

app.get("/projects/:id/files/:fileId", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT filename, mime_type, data FROM project_files WHERE id = $1 AND project_id = $2",
      [req.params.fileId, req.params.id]
    );
    const f = rows[0];
    if (!f) return res.status(404).send("첨부파일을 찾을 수 없습니다.");
    res.setHeader("Content-Type", f.mime_type || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`);
    res.send(f.data);
  } catch (err) {
    res.status(500).send("오류: " + err.message);
  }
});

app.post("/manage/select/:appId", requireRole("super_admin", "project_manager"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ar = await client.query(`
      SELECT a.*, p.exempt, p.title, p.created_by, s.category, s.name AS school_name, s.id AS sid
      FROM applications a JOIN projects p ON p.id = a.project_id JOIN schools s ON s.id = a.school_id
      WHERE a.id = $1 FOR UPDATE OF a`, [req.params.appId]);
    const a = ar.rows[0];
    if (!a) { await client.query("ROLLBACK"); setFlash(req, "err", "신청 내역을 찾을 수 없습니다."); return res.redirect("/manage/projects"); }
    if (!canManageProject(req.session.user, a)) {
      await client.query("ROLLBACK");
      return res.status(403).send("권한이 없습니다. 본인이 등록한 사업만 선정 처리할 수 있습니다.");
    }
    await client.query("UPDATE applications SET status='selected', decided_at=now() WHERE id=$1", [a.id]);
    await client.query("COMMIT");
    setFlash(req, "ok", `${a.school_name} 선정 처리되었습니다.`);
    res.redirect("/manage/projects/" + a.project_id);
  } catch (err) {
    await client.query("ROLLBACK");
    setFlash(req, "err", "선정 오류: " + err.message);
    res.redirect("/manage/projects");
  } finally {
    client.release();
  }
});

app.post("/manage/reject/:appId", requireRole("super_admin", "project_manager"), async (req, res) => {
  try {
    const ar = await pool.query(`
      SELECT a.project_id, p.created_by FROM applications a
      JOIN projects p ON p.id = a.project_id WHERE a.id = $1`, [req.params.appId]);
    if (!ar.rows[0]) { setFlash(req, "err", "신청 내역을 찾을 수 없습니다."); return res.redirect("/manage/projects"); }
    if (!canManageProject(req.session.user, ar.rows[0])) return res.status(403).send("권한이 없습니다. 본인이 등록한 사업만 처리할 수 있습니다.");
    await pool.query("UPDATE applications SET status='rejected', decided_at=now() WHERE id=$1", [req.params.appId]);
    setFlash(req, "ok", "미선정 처리되었습니다.");
    res.redirect("/manage/projects/" + ar.rows[0].project_id);
  } catch (err) {
    setFlash(req, "err", "처리 오류: " + err.message);
    res.redirect("/manage/projects");
  }
});

app.get("/manage/schools", requireRole("super_admin", "project_manager"), async (req, res) => {
  const q = (req.query.q || "").trim();
  const level = (req.query.level || "").trim();
  try {
    const params = [];
    const conds = [];
    if (q) { params.push(`%${q}%`); conds.push(`s.name ILIKE $${params.length}`); }
    if (level) { params.push(level); conds.push(`s.level = $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const { rows: schools } = await pool.query(`
      SELECT s.*,
        (SELECT COUNT(*)::int FROM applications a JOIN projects p ON p.id=a.project_id
         WHERE a.school_id=s.id AND a.status='selected' AND p.exempt=false) AS selected
      FROM schools s ${where} ORDER BY s.category DESC, s.name`, params);
    res.type("html").send(pages.schoolsPage({ user: req.session.user, schools, flash: takeFlash(req), q, level }));
  } catch (err) {
    res.status(500).send("오류: " + err.message);
  }
});

app.get("/admin", requireRole("super_admin"), async (req, res) => {
  try {
    const [u, s] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int c,
        COUNT(*) FILTER (WHERE role='project_manager')::int mgr,
        COUNT(*) FILTER (WHERE role='school_user')::int su FROM users`),
      pool.query(`SELECT COUNT(*)::int c, COUNT(*) FILTER (WHERE category='special')::int sp FROM schools`),
    ]);
    const counts = {
      users: u.rows[0].c, managers: u.rows[0].mgr, schoolUsers: u.rows[0].su,
      schools: s.rows[0].c, special: s.rows[0].sp,
    };
    res.type("html").send(pages.adminPage({ user: req.session.user, counts, flash: takeFlash(req) }));
  } catch (err) {
    res.status(500).send("오류: " + err.message);
  }
});

app.post("/admin/import-users", requireRole("super_admin"), upload.single("file"), async (req, res) => {
  if (!req.file) { setFlash(req, "err", "파일이 없습니다."); return res.redirect("/admin"); }
  const client = await pool.connect();
  try {
    const rows = sheetRows(req.file.buffer);
    const schoolMap = {};
    (await client.query("SELECT id, code FROM schools")).rows.forEach((r) => (schoolMap[String(r.code)] = r.id));
    await client.query("BEGIN");
    let imported = 0;
    for (const r of rows) {
      const username = String(r.username || "").trim();
      const name = String(r.name || "").trim();
      const role = String(r.role || "").trim();
      if (!username || !name || !["super_admin", "project_manager", "school_user"].includes(role)) continue;
      const pw = String(r.password || username).trim();
      const hash = await bcrypt.hash(pw, 10);
      const schoolId = r.school_code ? schoolMap[String(r.school_code).trim()] || null : null;
      await client.query(
        `INSERT INTO users (username, password, role, name, school_id) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (username) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role, school_id=EXCLUDED.school_id`,
        [username, hash, role, name, schoolId]
      );
      imported++;
    }
    await client.query("COMMIT");
    setFlash(req, "ok", `회원 ${imported}명이 등록되었습니다.`);
  } catch (err) {
    await client.query("ROLLBACK");
    setFlash(req, "err", "업로드 오류: " + err.message);
  } finally {
    client.release();
    res.redirect("/admin");
  }
});

app.post("/admin/import-special", requireRole("super_admin"), upload.single("file"), async (req, res) => {
  if (!req.file) { setFlash(req, "err", "파일이 없습니다."); return res.redirect("/admin"); }
  try {
    const rows = sheetRows(req.file.buffer);
    let n = 0;
    for (const r of rows) {
      const code = String(r.code || "").trim();
      const name = String(r.name || "").trim();
      if (!code || !name) continue;
      await pool.query(
        `INSERT INTO schools (code, name, category) VALUES ($1,$2,'special')
         ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, category='special'`,
        [code, name]
      );
      n++;
    }
    setFlash(req, "ok", `특정학교 ${n}개교가 등록/갱신되었습니다.`);
  } catch (err) {
    setFlash(req, "err", "업로드 오류: " + err.message);
  }
  res.redirect("/admin");
});

app.post("/admin/import-schools", requireRole("super_admin"), upload.single("file"), async (req, res) => {
  if (!req.file) { setFlash(req, "err", "파일이 없습니다."); return res.redirect("/admin"); }
  try {
    const rows = sheetRows(req.file.buffer);
    let n = 0;
    for (const r of rows) {
      const code = String(r.code || "").trim();
      const name = String(r.name || "").trim();
      const category = String(r.category || "general").trim() === "special" ? "special" : "general";
      const foundation = normFoundation(r.foundation);
      const level = normLevel(r.level);
      if (!code || !name) continue;
      await pool.query(
        `INSERT INTO schools (code, name, category, foundation, level) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, category=EXCLUDED.category,
           foundation=EXCLUDED.foundation, level=EXCLUDED.level`,
        [code, name, category, foundation, level]
      );
      n++;
    }
    setFlash(req, "ok", `학교 ${n}개교가 등록/갱신되었습니다.`);
  } catch (err) {
    setFlash(req, "err", "업로드 오류: " + err.message);
  }
  res.redirect("/admin");
});

app.get("/admin/template/users", requireRole("super_admin"), (_req, res) => {
  sendXlsx(res, [{ username: "hong123", password: "", role: "school_user", name: "홍길동", school_code: "M001" }], "회원목록", "user_template.xlsx");
});
app.get("/admin/template/special", requireRole("super_admin"), (_req, res) => {
  sendXlsx(res, [{ code: "S001", name: "경북특수학교" }], "특정학교", "special_school_template.xlsx");
});
app.get("/admin/template/schools", requireRole("super_admin"), (_req, res) => {
  sendXlsx(res, [{ code: "M001", name: "경북중학교", category: "general", foundation: "공립", level: "중학교" }], "학교목록", "school_template.xlsx");
});

initDb()
  .catch((err) => console.error("[boot] initDb gave up:", err.message))
  .finally(() => {
    app.listen(PORT, "0.0.0.0", () => console.log(`[server] listening on :${PORT}`));
  });
