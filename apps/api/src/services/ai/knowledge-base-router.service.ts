import type { BusinessRole, KnowledgeBaseProfile } from "../../types";

export type KnowledgeBaseRouteMode = "explicit" | "rule" | "model" | "default" | "unresolved";

export type KnowledgeBaseRouteCandidate = Pick<
  KnowledgeBaseProfile,
  "id" | "name" | "description" | "routingKeywords"
>;

export type KnowledgeBaseRouteModelSelection = {
  knowledgeBaseId: string;
  confidence: number;
  reason: string;
};

export type KnowledgeBaseRouteDecision = {
  mode: KnowledgeBaseRouteMode;
  confidence: number;
  reason: string;
  primaryProfile?: KnowledgeBaseProfile;
  fallbackProfile?: KnowledgeBaseProfile;
  authorizedCandidateIds: string[];
};

export type KnowledgeBaseRouteInput = {
  query: string;
  businessRole: BusinessRole;
  profiles: KnowledgeBaseProfile[];
  modelSelect?: (input: {
    query: string;
    candidates: KnowledgeBaseRouteCandidate[];
  }) => Promise<KnowledgeBaseRouteModelSelection | null>;
};

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function canAccess(profile: KnowledgeBaseProfile, role: BusinessRole): boolean {
  return profile.enabled
    && (profile.allowedBusinessRoles.length === 0 || profile.allowedBusinessRoles.includes(role));
}

function byPriority(a: KnowledgeBaseProfile, b: KnowledgeBaseProfile): number {
  return a.priority - b.priority || a.id.localeCompare(b.id);
}

function fallbackFor(
  primary: KnowledgeBaseProfile,
  authorized: KnowledgeBaseProfile[],
  ranked: KnowledgeBaseProfile[] = [],
): KnowledgeBaseProfile | undefined {
  const defaultProfile = authorized.find((profile) => profile.id !== primary.id && profile.isDefault);
  if (defaultProfile) return defaultProfile;
  return ranked.find((profile) => profile.id !== primary.id)
    || authorized.find((profile) => profile.id !== primary.id);
}

function decision(
  mode: Exclude<KnowledgeBaseRouteMode, "unresolved">,
  confidence: number,
  reason: string,
  primaryProfile: KnowledgeBaseProfile,
  authorized: KnowledgeBaseProfile[],
  ranked: KnowledgeBaseProfile[] = [],
): KnowledgeBaseRouteDecision {
  return {
    mode,
    confidence,
    reason,
    primaryProfile,
    fallbackProfile: fallbackFor(primaryProfile, authorized, ranked),
    authorizedCandidateIds: authorized.map((profile) => profile.id),
  };
}

export async function routeKnowledgeBase(
  input: KnowledgeBaseRouteInput,
): Promise<KnowledgeBaseRouteDecision> {
  const query = normalizeText(input.query);
  const authorized = input.profiles.filter((profile) => canAccess(profile, input.businessRole)).sort(byPriority);
  if (!authorized.length) {
    return {
      mode: "unresolved",
      confidence: 0,
      reason: "no_accessible_knowledge_base",
      authorizedCandidateIds: [],
    };
  }

  const explicitProfile = authorized.find((profile) => {
    const name = normalizeText(profile.name);
    const id = normalizeText(profile.id);
    return (name.length >= 2 && query.includes(name)) || (id.length >= 3 && query.includes(id));
  });
  if (explicitProfile) {
    return decision(
      "explicit",
      1,
      `explicit_profile:${explicitProfile.id}`,
      explicitProfile,
      authorized,
    );
  }

  if (authorized.length === 1) {
    return decision(
      "default",
      1,
      "only_accessible_knowledge_base",
      authorized[0],
      authorized,
    );
  }

  const scored = authorized.map((profile) => {
    const keywordHits = profile.routingKeywords
      .map((keyword) => normalizeText(keyword))
      .filter((keyword) => keyword && query.includes(keyword));
    const nameHit = profile.name.length >= 2 && query.includes(normalizeText(profile.name)) ? 1 : 0;
    return {
      profile,
      keywordHits,
      score: keywordHits.length * 10 + nameHit * 5,
    };
  }).sort((a, b) => b.score - a.score || byPriority(a.profile, b.profile));

  if (scored[0]?.score > 0 && scored[0].score > (scored[1]?.score || 0)) {
    const winner = scored[0];
    return decision(
      "rule",
      Math.min(0.98, 0.78 + winner.keywordHits.length * 0.08),
      `keyword_match:${winner.keywordHits.join("|") || winner.profile.name}`,
      winner.profile,
      authorized,
      scored.map((item) => item.profile),
    );
  }

  if (input.modelSelect) {
    try {
      const selection = await input.modelSelect({
        query: input.query,
        candidates: authorized.map(({ id, name, description, routingKeywords }) => ({
          id,
          name,
          description,
          routingKeywords,
        })),
      });
      const selected = selection
        ? authorized.find((profile) => profile.id === selection.knowledgeBaseId)
        : undefined;
      const confidence = Number(selection?.confidence);
      if (selected && Number.isFinite(confidence) && confidence >= 0.65) {
        return decision(
          "model",
          Math.min(1, Math.max(0, confidence)),
          String(selection?.reason || "model_selected").trim().slice(0, 200),
          selected,
          authorized,
          scored.map((item) => item.profile),
        );
      }
    } catch {
      // 路由模型不可用时进入安全默认，不放大为整次请求失败。
    }
  }

  const defaultProfile = authorized.find((profile) => profile.isDefault);
  if (defaultProfile) {
    return decision(
      "default",
      0.5,
      "safe_default_after_ambiguous_route",
      defaultProfile,
      authorized,
      scored.map((item) => item.profile),
    );
  }

  return {
    mode: "unresolved",
    confidence: 0,
    reason: "route_ambiguous_without_default",
    authorizedCandidateIds: authorized.map((profile) => profile.id),
  };
}
