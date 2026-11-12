import { defineStore } from "@platform/core";

export default defineStore({
  modules: {},
  branding: { name: "Store", primaryColor: "#2563eb" },
  locale: { default: "en", currency: "USD", timezone: "UTC" },
});
