<script setup lang="ts">
import { ref, useTemplateRef } from "vue";
import Icon from "./Icon.vue";

const name = ref("Tokyo, October");
const timezone = ref("Asia/Tokyo");
const dialog = useTemplateRef<HTMLDialogElement>("dialog");
</script>

<template>
  <div class="stack">
    <div class="card stack-sm">
      <h4 class="title-md">Buttons</h4>
      <div class="actions">
        <button type="button" class="btn btn-primary">Create a trip</button>
        <button type="button" class="btn btn-secondary">Cancel</button>
        <button type="button" class="btn btn-danger"><Icon name="trash" /> Delete trip</button>
      </div>
      <div class="actions">
        <button type="button" class="btn btn-primary" disabled>Saving…</button>
        <button type="button" class="btn btn-ghost">Edit trip</button>
        <button type="button" class="btn btn-icon" aria-label="Close"><Icon name="x" /></button>
      </div>
    </div>

    <div class="card stack-sm">
      <h4 class="title-md">Fields</h4>
      <div class="field">
        <label for="f-name">Trip name</label>
        <input id="f-name" v-model="name" type="text" autocomplete="off" />
      </div>
      <div class="field">
        <label for="f-end">End date</label>
        <input
          id="f-end"
          type="date"
          value="2026-10-12"
          aria-invalid="true"
          aria-describedby="f-end-error"
        />
        <p id="f-end-error" class="field-error">
          <Icon name="warning" :size="16" /> End date must be on or after the start date.
        </p>
      </div>
      <div class="field">
        <label for="f-tz">Timezone</label>
        <select id="f-tz" v-model="timezone" aria-describedby="f-tz-hint">
          <option>Asia/Tokyo</option>
          <option>Asia/Taipei</option>
          <option>Asia/Seoul</option>
          <option>Europe/London</option>
        </select>
        <p id="f-tz-hint" class="hint">Every meal time is shown in this timezone.</p>
      </div>
    </div>

    <article class="card stack-sm">
      <h4 class="title-md">Card</h4>
      <dl class="facts">
        <dt>Dates</dt>
        <dd>14 Oct 2026 – 18 Oct 2026</dd>
        <dt>Timezone</dt>
        <dd>Asia/Tokyo</dd>
        <dt>Organiser</dt>
        <dd>You're the organiser</dd>
      </dl>
      <div class="warning-box" role="note">
        <p class="warning-title"><Icon name="warning" /> 2 meals fall outside the new dates</p>
        <ul>
          <li>Sun 19 Oct, Breakfast</li>
          <li>Sun 19 Oct, Airport last meal</li>
        </ul>
      </div>
    </article>

    <div class="stack-sm">
      <h4 class="title-md">Confirmation dialog</h4>
      <div class="dialog-panel dialog-preview" role="group" aria-label="Dialog preview">
        <h5 class="title-md">Delete this trip?</h5>
        <p>
          Tokyo, October and its 20 meals will be deleted for all 5 members. This can't be undone.
        </p>
        <div class="actions actions-end">
          <button type="button" class="btn btn-secondary">Cancel</button>
          <button type="button" class="btn btn-danger">Delete trip</button>
        </div>
      </div>
      <button type="button" class="btn btn-secondary btn-block" @click="dialog?.showModal()">
        Open it as a real modal
      </button>
    </div>

    <dialog ref="dialog" class="dialog-panel" aria-labelledby="dlg-title">
      <form method="dialog" class="stack-sm">
        <h5 id="dlg-title" class="title-md">Delete this trip?</h5>
        <p>
          Tokyo, October and its 20 meals will be deleted for all 5 members. This can't be undone.
        </p>
        <div class="actions actions-end">
          <button value="cancel" class="btn btn-secondary">Cancel</button>
          <button value="delete" class="btn btn-danger">Delete trip</button>
        </div>
      </form>
    </dialog>
  </div>
</template>
