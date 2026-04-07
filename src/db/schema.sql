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
