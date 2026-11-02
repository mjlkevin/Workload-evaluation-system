-- Published content and persisted audit snapshots remain immutable even for direct SQL writers.
CREATE FUNCTION wes_reject_skill_history_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'SKILL_HISTORY_IMMUTABLE' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER skill_published_version_immutable
BEFORE UPDATE OR DELETE ON skill_versions
FOR EACH ROW WHEN (OLD.status = 'published')
EXECUTE FUNCTION wes_reject_skill_history_change();
--> statement-breakpoint
CREATE TRIGGER skill_revision_append_only
BEFORE UPDATE OR DELETE ON skill_revisions
FOR EACH ROW EXECUTE FUNCTION wes_reject_skill_history_change();
