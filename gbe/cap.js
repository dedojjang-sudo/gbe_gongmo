"use strict";

const { GENERAL_CAP, SPECIAL_CAP } = require("./schema");

function capFor(category) {
  return category === "special" ? SPECIAL_CAP : GENERAL_CAP;
}

// 상한 산정 기준: 신청(applied) + 선정(selected) 합산, 상한제 제외 사업은 미포함.
async function countActive(db, schoolId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS c
       FROM applications a
       JOIN projects p ON p.id = a.project_id
      WHERE a.school_id = $1
        AND a.status IN ('applied','selected')
        AND p.exempt = false`,
    [schoolId]
  );
  return rows[0].c;
}

async function quotaFor(db, school) {
  const used = await countActive(db, school.id);
  const cap = capFor(school.category);
  return { used, cap, remaining: cap - used, full: used >= cap };
}

async function canApply(db, school, project) {
  if (project.exempt) {
    return { ok: true, reason: "상한제 제외 사업", used: null, cap: null };
  }
  const q = await quotaFor(db, school);
  if (q.full) {
    return {
      ok: false,
      reason: `상한 초과 (${school.category === "special" ? "특정" : "일반"}학교 상한 ${q.cap}개, 현재 신청·선정 ${q.used}개)`,
      used: q.used,
      cap: q.cap,
    };
  }
  return { ok: true, reason: null, used: q.used, cap: q.cap };
}

function levelAllowed(project, school) {
  const targets = project.target_levels || [];
  if (targets.length === 0) return true;
  return targets.includes(school.level);
}

module.exports = { capFor, countActive, quotaFor, canApply, levelAllowed };
