<template>
  <main class="page">
    <section class="card">
      <h1>工作量评估系统</h1>
      <p>前端骨架已初始化（Vue 3 + Vite）。</p>
    </section>
  </main>
</template>

<style scoped>
.page {
  min-height: 100vh;
  margin: 0;
  display: grid;
  place-items: center;
  background: #f8fafc;
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #0f172a;
}

.card {
  width: min(640px, 92vw);
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  padding: 28px;
  box-shadow: 0 8px 28px rgba(15, 23, 42, 0.06);
}

h1 {
  margin: 0 0 10px;
  font-size: 28px;
  line-height: 1.2;
}

p {
  margin: 0;
  color: #475569;
}
</style>
