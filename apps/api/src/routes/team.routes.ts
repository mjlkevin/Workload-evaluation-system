import { Router } from "express";
import * as TeamModule from "../modules/team/team.module";

const router = Router();

router.post("/", TeamModule.postTeam);
router.get("/:teamId", TeamModule.getTeamDetail);
router.post("/:teamId/members", TeamModule.postTeamMember);
router.patch("/:teamId/members/:userId", TeamModule.patchTeamMemberRole);
router.delete("/:teamId/members/:userId", TeamModule.deleteTeamMember);
router.get("/:teamId/plans", TeamModule.getPlans);
router.patch("/:teamId/plans/:globalVersionCode/binding", TeamModule.patchPlanBinding);
router.post("/:teamId/reviews", TeamModule.postReview);
router.get("/:teamId/reviews", TeamModule.getReviews);
router.patch("/:teamId/reviews/:reviewId/status", TeamModule.patchReviewStatus);
router.get("/:teamId/reviews/:reviewId/comments", TeamModule.getReviewComments);
router.post("/:teamId/reviews/:reviewId/comments", TeamModule.postReviewComment);

export default router;
