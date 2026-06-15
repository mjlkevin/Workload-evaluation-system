export interface PlanRecord {
  id: string;
  projectCode?: string;
  customer?: string;
  product?: string;
  keywords?: string[];
}

export interface MatchQuery {
  projectCode?: string;
  customer?: string;
  product?: string;
  keywords?: string[];
}

export interface MatchResult {
  matched: boolean;
  /** 候选按相关度降序；精准命中只含一条 */
  candidates: PlanRecord[];
}

/** 纯函数：编码精准优先，否则客户名+产品+关键词模糊打分 */
export function matchExistingPlans(plans: PlanRecord[], query: MatchQuery): MatchResult {
  if (query.projectCode) {
    const exact = plans.filter((plan) => plan.projectCode && plan.projectCode === query.projectCode);
    if (exact.length > 0) return { matched: true, candidates: exact };
  }

  const scored = plans
    .map((plan) => ({ plan, score: fuzzyScore(plan, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { matched: false, candidates: [] };
  return { matched: true, candidates: scored.map((item) => item.plan) };
}

function fuzzyScore(plan: PlanRecord, query: MatchQuery): number {
  let score = 0;
  if (query.customer && plan.customer && plan.customer.includes(query.customer)) score += 2;
  if (query.product && plan.product && plan.product.includes(query.product)) score += 2;
  if (query.keywords && plan.keywords) {
    for (const keyword of query.keywords) {
      if (plan.keywords.includes(keyword)) score += 1;
    }
  }
  return score;
}
