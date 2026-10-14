-- ═══════════════════════════════════════════════════════════════════════════
-- NOTES / CASE DIGEST SAFETY NET  (run once in Supabase → SQL Editor)
--
-- Why: the app can't stop an OLD copy of the app (e.g. an iPad PWA that hasn't updated yet)
-- from overwriting a row with blanks. This protects the data on the SERVER, whatever device
-- or app version writes, and records exactly WHEN a note/digest got replaced.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) History table: every replaced version is kept here (nothing is ever really lost)
CREATE TABLE IF NOT EXISTS pdf_notes_history (
  id          BIGSERIAL PRIMARY KEY,
  pdf_id      TEXT NOT NULL,
  content     TEXT,
  digest      TEXT,
  replaced_at TIMESTAMPTZ DEFAULT now(),
  reason      TEXT
);
ALTER TABLE pdf_notes_history DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS pdf_notes_history_pdf_idx ON pdf_notes_history (pdf_id, replaced_at DESC);

-- 2) Trigger: before any UPDATE of pdf_notes, archive the old row when
--      • a non-empty notes/digest is being BLANKED  (always archived, reason = 'blanked'), or
--      • it changed and no archive exists for this PDF in the last 5 minutes (periodic version history).
CREATE OR REPLACE FUNCTION pdf_notes_keep_history() RETURNS trigger AS $$
DECLARE
  blanking BOOLEAN;
  changed  BOOLEAN;
BEGIN
  blanking := (COALESCE(OLD.content,'') <> '' AND COALESCE(NEW.content,'') = '')
           OR (COALESCE(OLD.digest ,'') <> '' AND COALESCE(NEW.digest ,'') = '');
  changed  := (OLD.content IS DISTINCT FROM NEW.content) OR (OLD.digest IS DISTINCT FROM NEW.digest);

  IF changed AND (COALESCE(OLD.content,'') <> '' OR COALESCE(OLD.digest,'') <> '') THEN
    IF blanking OR NOT EXISTS (
         SELECT 1 FROM pdf_notes_history h
         WHERE h.pdf_id = OLD.pdf_id AND h.replaced_at > now() - interval '5 minutes') THEN
      INSERT INTO pdf_notes_history (pdf_id, content, digest, reason)
      VALUES (OLD.pdf_id, OLD.content, OLD.digest, CASE WHEN blanking THEN 'blanked' ELSE 'periodic' END);
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pdf_notes_history ON pdf_notes;
CREATE TRIGGER trg_pdf_notes_history
  BEFORE UPDATE ON pdf_notes
  FOR EACH ROW EXECUTE FUNCTION pdf_notes_keep_history();

-- ───────────────────────────────────────────────────────────────────────────
-- 3) OPTIONAL HARD GUARD — refuse to blank a non-empty digest/notes from ANY client.
--    Recommended while old app copies may still be installed on other devices.
--    Trade-off: you can no longer clear a digest to completely empty from the app
--    (it silently keeps the old text). Delete the 4 lines below inside the function if undesired.
--    To enable: uncomment this whole block and run it.
-- ───────────────────────────────────────────────────────────────────────────
-- CREATE OR REPLACE FUNCTION pdf_notes_block_blanking() RETURNS trigger AS $$
-- BEGIN
--   IF COALESCE(OLD.digest ,'') <> '' AND COALESCE(NEW.digest ,'') = '' THEN NEW.digest  := OLD.digest;  END IF;
--   IF COALESCE(OLD.content,'') <> '' AND COALESCE(NEW.content,'') = '' THEN NEW.content := OLD.content; END IF;
--   RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;
-- -- Named so it runs BEFORE the history trigger (alphabetical order): the history trigger then sees no blanking.
-- DROP TRIGGER IF EXISTS trg_a_pdf_notes_block_blanking ON pdf_notes;
-- CREATE TRIGGER trg_a_pdf_notes_block_blanking
--   BEFORE UPDATE ON pdf_notes
--   FOR EACH ROW EXECUTE FUNCTION pdf_notes_block_blanking();

-- ───────────────────────────────────────────────────────────────────────────
-- HOW TO USE
--   Who blanked something, and when:
--     SELECT h.pdf_id, f.name, h.replaced_at, h.reason, length(h.content) AS notes_len, length(h.digest) AS digest_len
--     FROM pdf_notes_history h LEFT JOIN pdf_files f ON f.id = h.pdf_id
--     WHERE h.reason = 'blanked' ORDER BY h.replaced_at DESC;
--
--   Restore a digest from history (replace the id / timestamp):
--     UPDATE pdf_notes n SET digest = h.digest
--     FROM pdf_notes_history h
--     WHERE n.pdf_id = h.pdf_id AND h.id = 123;
-- ───────────────────────────────────────────────────────────────────────────
