import { Router } from "express";
import * as TeamModule from "../modules/team/team.module";
import { requireCapability, requireAnyCapability } from "../rbac/middleware";

const router = Router();

router.post("/", requireCapability("system:manage"), TeamModule.postTeam);
router.get("/:teamId", requireCapability("estimates:read"), TeamModule.getTeamDetail);
router.post("/:teamId/members", requireCapability("system:manage"), TeamModule.postTeamMember);
router.patch("/:teamId/members/:userId", requireCapability("system:manage"), TeamModule.patchTeamMemberRole);
router.delete("/:teamId/members/:userId", requireCapability("system:manage"), TeamModule.deleteTeamMember);
router.get("/:teamId/plans", requireCapability("estimates:read"), TeamModule.getPlans);
router.patch("/:teamId/plans/:globalVersionCode/binding", requireCapability("estimates:write"), TeamModule.patchPlanBinding);
router.post("/:teamId/reviews", requireAnyCapability("deliverable:review", "deliverable:reject"), TeamModule.postReview);
router.get("/:teamId/reviews", requireAnyCapability("deliverable:review", "deliverable:reject"), TeamModule.getReviews);
router.patch("/:teamId/reviews/:reviewId/status", requireAnyCapability("deliverable:review", "deliverable:reject"), TeamModule.patchReviewStatus);
router.get("/:teamId/reviews/:reviewId/comments", requireAnyCapability("deliverable:review", "deliverable:reject"), TeamModule.getReviewComments);
router.post("/:teamId/reviews/:reviewId/comments", requireAnyCapability("deliverable:review", "deliverable:reject"), TeamModule.postReviewComment);

export default router;
