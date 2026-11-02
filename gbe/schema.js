"use strict";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id          BIGSERIAL PRIMARY KEY,
  username    TEXT UNIQUE NOT NULL,
  password    TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('super_admin','project_manager','school_user')),
  name        TEXT NOT NULL,
  school_id   BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS schools (
  id            BIGSERIAL PRIMARY KEY,
  code          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'general' CHECK (category IN ('general','special')),
  foundation    TEXT NOT NULL DEFAULT 'public' CHECK (foundation IN ('public','private')),
  level         TEXT NOT NULL DEFAULT 'etc' CHECK (level IN ('kinder','elementary','middle','high','special','etc')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id             BIGSERIAL PRIMARY KEY,
  title          TEXT NOT NULL,
  description    TEXT,
  department     TEXT,
  exempt         BOOLEAN NOT NULL DEFAULT false,
  exempt_reason  TEXT,
  max_schools    INTEGER,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','decided')),
  apply_start    DATE,
  apply_end      DATE,
  project_start  DATE,
  project_end    DATE,
  target_levels  TEXT[] NOT NULL DEFAULT '{}',
  created_by     BIGINT REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_files (
  id           BIGSERIAL PRIMARY KEY,
  project_id   BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  mime_type    TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes   BIGINT NOT NULL DEFAULT 0,
  data         BYTEA NOT NULL,
  uploaded_by  BIGINT REFERENCES users(id),
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS applications (
  id          BIGSERIAL PRIMARY KEY,
  project_id  BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  school_id   BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','selected','rejected')),
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at  TIMESTAMPTZ,
  UNIQUE (project_id, school_id)
);

CREATE INDEX IF NOT EXISTS idx_applications_school ON applications(school_id);
CREATE INDEX IF NOT EXISTS idx_applications_project ON applications(project_id);
CREATE INDEX IF NOT EXISTS idx_users_school ON users(school_id);
CREATE INDEX IF NOT EXISTS idx_project_files_project ON project_files(project_id);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_start DATE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_end DATE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS target_levels TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS max_schools INTEGER;

ALTER TABLE schools ADD COLUMN IF NOT EXISTS foundation TEXT NOT NULL DEFAULT 'public';
ALTER TABLE schools ADD COLUMN IF NOT EXISTS level TEXT NOT NULL DEFAULT 'etc';
`;

const GENERAL_CAP = 5;
const SPECIAL_CAP = 2;

const EXEMPT_REASONS = [
  "단위 모집 (학급/학년·동아리/팀 단위)",
  "시설 (특별실 현대화·시설 공사)",
  "대상 특화 (유치원·특수학교)",
  "추가 공모 (응모 미달 추가 공모)",
];

const FOUNDATION_LABEL = { public: "공립", private: "사립" };
const LEVEL_LABEL = {
  kinder: "유치원", elementary: "초등학교", middle: "중학교",
  high: "고등학교", special: "특수학교", etc: "기타",
};
const TARGET_LEVEL_OPTIONS = ["kinder", "elementary", "middle", "high", "special"];

module.exports = { SCHEMA_SQL, GENERAL_CAP, SPECIAL_CAP, EXEMPT_REASONS, FOUNDATION_LABEL, LEVEL_LABEL, TARGET_LEVEL_OPTIONS };
