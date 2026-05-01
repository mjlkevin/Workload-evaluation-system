<template>
  <div class="blank-layout">
    <slot />
  </div>
</template>

<style scoped>
.blank-layout {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
}
</style>
