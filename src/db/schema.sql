-- MedPlant Scanner - Database Schema
-- Run this file against your PostgreSQL database before starting the server.

CREATE TABLE IF NOT EXISTS plant_data (
  plant_id     SERIAL PRIMARY KEY,
  plant_name   TEXT UNIQUE NOT NULL,
  scientific_name TEXT,
  cleaned_data JSONB NOT NULL,
  raw_data     JSONB,
  created_at   TIMESTAMP DEFAULT NOW()
);

-- Index for fast name lookups
CREATE INDEX IF NOT EXISTS idx_plant_data_plant_name ON plant_data (plant_name);

CREATE TABLE IF NOT EXISTS users (
  uid          TEXT PRIMARY KEY,
  email        TEXT,
  name         TEXT,
  created_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scans (
  scan_id      SERIAL PRIMARY KEY,
  user_id      TEXT REFERENCES users(uid) ON DELETE CASCADE,
  plant_name   TEXT REFERENCES plant_data(plant_name) ON DELETE CASCADE,
  image_hash   TEXT NOT NULL,
  image_url    TEXT,
  created_at   TIMESTAMP DEFAULT NOW()
);

-- Index for quickly looking up deduplicated images
CREATE INDEX IF NOT EXISTS idx_scans_image_hash ON scans (image_hash);
