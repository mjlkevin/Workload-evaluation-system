-- Release evidence is append-only and intentionally lives outside aggregate snapshots.
CREATE TRIGGER skill_evaluation_append_only
BEFORE UPDATE OR DELETE ON skill_evaluations
FOR EACH ROW EXECUTE FUNCTION wes_reject_skill_history_change();
--> statement-breakpoint
CREATE TRIGGER skill_release_review_append_only
BEFORE UPDATE OR DELETE ON skill_release_reviews
FOR EACH ROW EXECUTE FUNCTION wes_reject_skill_history_change();
--> statement-breakpoint
CREATE TRIGGER skill_release_event_append_only
BEFORE UPDATE OR DELETE ON skill_release_events
FOR EACH ROW EXECUTE FUNCTION wes_reject_skill_history_change();
