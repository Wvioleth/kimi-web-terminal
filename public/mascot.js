(function () {
  'use strict';

  /* ========== 注入 CSS ========== */
  const css = `
/* ===== 卡通角色 ===== */
.mascot-wrap {
  position: fixed;
  bottom: 30px;
  left: 30px;
  z-index: 9998;
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.mascot-wrap:hover { transform: scale(1.08); }
.mascot-wrap:active { transform: scale(0.92); }
.mascot-wrap, .mascot-wrap * { transition: all .25s cubic-bezier(.34,1.56,.64,1); }

.mascot {
  width: 76px;
  height: 76px;
  background: linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%);
  border-radius: 50%;
  position: relative;
  box-shadow: 0 6px 20px rgba(255,154,158,.45);
  animation: mascotBob 2.6s ease-in-out infinite;
}
.mascot-eye-l, .mascot-eye-r {
  position: absolute;
  top: 26px;
  width: 11px;
  height: 14px;
  background: #2d2d2d;
  border-radius: 50%;
  animation: mascotBlink 3.8s ease-in-out infinite;
}
.mascot-eye-l { left: 17px; }
.mascot-eye-r { right: 17px; }
.mascot-eye-l::after, .mascot-eye-r::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 4px;
  height: 4px;
  background: #fff;
  border-radius: 50%;
}
.mascot-mouth {
  position: absolute;
  bottom: 22px;
  left: 50%;
  transform: translateX(-50%);
  width: 18px;
  height: 8px;
  border-bottom: 2.5px solid #2d2d2d;
  border-radius: 0 0 16px 16px;
}
.mascot-blush-l, .mascot-blush-r {
  position: absolute;
  top: 40px;
  width: 12px;
  height: 7px;
  background: rgba(255,100,100,.35);
  border-radius: 50%;
}
.mascot-blush-l { left: 9px; }
.mascot-blush-r { right: 9px; }

.mascot-bubble {
  position: absolute;
  bottom: 92px;
  right: 0;
  background: #fff;
  padding: 10px 16px;
  border-radius: 18px 18px 4px 18px;
  box-shadow: 0 6px 20px rgba(0,0,0,.12);
  font-size: 13px;
  color: #444;
  max-width: 220px;
  line-height: 1.5;
  opacity: 0;
  transform: translateY(12px) scale(.85);
  pointer-events: none;
}
.mascot-bubble.show {
  opacity: 1;
  transform: translateY(0) scale(1);
}
.mascot-bubble::after {
  content: '';
  position: absolute;
  bottom: -7px;
  right: 22px;
  width: 0; height: 0;
  border-left: 7px solid transparent;
  border-right: 7px solid transparent;
  border-top: 9px solid #fff;
}

/* ===== 右键菜单 ===== */
.mascot-context-menu {
  position: fixed;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0,0,0,.18);
  padding: 6px 0;
  min-width: 150px;
  z-index: 10000;
  opacity: 0;
  transform: scale(.92);
  pointer-events: none;
  transition: opacity .15s ease, transform .15s ease;
  font-size: 13px;
  color: #333;
  overflow: hidden;
}
.mascot-context-menu.show {
  opacity: 1;
  transform: scale(1);
  pointer-events: auto;
}
.mascot-context-menu .menu-item {
  padding: 10px 16px;
  cursor: pointer;
  transition: background .12s ease;
  white-space: nowrap;
}
.mascot-context-menu .menu-item:hover {
  background: rgba(255,154,158,.12);
}
.mascot-context-menu .menu-divider {
  height: 1px;
  background: rgba(0,0,0,.08);
  margin: 4px 0;
}

.mascot-particle {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
  animation: particlePop .7s ease-out forwards;
}
@keyframes mascotBob {
  0%,100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}
@keyframes mascotBlink {
  0%,48%,52%,100% { transform: scaleY(1); }
  50% { transform: scaleY(.1); }
}
@keyframes particlePop {
  0% { opacity:1; transform:translate(0,0) scale(1); }
  100% { opacity:0; transform:translate(var(--tx),var(--ty)) scale(0); }
}

@media (max-width:600px){
  .mascot-wrap { bottom: 15px; left: 15px; touch-action: none; -webkit-touch-callout: none; }
  .mascot { width: 62px; height: 62px; }
  .mascot-eye-l, .mascot-eye-r { top: 20px; width: 9px; height: 12px; }
  .mascot-eye-l { left: 14px; }
  .mascot-eye-r { right: 14px; }
  .mascot-mouth { bottom: 16px; width: 15px; height: 6px; }
  .mascot-blush-l, .mascot-blush-r { top: 32px; width: 10px; height: 5px; }
  .mascot-bubble { bottom: 76px; font-size: 12px; max-width: 170px; padding: 8px 12px; }
  .mascot-context-menu { min-width: 170px; border-radius: 12px; }
  .mascot-context-menu .menu-item { padding: 14px 18px; font-size: 14px; }
}
`;

  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  /* ========== 注入 HTML ========== */
  const mascotWrap = document.createElement('div');
  mascotWrap.className = 'mascot-wrap';
  mascotWrap.id = 'mascot';
  mascotWrap.title = '点我一下~';
  mascotWrap.innerHTML = `
    <div class="mascot-bubble" id="mascotBubble"></div>
    <div class="mascot">
      <div class="mascot-eye-l"></div>
      <div class="mascot-eye-r"></div>
      <div class="mascot-mouth"></div>
      <div class="mascot-blush-l"></div>
      <div class="mascot-blush-r"></div>
    </div>
  `;

  const contextMenu = document.createElement('div');
  contextMenu.className = 'mascot-context-menu';
  contextMenu.id = 'mascotContextMenu';
  contextMenu.innerHTML = `
    <div class="menu-item" data-action="hide">隐藏</div>
    <div class="menu-divider"></div>
    <div class="menu-item" data-action="about">关于小助手</div>
  `;

  document.body.appendChild(mascotWrap);
  document.body.appendChild(contextMenu);

  /* ========== 初始化逻辑 ========== */
  const quotes = [
    '嗨！今天过得怎么样？',
    '莫待无花空折枝 ✨',
    '今天也是充满希望的一天！',
    '记得多喝水，休息眼睛哦',
    '七七四十九，一切刚刚好',
    '保持热爱，奔赴山海 🎵',
    '加油，你是最棒的！',
    '有什么可以帮你的吗？'
  ];

  const mascot = document.getElementById('mascot');
  const bubble = document.getElementById('mascotBubble');
  const ctxMenu = document.getElementById('mascotContextMenu');
  let timer = null;
  let longPressTimer = null;
  let longPressTriggered = false;
  const LONG_PRESS_DURATION = 500;

  function showBubble(text) {
    bubble.textContent = text;
    bubble.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(() => bubble.classList.remove('show'), 3000);
  }

  function spawnParticles() {
    const colors = ['#ff9a9e','#fecfef','#a8edea','#fed6e3','#d299c2'];
    for (let i = 0; i < 8; i++) {
      const p = document.createElement('div');
      p.className = 'mascot-particle';
      p.style.left = '38px';
      p.style.top = '38px';
      p.style.width = (4 + Math.random() * 6) + 'px';
      p.style.height = p.style.width;
      p.style.background = colors[Math.floor(Math.random() * colors.length)];
      const angle = Math.random() * Math.PI * 2;
      const dist = 40 + Math.random() * 50;
      p.style.setProperty('--tx', Math.cos(angle) * dist + 'px');
      p.style.setProperty('--ty', Math.sin(angle) * dist + 'px');
      mascot.appendChild(p);
      setTimeout(() => p.remove(), 700);
    }
  }

  mascot.addEventListener('click', function() {
    if (dragState.moved || longPressTriggered) return;
    const text = quotes[Math.floor(Math.random() * quotes.length)];
    showBubble(text);
    spawnParticles();
  });

  setTimeout(() => {
    showBubble('嗨！我是你的小助手，点我聊天~');
  }, 3000);

  // ===== 拖动功能 =====
  const dragState = { dragging: false, moved: false, startX: 0, startY: 0, offsetX: 0, offsetY: 0 };

  function getMascotRect() {
    return mascot.getBoundingClientRect();
  }

  function setMascotPos(x, y) {
    const rect = getMascotRect();
    const maxX = window.innerWidth - rect.width;
    const maxY = window.innerHeight - rect.height;
    let left = Math.max(0, Math.min(x, maxX));
    let top = Math.max(0, Math.min(y, maxY));
    mascot.style.left = left + 'px';
    mascot.style.top = top + 'px';
    mascot.style.right = 'auto';
    mascot.style.bottom = 'auto';
  }

  function onPointerDown(e) {
    if (e.type === 'mousedown' && e.button !== 0) return;

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const rect = getMascotRect();

    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTriggered = false;

    dragState.dragging = true;
    dragState.moved = false;
    dragState.startX = clientX;
    dragState.startY = clientY;
    dragState.offsetX = clientX - rect.left;
    dragState.offsetY = clientY - rect.top;
    mascot.style.transition = 'none';

    if (e.type === 'touchstart') {
      longPressTimer = setTimeout(() => {
        longPressTriggered = true;
        dragState.dragging = false;
        mascot.style.transition = '';
        const r = getMascotRect();
        showContextMenu(r.left + r.width / 2, r.top + r.height / 2);
      }, LONG_PRESS_DURATION);
    }

    if (e.type === 'mousedown' || e.type === 'touchstart') e.preventDefault();
  }

  function onPointerMove(e) {
    if (!dragState.dragging) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const dx = Math.abs(clientX - dragState.startX);
    const dy = Math.abs(clientY - dragState.startY);
    if (dx > 3 || dy > 3) {
      dragState.moved = true;
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    }
    setMascotPos(clientX - dragState.offsetX, clientY - dragState.offsetY);
  }

  function onPointerUp(e) {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    if (!dragState.dragging) return;
    dragState.dragging = false;
    mascot.style.transition = '';
    if (dragState.moved) {
      setTimeout(() => { dragState.moved = false; }, 350);
    } else {
      dragState.moved = false;
    }
  }

  mascot.addEventListener('mousedown', onPointerDown);
  document.addEventListener('mousemove', onPointerMove);
  document.addEventListener('mouseup', onPointerUp);

  mascot.addEventListener('touchstart', onPointerDown, { passive: false });
  document.addEventListener('touchmove', onPointerMove, { passive: false });
  document.addEventListener('touchend', onPointerUp);
  document.addEventListener('touchcancel', onPointerUp);

  // ===== 右键菜单 =====
  function showContextMenu(x, y) {
    const rect = ctxMenu.getBoundingClientRect();
    const menuWidth = rect.width || 160;
    const menuHeight = rect.height || 170;
    let left = x;
    let top = y;
    if (left + menuWidth > window.innerWidth - 8) {
      left = window.innerWidth - menuWidth - 8;
    }
    if (left < 8) left = 8;
    if (top + menuHeight > window.innerHeight - 8) {
      top = window.innerHeight - menuHeight - 8;
    }
    if (top < 8) top = 8;
    ctxMenu.style.left = left + 'px';
    ctxMenu.style.top = top + 'px';
    ctxMenu.classList.add('show');
  }

  function hideContextMenu() {
    ctxMenu.classList.remove('show');
  }

  mascot.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY);
  });

  ctxMenu.addEventListener('click', function(e) {
    const item = e.target.closest('.menu-item');
    if (!item) return;

    const action = item.getAttribute('data-action');
    switch (action) {
      case 'hide':
        mascot.style.display = 'none';
        break;
      case 'about':
        showBubble('我是你的小助手，更多功能陆续上线中~');
        break;
      default:
        showBubble('这个功能还在开发中哦~');
        break;
    }
    hideContextMenu();
  });

  document.addEventListener('click', function(e) {
    if (longPressTriggered) {
      longPressTriggered = false;
      return;
    }
    if (!ctxMenu.contains(e.target)) {
      hideContextMenu();
    }
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') hideContextMenu();
  });
})();
