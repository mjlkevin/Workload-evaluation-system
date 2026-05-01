<template>
  <div class="pm-workbench-page">
    <el-card class="welcome-card">
      <h2>👋 PM 工作台</h2>
      <p class="hint">请选择以下功能模块</p>
    </el-card>

    <el-row :gutter="20" class="cards-row">
      <el-col :xs="24" :sm="12" :md="12" class="card-col">
        <el-card class="feature-card" shadow="hover" @click="$router.push('/pm/handoff')">
          <div class="feature-icon">🔄</div>
          <h3>接力视图</h3>
          <p class="feature-desc">IMPL → PM → PMO 的评估接力与交接</p>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="12" class="card-col">
        <el-card class="feature-card" shadow="hover" @click="$router.push('/pm/narrative')">
          <div class="feature-icon">📝</div>
          <h3>五段式叙事</h3>
          <p class="feature-desc">组织与模块 / 数据治理 / 特殊场景 / 验收范围 / 时间与成本</p>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="12" class="card-col">
        <el-card class="feature-card" shadow="hover" @click="$router.push('/pm/deliverables')">
          <div class="feature-icon">📦</div>
          <h3>四大交付物</h3>
          <p class="feature-desc">工作量表 / 资源成本 / 偏差分析 / WBS 拆分</p>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="12" class="card-col">
        <el-card class="feature-card" shadow="hover" @click="$router.push('/pm/review')">
          <div class="feature-icon">✅</div>
          <h3>质量门审</h3>
          <p class="feature-desc">PMO 质量门检查清单与审阅结论</p>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.pm-workbench-page {
  max-width: 1200px;
  margin: 0 auto;
}
.welcome-card {
  margin-bottom: 20px;
}
.welcome-card h2 {
  margin: 0 0 8px;
  font-size: 22px;
}
.hint {
  margin: 0;
  font-size: 14px;
  color: #909399;
}
.cards-row {
  margin-top: 8px;
}
.card-col {
  margin-bottom: 20px;
}
.feature-card {
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  text-align: center;
  height: 100%;
}
.feature-card:hover {
  transform: translateY(-4px);
}
.feature-icon {
  font-size: 40px;
  margin-bottom: 12px;
}
.feature-card h3 {
  margin: 0 0 8px;
  font-size: 18px;
  color: #303133;
}
.feature-desc {
  margin: 0;
  font-size: 13px;
  color: #606266;
  min-height: 36px;
}
</style>
