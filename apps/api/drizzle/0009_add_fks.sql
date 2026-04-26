-- ============================================================
-- Migration 0008: Add FK constraints for soft references
-- ============================================================
-- P1-1 技术债清理：为软引用添加 FK 约束（ON DELETE CASCADE/SET NULL）
-- 
-- 涉及的表：
--   - sow_documents.requirement_pack_id → requirement_packs(requirement_pack_id) ON DELETE CASCADE
--   - initial_estimates.requirement_pack_id → requirement_packs(requirement_pack_id) ON DELETE CASCADE
--   - requirement_packs.source_extraction_id → extractions(extraction_id) ON DELETE SET NULL
-- ============================================================

-- sow_documents → requirement_packs
ALTER TABLE sow_documents
  ADD CONSTRAINT fk_sow_documents_requirement_pack
  FOREIGN KEY (requirement_pack_id)
  REFERENCES requirement_packs(requirement_pack_id)
  ON DELETE CASCADE;

-- initial_estimates → requirement_packs
ALTER TABLE initial_estimates
  ADD CONSTRAINT fk_initial_estimates_requirement_pack
  FOREIGN KEY (requirement_pack_id)
  REFERENCES requirement_packs(requirement_pack_id)
  ON DELETE CASCADE;

-- requirement_packs → extractions (如果 extractions 表存在)
-- 注意：extractions 表可能在测试环境中不存在，所以这条语句可能失败
-- 在实际环境中应该先检查表是否存在
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'extractions') THEN
    ALTER TABLE requirement_packs
      ADD CONSTRAINT fk_requirement_packs_source_extraction
      FOREIGN KEY (source_extraction_id)
      REFERENCES extractions(extraction_id)
      ON DELETE SET NULL;
  END IF;
END $$;
