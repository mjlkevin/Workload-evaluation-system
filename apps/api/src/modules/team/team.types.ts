export type TeamRole = "manager" | "implementer" | "presale" | "sales";
export type ReviewStatus = "open" | "closed";

export type TeamMember = {
  userId: string;
  role: TeamRole;
  joinedAt: string;
};

export type TeamRecord = {
  teamId: string;
  name: string;
  ownerUserId: string;
  members: TeamMember[];
  createdAt: string;
  updatedAt: string;
};

export type TeamReview = {
  reviewId: string;
  teamId: string;
  globalVersionCode: string;
  title: string;
  status: ReviewStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type TeamReviewComment = {
  commentId: string;
  reviewId: string;
  authorUserId: string;
  content: string;
  createdAt: string;
};

export type TeamAuditLog = {
  auditId: string;
  teamId: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  at: string;
};

export type TeamPlanBinding = {
  globalVersionCode: string;
  teamId: string;
  updatedAt: string;
  updatedBy: string;
};

export type TeamStore = {
  version: number;
  teams: TeamRecord[];
  reviews: TeamReview[];
  comments: TeamReviewComment[];
  planBindings: TeamPlanBinding[];
  auditLogs: TeamAuditLog[];
};
