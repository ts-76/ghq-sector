import { mount } from "svelte";
import App from "./App.svelte";
import "./styles.css";

const target = document.getElementById("root");

if (!target) {
  throw new Error("Root element #root was not found");
}

mount(App, {
  target,
});
