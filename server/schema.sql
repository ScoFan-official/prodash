-- Prodash v1.0.0 schema (MySQL 8, utf8mb4)
-- Applied automatically on first boot of docker-compose mysql container
-- via /docker-entrypoint-initdb.d/01-schema.sql.

CREATE DATABASE IF NOT EXISTS prodash CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE prodash;

CREATE TABLE IF NOT EXISTS tasks (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  important TINYINT(1) NOT NULL DEFAULT 0,
  urgent TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('active', 'completed', 'deleted') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  deleted_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_tasks_status_created (status, created_at),
  INDEX idx_tasks_status_completed (status, completed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS time_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  task_id BIGINT NOT NULL,
  track ENUM('human', 'agent') NOT NULL,
  event ENUM('start', 'pause', 'resume', 'stop') NOT NULL,
  ts DATETIME(3) NOT NULL,
  duration_ms BIGINT NOT NULL DEFAULT 0 COMMENT '仅信息性：段长由事件 ts 重构计算，不以本列聚合',
  INDEX idx_time_events_task_track_ts (task_id, track, ts),
  INDEX idx_time_events_ts (ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reports (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  report_date DATE NOT NULL,
  content TEXT NULL,
  status ENUM('draft', 'published', 'publish_failed') NOT NULL DEFAULT 'draft',
  doc_url VARCHAR(1000) NULL,
  doc_node_id VARCHAR(255) NULL,
  include_deleted TINYINT(1) NOT NULL DEFAULT 0,
  version INT NOT NULL DEFAULT 0,
  published_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_reports_report_date (report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS report_extra (
  report_date DATE PRIMARY KEY,
  temporary_work TEXT NULL,
  meetings TEXT NULL,
  risks TEXT NULL,
  tomorrow_plan TEXT NULL,
  updated_at DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
