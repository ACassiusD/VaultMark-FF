(function () {
  "use strict";

  function showToast(text) {
    const toast = document.createElement("div");
    toast.setAttribute("data-vaultmarks-toast", "true");
    toast.textContent = text;
    Object.assign(toast.style, {
      position: "fixed",
      bottom: "24px",
      right: "24px",
      padding: "10px 16px",
      backgroundColor: "rgba(30, 30, 30, 0.95)",
      color: "#fff",
      borderRadius: "8px",
      fontSize: "14px",
      fontFamily: "system-ui, sans-serif",
      boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
      zIndex: "2147483647",
      opacity: "0",
      transition: "opacity 0.2s ease-out",
      pointerEvents: "none"
    });

    document.documentElement.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = "1";
    });

    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 200);
    }, 1500);
  }

  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === "SHOW_TOAST") {
      showToast(msg.text || "Page saved");
    }
  });
})();
