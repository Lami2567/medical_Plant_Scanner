-- MedPlant Scanner - Database Schema
-- Run this file against your PostgreSQL database before starting the server.

CREATE TABLE IF NOT EXISTS plants (
  id           SERIAL PRIMARY KEY,
  plant_name   TEXT UNIQUE NOT NULL,
  scientific_name TEXT,
  data         JSONB NOT NULL,
  created_at   TIMESTAMP DEFAULT NOW()
);

-- Index for fast name lookups
CREATE INDEX IF NOT EXISTS idx_plants_plant_name ON plants (plant_name);
