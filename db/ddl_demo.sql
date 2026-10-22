-- =====================================================================
-- FaceTrackDB: ALTER and DROP demonstration (Phase 2)
-- Works on a scratch table, so the real schema is never touched.
-- Run any time after schema.sql:
--   Get-Content db\ddl_demo.sql | docker compose exec -T postgres psql -U facetrack -d facetrackdb
-- =====================================================================

-- CREATE a scratch table
CREATE TABLE ddl_demo (
    id    SERIAL PRIMARY KEY,
    note  TEXT
);

-- ALTER: add a column with a default
ALTER TABLE ddl_demo ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT now();

-- ALTER: add a CHECK constraint
ALTER TABLE ddl_demo ADD CONSTRAINT ddl_demo_note_len CHECK (char_length(note) <= 200);

-- ALTER: change a column rule
ALTER TABLE ddl_demo ALTER COLUMN note SET NOT NULL;

-- ALTER: rename a column
ALTER TABLE ddl_demo RENAME COLUMN note TO remark;

-- ALTER: change a column type
ALTER TABLE ddl_demo ALTER COLUMN remark TYPE VARCHAR(200);

-- Show the result
\d ddl_demo

-- DROP: remove a constraint, an index, a column, then the whole table
ALTER TABLE ddl_demo DROP CONSTRAINT ddl_demo_note_len;
CREATE INDEX idx_ddl_demo_created ON ddl_demo (created_at);
DROP INDEX idx_ddl_demo_created;
ALTER TABLE ddl_demo DROP COLUMN created_at;
DROP TABLE ddl_demo;
