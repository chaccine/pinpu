/* Toast 浮层消息：短时间提示，重复调用重置计时。 */

export function createToast(el) {
  let timer = 0;
  return function toast(message) {
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(() => el.classList.remove('show'), 2300);
  };
}
