CREATE FUNCTION wes_reject_workflow_history_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'WORKFLOW_HISTORY_IMMUTABLE' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE FUNCTION wes_guard_workflow_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'published' OR EXISTS (SELECT 1 FROM workflow_definitions w WHERE w.workflow_id = OLD.workflow_id AND w.current_version_id <> OLD.workflow_version_id) THEN
    RAISE EXCEPTION 'WORKFLOW_HISTORY_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.status = 'published' AND (NEW.checkout_status <> 'checked_in' OR NEW.validation IS NULL OR NEW.review IS NULL OR NEW.dependency_snapshot IS NULL
    OR NEW.validation->>'hash' IS DISTINCT FROM NEW.hash OR NEW.review->>'hash' IS DISTINCT FROM NEW.hash
    OR NEW.validation->>'versionId' IS DISTINCT FROM NEW.workflow_version_id OR NEW.review->>'versionId' IS DISTINCT FROM NEW.workflow_version_id
    OR NEW.review->>'validationId' IS DISTINCT FROM NEW.validation->>'id'
    OR NEW.validation->>'dependencyHash' IS DISTINCT FROM NEW.review->>'dependencyHash') THEN
    RAISE EXCEPTION 'WORKFLOW_RELEASE_GATE_PENDING' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER workflow_version_immutable BEFORE UPDATE OR DELETE ON workflow_versions FOR EACH ROW EXECUTE FUNCTION wes_guard_workflow_version();
--> statement-breakpoint
CREATE TRIGGER workflow_revision_append_only BEFORE UPDATE OR DELETE ON workflow_revisions FOR EACH ROW EXECUTE FUNCTION wes_reject_workflow_history_change();
--> statement-breakpoint
CREATE FUNCTION wes_guard_workflow_dependency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_id text; version_status text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_id := OLD.version_id;
    IF EXISTS (SELECT 1 FROM workflow_versions v JOIN workflow_definitions w ON w.workflow_id = v.workflow_id WHERE v.workflow_version_id = old_id AND (v.status = 'published' OR w.current_version_id <> old_id)) THEN
      RAISE EXCEPTION 'WORKFLOW_HISTORY_IMMUTABLE' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF EXISTS (SELECT 1 FROM workflow_versions v JOIN workflow_definitions w ON w.workflow_id = v.workflow_id WHERE v.workflow_version_id = NEW.version_id AND (v.status = 'published' OR w.current_version_id <> NEW.version_id)) THEN
    RAISE EXCEPTION 'WORKFLOW_HISTORY_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM skill_versions s WHERE s.skill_version_id = NEW.skill_version_id AND s.skill_id = NEW.skill_id AND s.status = 'published') THEN
    RAISE EXCEPTION 'WORKFLOW_EXACT_PUBLISHED_SKILL_REQUIRED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER workflow_dependency_guard BEFORE INSERT OR UPDATE OR DELETE ON workflow_skill_dependencies FOR EACH ROW EXECUTE FUNCTION wes_guard_workflow_dependency();
