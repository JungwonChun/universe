import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

// PWA 설치 프롬프트 이벤트를 놓치지 않게 전역에서 미리 캡처
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  window.__deferredInstall = e;
  window.dispatchEvent(new Event("install-ready"));
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
