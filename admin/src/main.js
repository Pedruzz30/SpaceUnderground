import "./styles/main.css";
import { initRouter } from "./router/router.js";

document.documentElement.classList.add("js");

initRouter(document.querySelector("#app"));
