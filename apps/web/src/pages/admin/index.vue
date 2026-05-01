<template>
  <div class="admin-page">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>系统管理</span>
        </div>
      </template>
      <p>Admin 工作台占位页。</p>
      <p>后续可在此扩展：用户列表、邀请码管理、系统配置等。</p>
    </el-card>
  </div>
</template>

<style scoped>
.admin-page {
  max-width: 1200px;
  margin: 0 auto;
}
.card-header {
  font-weight: 600;
}
</style>
