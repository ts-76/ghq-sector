<script lang="ts">
let { value, onchange } = $props();
</script>
<textarea aria-label="Visual JSON test editor" value={JSON.stringify(value)} oninput={(event) => onchange(JSON.parse(event.currentTarget.value))}></textarea>
