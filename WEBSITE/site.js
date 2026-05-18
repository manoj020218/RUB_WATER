(function () {
  var yearNodes = document.querySelectorAll("[data-year]");
  var year = new Date().getFullYear();
  yearNodes.forEach(function (node) {
    node.textContent = String(year);
  });

  var menuButton = document.querySelector("[data-menu-button]");
  var navLinks = document.querySelector("[data-nav-links]");

  if (menuButton && navLinks) {
    menuButton.addEventListener("click", function () {
      navLinks.classList.toggle("collapsed");
    });
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./sw.js").catch(function () {});
    });
  }
})();

