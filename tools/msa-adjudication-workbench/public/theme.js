/*
 * Theme bootstrap for the ADG adjudication portal.
 *
 * Loaded as a classic (non-module) script in <head> before the stylesheet
 * so the colour mode is applied before first paint, avoiding a flash of the
 * wrong theme. The site Content-Security-Policy forbids inline scripts and
 * inline styles, so all theming state lives on the <html> element via
 * data attributes and is toggled here from a same-origin file.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "adg-color-mode";
  var MODES = ["light", "dark", "auto"];
  var root = document.documentElement;

  function normalize(mode) {
    return MODES.indexOf(mode) === -1 ? "auto" : mode;
  }

  function readStored() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      return null;
    }
  }

  function writeStored(mode) {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch (error) {
      /* Storage may be unavailable (private mode); theme still applies. */
    }
  }

  function apply(mode) {
    var value = normalize(mode);
    root.setAttribute("data-color-mode", value);
    root.setAttribute("data-light-theme", "light");
    root.setAttribute("data-dark-theme", "dark");
    return value;
  }

  var active = apply(readStored() || "auto");

  function wireToggle() {
    var group = document.querySelector("[data-theme-toggle]");
    if (!group) {
      return;
    }
    var buttons = group.querySelectorAll("[data-theme-option]");

    function sync() {
      var current = root.getAttribute("data-color-mode") || "auto";
      buttons.forEach(function (button) {
        var pressed = button.getAttribute("data-theme-option") === current;
        button.setAttribute("aria-pressed", pressed ? "true" : "false");
      });
    }

    buttons.forEach(function (button) {
      button.addEventListener("click", function () {
        active = apply(button.getAttribute("data-theme-option"));
        writeStored(active);
        sync();
      });
    });

    sync();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireToggle);
  } else {
    wireToggle();
  }
})();
