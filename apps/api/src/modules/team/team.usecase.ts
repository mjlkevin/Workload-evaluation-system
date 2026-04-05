import { randomUUID } from "node:crypto";

import { VersionRecord } from "../../types";
import { loadVersionsStore, saveVersionsStore } from "../versions/versions.repository";
import { appendTeamAuditLog, loadTeamStore, saveTeamStoreWithExpectedVersion } from "./team.repository";
import { ReviewStatus, TeamMember, TeamRecord, TeamRole, TeamStore } from "./team.types";

type CurrentUser = { id: string };

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isTeamRole(value: string): value is TeamRole {
  return value === "manager" || value === "implementer" || value === "presale" || value === "sales";
}

function ensureTeamMember(team: TeamRecord, userId: string): TeamMember | null {
  return team.members.find((x) => x.userId === userId) || null;
}

function ensureManager(team: TeamRecord, userId: string): boolean {
  const member = ensureTeamMember(team, userId);
  return !!member && member.role === "manager";
}

function ensureReviewStatus(value: string): ReviewStatus | "" {
  return value === "open" || value === "closed" ? value : "";
}

function fail(code: number, message: string, field: string, reason: string) {
  return { ok: false as const, error: { code, message, details: [{ field, reason }] } };
}

function ok<T>(data: T) {
  return { ok: true as const, data };
}

function persistWithVersionGuard(store: TeamStore, expectedVersion: number) {
  const saved = saveTeamStoreWithExpectedVersion(store, expectedVersion);
  if (!saved.ok) {
    return fail(40909, "数据版本冲突，请重试", "storeVersion", "conflict");
  }
  store.version = saved.savedVersion;
  return null;
}

export function createTeam(currentUser: CurrentUser, body: { name?: string }) {
  const name = asString(body.name);
  if (!name) return fail(42201, "参数错误", "name", "required");

  const store = loadTeamStore();
  const expectedVersion = store.version;
  const now = new Date().toISOString();
  const team: TeamRecord = {
    teamId: randomUUID(),
    name,
    ownerUserId: currentUser.id,
    members: [{ userId: currentUser.id, role: "manager", joinedAt: now }],
    createdAt: now,
    updatedAt: now
  };
  store.teams.push(team);
  appendTeamAuditLog(store, {
    teamId: team.teamId,
    actorUserId: currentUser.id,
    action: "team.create",
    targetType: "team",
    targetId: team.teamId
  });
  const conflict = persistWithVersionGuard(store, expectedVersion);
  if (conflict) return conflict;
  return ok(team);
}

export function getTeam(currentUser: CurrentUser, teamId: string) {
  const store = loadTeamStore();
  const team = store.teams.find((x) => x.teamId === teamId);
  if (!team) return fail(40401, "团队不存在", "teamId", "not_found");
  if (!ensureTeamMember(team, currentUser.id)) return fail(40301, "权限不足", "teamId", "not_team_member");
  return ok(team);
}

export function addTeamMember(currentUser: CurrentUser, teamId: string, body: { userId?: string; role?: string }) {
  const userId = asString(body.userId);
  const role = asString(body.role);
  if (!userId) return fail(42201, "参数错误", "userId", "required");
  if (!isTeamRole(role)) return fail(42201, "参数错误", "role", "invalid");

  const store = loadTeamStore();
  const expectedVersion = store.version;
  const team = store.teams.find((x) => x.teamId === teamId);
  if (!team) return fail(40401, "团队不存在", "teamId", "not_found");
  if (!ensureManager(team, currentUser.id)) return fail(40301, "权限不足", "role", "manager_required");

  const existed = team.members.find((x) => x.userId === userId);
  if (existed) existed.role = role;
  else team.members.push({ userId, role, joinedAt: new Date().toISOString() });
  team.updatedAt = new Date().toISOString();

  appendTeamAuditLog(store, {
    teamId: team.teamId,
    actorUserId: currentUser.id,
    action: "team.member.upsert",
    targetType: "user",
    targetId: userId
  });
  const conflict = persistWithVersionGuard(store, expectedVersion);
  if (conflict) return conflict;
  return ok(team);
}

export function updateTeamMemberRole(
  currentUser: CurrentUser,
  teamId: string,
  userId: string,
  body: { role?: string }
) {
  const role = asString(body.role);
  if (!isTeamRole(role)) return fail(42201, "参数错误", "role", "invalid");
  const store = loadTeamStore();
  const expectedVersion = store.version;
  const team = store.teams.find((x) => x.teamId === teamId);
  if (!team) return fail(40401, "团队不存在", "teamId", "not_found");
  if (!ensureManager(team, currentUser.id)) return fail(40301, "权限不足", "role", "manager_required");

  const member = team.members.find((x) => x.userId === userId);
  if (!member) return fail(40401, "成员不存在", "userId", "not_found");
  member.role = role;
  team.updatedAt = new Date().toISOString();
  appendTeamAuditLog(store, {
    teamId: team.teamId,
    actorUserId: currentUser.id,
    action: "team.member.role.update",
    targetType: "user",
    targetId: userId
  });
  const conflict = persistWithVersionGuard(store, expectedVersion);
  if (conflict) return conflict;
  return ok(team);
}

export function removeTeamMember(currentUser: CurrentUser, teamId: string, userId: string) {
  const store = loadTeamStore();
  const expectedVersion = store.version;
  const team = store.teams.find((x) => x.teamId === teamId);
  if (!team) return fail(40401, "团队不存在", "teamId", "not_found");
  if (!ensureManager(team, currentUser.id)) return fail(40301, "权限不足", "role", "manager_required");
  if (team.ownerUserId === userId) return fail(42201, "参数错误", "userId", "owner_cannot_remove");

  const before = team.members.length;
  team.members = team.members.filter((x) => x.userId !== userId);
  if (team.members.length === before) return fail(40401, "成员不存在", "userId", "not_found");
  team.updatedAt = new Date().toISOString();
  appendTeamAuditLog(store, {
    teamId: team.teamId,
    actorUserId: currentUser.id,
    action: "team.member.remove",
    targetType: "user",
    targetId: userId
  });
  const conflict = persistWithVersionGuard(store, expectedVersion);
  if (conflict) return conflict;
  return ok({ deleted: true });
}

function ensureGlobalPlanOwner(record: VersionRecord, currentUserId: string): boolean {
  return record.type === "global" && record.ownerUserId === currentUserId;
}

export function getTeamPlans(currentUser: CurrentUser, teamId: string) {
  const teamStore = loadTeamStore();
  const team = teamStore.teams.find((x) => x.teamId === teamId);
  if (!team) return fail(40401, "团队不存在", "teamId", "not_found");
  if (!ensureTeamMember(team, currentUser.id)) return fail(40301, "权限不足", "teamId", "not_team_member");

  const versionStore = loadVersionsStore();
  const items = versionStore.records
    .filter((x) => x.type === "global")
    .filter((x) => {
      const bind = teamStore.planBindings.find((b) => b.globalVersionCode === x.versionCode);
      if (bind) return bind.teamId === teamId;
      return ensureGlobalPlanOwner(x, currentUser.id);
    })
    .map((x) => {
      const review = teamStore.reviews
        .filter((r) => r.teamId === teamId && r.globalVersionCode === x.versionCode)
        .sort((a, b) => Number(new Date(b.updatedAt)) - Number(new Date(a.updatedAt)))[0];
      return {
        globalVersionCode: x.versionCode,
        projectName: asString(x.payload?.projectName) || asString(x.payload?.name) || "",
        status: x.status,
        ownerUserId: x.ownerUserId,
        updatedAt: x.updatedAt,
        reviewStatus: review ? review.status : "none"
      };
    });

  return ok({ items });
}

export function updateTeamPlanBinding(
  currentUser: CurrentUser,
  teamId: string,
  globalVersionCode: string,
  body: { targetTeamId?: string }
) {
  const targetTeamId = asString(body.targetTeamId);
  if (!targetTeamId) return fail(42201, "参数错误", "targetTeamId", "required");

  const store = loadTeamStore();
  const expectedVersion = store.version;
  const team = store.teams.find((x) => x.teamId === teamId);
  const targetTeam = store.teams.find((x) => x.teamId === targetTeamId);
  if (!team || !targetTeam) return fail(40401, "团队不存在", "teamId", "not_found");
  if (!ensureManager(team, currentUser.id)) return fail(40301, "权限不足", "role", "manager_required");

  const versions = loadVersionsStore();
  const global = versions.records.find((x) => x.type === "global" && x.versionCode === globalVersionCode);
  if (!global) return fail(40401, "总方案不存在", "globalVersionCode", "not_found");

  const existed = store.planBindings.find((x) => x.globalVersionCode === globalVersionCode);
  if (existed) {
    existed.teamId = targetTeamId;
    existed.updatedAt = new Date().toISOString();
    existed.updatedBy = currentUser.id;
  } else {
    store.planBindings.push({
      globalVersionCode,
      teamId: targetTeamId,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser.id
    });
  }
  appendTeamAuditLog(store, {
    teamId,
    actorUserId: currentUser.id,
    action: "team.plan.binding.update",
    targetType: "global_plan",
    targetId: globalVersionCode
  });
  const conflict = persistWithVersionGuard(store, expectedVersion);
  if (conflict) return conflict;
  saveVersionsStore(versions);
  return ok({ updated: true });
}

export function createReview(
  currentUser: CurrentUser,
  teamId: string,
  body: { globalVersionCode?: string; title?: string }
) {
  const globalVersionCode = asString(body.globalVersionCode);
  if (!globalVersionCode) return fail(42201, "参数错误", "globalVersionCode", "required");
  const title = asString(body.title) || `Review for ${globalVersionCode}`;

  const store = loadTeamStore();
  const expectedVersion = store.version;
  const team = store.teams.find((x) => x.teamId === teamId);
  if (!team) return fail(40401, "团队不存在", "teamId", "not_found");
  if (!ensureTeamMember(team, currentUser.id)) return fail(40301, "权限不足", "teamId", "not_team_member");

  const review = {
    reviewId: randomUUID(),
    teamId,
    globalVersionCode,
    title,
    status: "open" as ReviewStatus,
    createdBy: currentUser.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  store.reviews.push(review);
  appendTeamAuditLog(store, {
    teamId,
    actorUserId: currentUser.id,
    action: "review.create",
    targetType: "review",
    targetId: review.reviewId
  });
  const conflict = persistWithVersionGuard(store, expectedVersion);
  if (conflict) return conflict;
  return ok(review);
}

export function listReviews(currentUser: CurrentUser, teamId: string) {
  const store = loadTeamStore();
  const team = store.teams.find((x) => x.teamId === teamId);
  if (!team) return fail(40401, "团队不存在", "teamId", "not_found");
  if (!ensureTeamMember(team, currentUser.id)) return fail(40301, "权限不足", "teamId", "not_team_member");

  const items = store.reviews
    .filter((x) => x.teamId === teamId)
    .sort((a, b) => Number(new Date(b.updatedAt)) - Number(new Date(a.updatedAt)));

  return ok({ items });
}

export function updateReviewStatus(
  currentUser: CurrentUser,
  teamId: string,
  reviewId: string,
  body: { status?: string }
) {
  const status = ensureReviewStatus(asString(body.status));
  if (!status) return fail(42201, "参数错误", "status", "invalid");

  const store = loadTeamStore();
  const expectedVersion = store.version;
  const team = store.teams.find((x) => x.teamId === teamId);
  if (!team) return fail(40401, "团队不存在", "teamId", "not_found");
  if (!ensureManager(team, currentUser.id)) return fail(40301, "权限不足", "role", "manager_required");

  const review = store.reviews.find((x) => x.reviewId === reviewId && x.teamId === teamId);
  if (!review) return fail(40401, "评审不存在", "reviewId", "not_found");
  review.status = status;
  review.updatedAt = new Date().toISOString();
  appendTeamAuditLog(store, {
    teamId,
    actorUserId: currentUser.id,
    action: "review.status.update",
    targetType: "review",
    targetId: reviewId
  });
  const conflict = persistWithVersionGuard(store, expectedVersion);
  if (conflict) return conflict;
  return ok(review);
}

export function listReviewComments(currentUser: CurrentUser, teamId: string, reviewId: string) {
  const store = loadTeamStore();
  const expectedVersion = store.version;
  const team = store.teams.find((x) => x.teamId === teamId);
  if (!team) return fail(40401, "团队不存在", "teamId", "not_found");
  if (!ensureTeamMember(team, currentUser.id)) return fail(40301, "权限不足", "teamId", "not_team_member");

  const review = store.reviews.find((x) => x.reviewId === reviewId && x.teamId === teamId);
  if (!review) return fail(40401, "评审不存在", "reviewId", "not_found");

  const items = store.comments
    .filter((x) => x.reviewId === reviewId)
    .sort((a, b) => Number(new Date(a.createdAt)) - Number(new Date(b.createdAt)));
  return ok({ items });
}

export function createReviewComment(
  currentUser: CurrentUser,
  teamId: string,
  reviewId: string,
  body: { content?: string }
) {
  const content = asString(body.content);
  if (!content) return fail(42201, "参数错误", "content", "required");

  const store = loadTeamStore();
  const expectedVersion = store.version;
  const team = store.teams.find((x) => x.teamId === teamId);
  if (!team) return fail(40401, "团队不存在", "teamId", "not_found");
  if (!ensureTeamMember(team, currentUser.id)) return fail(40301, "权限不足", "teamId", "not_team_member");

  const review = store.reviews.find((x) => x.reviewId === reviewId && x.teamId === teamId);
  if (!review) return fail(40401, "评审不存在", "reviewId", "not_found");

  const comment = {
    commentId: randomUUID(),
    reviewId,
    authorUserId: currentUser.id,
    content,
    createdAt: new Date().toISOString()
  };
  store.comments.push(comment);
  appendTeamAuditLog(store, {
    teamId,
    actorUserId: currentUser.id,
    action: "review.comment.create",
    targetType: "review",
    targetId: reviewId
  });
  const conflict = persistWithVersionGuard(store, expectedVersion);
  if (conflict) return conflict;
  return ok(comment);
}
