<script setup lang="ts">
import Icon from "./Icon.vue";
</script>

<template>
  <section class="card empty-state stack" aria-labelledby="empty-title">
    <span class="empty-art" aria-hidden="true"><Icon name="fork-knife" :size="40" /></span>
    <h3 id="empty-title" class="title-lg">No trips yet</h3>
    <p class="muted">
      Create a trip to start deciding where to eat. You'll be its organiser, and can invite the
      people coming along.
    </p>
    <button type="button" class="btn btn-primary"><Icon name="plus" /> Create a trip</button>
  </section>
</template>
