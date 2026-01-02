<script setup lang="ts">
import Example from './components/Example.vue'
import Notes from './components/Notes.vue'
import NotesWithStore from './components/NotesWithStore.vue'

// Local components are available in the template automatically with `script setup`.
</script>

<!-- Using Vuetify components (Vuetify should be registered in the app entry). -->
<template>
  <VContainer id="main-container" class="d-flex flex-column" fluid>
    <VRow class="pa-0">
      <VCol cols="5" class="pa-0">
        <Example />
      </VCol>
    </VRow>

    <VRow class="pa-0">
      <VCol class="pa-0">
        <Notes msg="This is a message sent from App.vue as component property" />
        <!-- <NotesWithStore msg="This is a message sent from App.vue as component property"/> -->
      </VCol>
    </VRow>
  </VContainer>
</template>

<style scoped>
#main-container{
  height: 100%;
}
</style>
