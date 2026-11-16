// HUD: every DOM write goes through here, once per frame at most.
// The 3D scene never touches the DOM and the HUD never touches the sim.
import { ECONOMY, WEAPONS, BUY_ORDER, ROUND } from './config.js';
import { playerWeapon } from './state.js';

export function createHud(callbacks) {
  const $ = (id) => document.getElementById(id);
  const el = {
    hud: $('hud'), health: $('health'), armor: $('armor'), money: $('money'),
    ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), weaponName: $('weapon-name'),
    timer: $('timer'), scoreV: $('score-v'), scoreJ: $('score-j'),
    aliveV: $('alive-v'), aliveJ: $('alive-j'), roundLabel: $('round-label'),
    feed: $('feed'), crosshair: $('crosshair'), hitmarker: $('hitmarker'),
    hurt: $('hurt'), banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    overlay: $('overlay'), overlayTitle: $('overlay-title'), overlayCopy: $('overlay-copy'),
    overlayBtn: $('overlay-btn'), buyMenu: $('buy-menu'), buyList: $('buy-list'),
    buyMoney: $('buy-money'), plantBar: $('plant-bar'), plantFill: $('plant-fill'),
    plantLabel: $('plant-label'), bombStatus: $('bomb-status'), hint: $('hint'),
    grenades: $('grenades'),
  };
  let hitTimer = 0;
  let hurtTimer = 0;

  function fmtTime(s) {
    const t = Math.max(0, Math.ceil(s));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }

  function update(state, def) {
    const p = state.player;
    el.health.textContent = Math.ceil(p.health);
    el.health.parentElement.classList.toggle('low', p.health <= 30);
    el.armor.textContent = Math.ceil(p.armor);
    el.money.textContent = `$${state.money}`;
    el.ammoMag.textContent = p.reloading > 0 ? '--' : p.mag;
    el.ammoReserve.textContent = `/ ${p.reserve}`;
    el.weaponName.textContent = def.name + (p.grenades > 0 ? `  ·  ${p.grenades} frag` : '');
    el.timer.textContent = state.phase === 'buy' ? `BUY ${fmtTime(state.timer)}` : fmtTime(state.timer);
    el.timer.classList.toggle('urgent', state.timer <= 10 && state.phase === 'live');
    el.scoreV.textContent = state.wins.vultures;
    el.scoreJ.textContent = state.wins.jackals;
    el.roundLabel.textContent = `ROUND ${state.round}/${ROUND.maxRounds}`;
    const aliveV = state.bots.filter((b) => b.team === 'vultures' && b.alive).length + (p.alive ? 1 : 0);
    const aliveJ = state.bots.filter((b) => b.team === 'jackals' && b.alive).length;
    el.aliveV.textContent = aliveV;
    el.aliveJ.textContent = aliveJ;
    // Crosshair gap grows with bloom + movement: stopping to aim pays.
    const gap = 4 + p.bloom * 3 + (p.moving ? 3 : 0);
    el.crosshair.style.setProperty('--gap', `${gap}px`);
    el.crosshair.classList.toggle('hidden', !p.alive || state.phase === 'title');
    // Bomb status line.
    const b = state.bomb;
    if (b.state === 'planted') el.bombStatus.textContent = `CHARGE AT SITE ${b.site} — ${fmtTime(b.fuse)}`;
    else if (b.state === 'planting') el.bombStatus.textContent = `PLANTING SITE ${b.site}…`;
    else if (b.state === 'dropped') el.bombStatus.textContent = 'CHARGE DROPPED — A VULTURE IS RECOVERING IT';
    else if (b.state === 'defused') el.bombStatus.textContent = 'CHARGE DEFUSED';
    else if (b.state === 'detonated') el.bombStatus.textContent = 'CHARGE DETONATED';
    else el.bombStatus.textContent = state.player.alive ? 'CARRYING THE CHARGE — HOLD E AT A SITE' : '';
    // Plant progress bar.
    if (b.state === 'planting') {
      el.plantBar.classList.remove('hidden');
      el.plantFill.style.width = `${(b.progress / ROUND.plantHoldSeconds) * 100}%`;
      el.plantLabel.textContent = `PLANTING — SITE ${b.site}`;
    } else if (b.state === 'planted' && b.defuser) {
      el.plantBar.classList.remove('hidden');
      el.plantFill.style.width = `${(b.defuseProgress / ROUND.defuseHoldSeconds) * 100}%`;
      el.plantLabel.textContent = 'ENEMY DEFUSING THE CHARGE!';
    } else {
      el.plantBar.classList.add('hidden');
    }
    // Kill feed (newest first).
    if (state.feed.length) {
      el.feed.innerHTML = state.feed.map((f) => `<div class="feed-item ${f.cls}">${f.text}</div>`).join('');
    } else {
      el.feed.innerHTML = '';
    }
    if (hitTimer > 0) { hitTimer -= 1; if (hitTimer === 0) el.hitmarker.classList.remove('on'); }
    if (hurtTimer > 0) { hurtTimer -= 1; if (hurtTimer === 0) el.hurt.classList.remove('on'); }
  }

  function showHitmarker(head) {
    el.hitmarker.classList.add('on');
    el.hitmarker.classList.toggle('head', head);
    hitTimer = 6;
  }

  function showHurt() {
    el.hurt.classList.add('on');
    hurtTimer = 12;
  }

  function clearHurt() {
    el.hurt.classList.remove('on');
    hurtTimer = 0;
  }

  function showBanner(title, sub, ms = 2600) {
    el.bannerTitle.textContent = title;
    el.bannerSub.textContent = sub;
    el.banner.classList.remove('hidden');
    clearTimeout(showBanner._t);
    showBanner._t = setTimeout(() => el.banner.classList.add('hidden'), ms);
  }

  function showOverlay(title, copy, btnLabel, onClick) {
    el.overlayTitle.innerHTML = title;
    el.overlayCopy.textContent = copy;
    el.overlayBtn.textContent = btnLabel;
    el.overlay.classList.remove('hidden');
    el.hud.classList.add('dim');
    el.overlayBtn.onclick = () => { callbacks.onOverlayClick(); if (onClick) onClick(); };
  }

  function hideOverlay() { el.overlay.classList.add('hidden'); el.hud.classList.remove('dim'); }

  function renderBuy(state) {
    el.buyMoney.textContent = `$${state.money}`;
    const p = state.player;
    const rows = [];
    for (const id of BUY_ORDER) {
      const w = WEAPONS[id];
      const owned = p.primary === id || p.weapon === id;
      const afford = state.money >= w.price;
      rows.push(`<button class="buy-row ${owned ? 'owned' : ''} ${afford ? '' : 'poor'}" data-buy="${id}">
        <span class="buy-key">${BUY_ORDER.indexOf(id) + 1}</span>
        <span class="buy-name">${w.name}</span>
        <span class="buy-kind">${w.kind.toUpperCase()} · ${w.damage} DMG · ${w.mag} RD</span>
        <span class="buy-price">${owned ? 'OWNED' : '$' + w.price}</span>
      </button>`);
    }
    rows.push(`<button class="buy-row ${p.armor >= 100 ? 'owned' : ''} ${state.money >= ECONOMY.armorPrice ? '' : 'poor'}" data-buy="armor">
      <span class="buy-key">6</span><span class="buy-name">Plate Carrier</span>
      <span class="buy-kind">ARMOR · ABSORBS 50% DAMAGE</span>
      <span class="buy-price">${p.armor >= 100 ? 'OWNED' : '$' + ECONOMY.armorPrice}</span></button>`);
    rows.push(`<button class="buy-row ${state.money >= ECONOMY.grenadePrice ? '' : 'poor'}" data-buy="grenade">
      <span class="buy-key">7</span><span class="buy-name">Ember Frag</span>
      <span class="buy-kind">GRENADE · PRESS G TO THROW</span>
      <span class="buy-price">$${ECONOMY.grenadePrice}</span></button>`);
    el.buyList.innerHTML = rows.join('');
    el.buyList.querySelectorAll('[data-buy]').forEach((btn) => {
      btn.onclick = () => callbacks.onBuy(btn.dataset.buy);
    });
  }

  function setBuyOpen(open, state) {
    el.buyMenu.classList.toggle('hidden', !open);
    if (open) renderBuy(state);
  }

  function setHint(text) { el.hint.textContent = text; }

  return {
    update, showHitmarker, showHurt, clearHurt, showBanner, showOverlay, hideOverlay,
    setBuyOpen, renderBuy, setHint, el,
  };
}
