const form = document.querySelector("#login-form"),
  password = document.querySelector("#password"),
  submit = document.querySelector("#login-submit"),
  error = document.querySelector("#login-error"),
  toggle = document.querySelector("#toggle-password");
toggle.addEventListener("click", () => {
  const visible = password.type === "text";
  password.type = visible ? "password" : "text";
  toggle.textContent = visible ? "显示" : "隐藏";
  toggle.setAttribute("aria-label", visible ? "显示密码" : "隐藏密码");
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.textContent = "";
  submit.disabled = true;
  submit.textContent = "验证中…";
  try {
    const response = await fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: password.value }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "登录失败");
    location.replace("/#overview");
  } catch (reason) {
    error.textContent = reason.message;
    password.select();
  } finally {
    submit.disabled = false;
    submit.textContent = "进入看板";
  }
});
