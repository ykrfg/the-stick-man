// Everything drawn over the 3D world on a 2D canvas: the HUD (money, health,
// wanted stars, objective, bust meter, prompts and banners) and the minimap
// (streets, the player, police, rivals and the mission marker), plus the title,
// pause, busted and wasted screens. The title screen draws two little stick
// figures in canvas lines — the white hero and the black rival — as a logo.
import { HEAT_THRESHOLDS, PLAYER, ROAD, WORLD } from './config.js';
import { jobAvailable, missionAvailable, objectiveTarget, objectiveText } from './missions.js';
import { hasProgress } from './save.js';
import { starsFor } from './police.js';
import { PROMPT_PREFIX, t } from './i18n.js';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function star(ctx, cx, cy, r, filled, active) {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const px = cx + Math.cos(a) * rad;
    const py = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  if (filled) {
    ctx.fillStyle = active ? '#ffd94d' : '#8a8f98';
    ctx.fill();
  }
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(10,10,20,0.65)';
  ctx.stroke();
}

/** A simple 2D stick figure for the title logo, mouth-only face. */
function logoFigure(ctx, x, y, s, fill, mouth) {
  ctx.lineWidth = 7 * s;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#17181c';
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y - 52 * s, 17 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y - 35 * s);
  ctx.lineTo(x, y - 4 * s); // torso
  ctx.moveTo(x, y - 28 * s);
  ctx.lineTo(x - 15 * s, y - 12 * s); // arm L
  ctx.moveTo(x, y - 28 * s);
  ctx.lineTo(x + 16 * s, y - 18 * s); // arm R raised
  ctx.moveTo(x, y - 4 * s);
  ctx.lineTo(x - 13 * s, y + 22 * s); // leg L
  ctx.moveTo(x, y - 4 * s);
  ctx.lineTo(x + 14 * s, y + 22 * s); // leg R
  ctx.stroke();
  ctx.lineWidth = 3.4 * s;
  ctx.strokeStyle = fill === '#ffffff' ? '#17181c' : '#ffffff';
  ctx.beginPath();
  if (mouth === 'grin') ctx.arc(x + 1 * s, y - 50 * s, 7 * s, 0.15 * Math.PI, 0.85 * Math.PI);
  else {
    ctx.moveTo(x - 6 * s, y - 47 * s);
    ctx.lineTo(x + 7 * s, y - 47 * s);
  }
  ctx.stroke();
}

function drawMinimap(g, ctx) {
  // On phones the map shrinks and moves under the top-left HUD bars, clear of
  // the joystick (bottom-left) and the buttons (bottom-right).
  const W = g.mobile ? 118 : 196;
  const H = g.mobile ? 88 : 148;
  const x0 = 14;
  const y0 = g.mobile ? 148 : g.viewH - H - 14;
  const sx = W / WORLD.width;
  const sy = H / WORLD.height;
  ctx.save();
  roundRect(ctx, x0 - 4, y0 - 4, W + 8, H + 8, 10);
  ctx.fillStyle = 'rgba(12,16,26,0.78)';
  ctx.fill();
  ctx.beginPath();
  roundRect(ctx, x0, y0, W, H, 7);
  ctx.clip();
  ctx.fillStyle = '#3d4a3a';
  ctx.fillRect(x0, y0, W, H);
  // Beach strip and the park.
  ctx.fillStyle = '#c9b478';
  ctx.fillRect(x0, y0 + g.city.beachY * sy, W, H - g.city.beachY * sy);
  if (g.city.park) {
    ctx.fillStyle = '#4d7c43';
    ctx.fillRect(x0 + g.city.park.x * sx, y0 + g.city.park.y * sy, g.city.park.w * sx, g.city.park.h * sy);
  }
  // Roads.
  ctx.strokeStyle = '#9aa3ad';
  ctx.lineWidth = Math.max(2, ROAD.width * sx * 0.8);
  for (const avenue of ROAD.avenues) {
    ctx.beginPath();
    ctx.moveTo(x0 + avenue * sx, y0);
    ctx.lineTo(x0 + avenue * sx, y0 + H);
    ctx.stroke();
  }
  for (const street of ROAD.streets) {
    ctx.beginPath();
    ctx.moveTo(x0, y0 + street * sy);
    ctx.lineTo(x0 + W, y0 + street * sy);
    ctx.stroke();
  }
  const dot = (x, y, r, color) => {
    ctx.beginPath();
    ctx.arc(x0 + x * sx, y0 + y * sy, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  };
  // Bruno, when he has work (a story job, or odd jobs in free roam).
  if (!g.mission.active && (missionAvailable(g) || jobAvailable(g))) {
    const b = g.city.landmarks.diner;
    dot(b.x, b.y, 4, '#ffd94d');
  }
  // The mission marker.
  const marker = g.markerGold.visible ? g.markerGold : g.markerRed.visible ? g.markerRed : null;
  if (marker) {
    const pulse = 4.5 + Math.sin(g.time * 5) * 1.4;
    dot(marker.position.x, marker.position.z, pulse, g.markerGold.visible ? '#ffd94d' : '#ff5a4d');
  }
  // Traffic: small muted dots, so the city's flow reads on the map
  // without competing with police, rivals or the objective marker.
  for (const car of g.cars) {
    if (car.kind === 'traffic') dot(car.x, car.y, 2.1, 'rgba(205,212,224,0.5)');
  }
  // Police and rivals.
  for (const car of g.cars) {
    if (car.kind === 'police') dot(car.x, car.y, 3.6, Math.floor(g.time * 5) % 2 ? '#ff5a4d' : '#5aa2ff');
  }
  for (const ped of g.peds) {
    if (ped.state === 'down' || ped.state === 'inCar') continue;
    if (ped.role === 'cop') dot(ped.x, ped.y, 3, '#5aa2ff');
    else if (ped.role === 'rival') dot(ped.x, ped.y, 3.4, '#ff5a4d');
    else if (ped.role === 'shade') dot(ped.x, ped.y, 3.4, '#e8e8e8');
  }
  // The player: a white dot with a facing tick.
  const p = g.player;
  dot(p.x, p.y, 4.4, '#ffffff');
  ctx.beginPath();
  ctx.arc(x0 + p.x * sx, y0 + p.y * sy, 4.4, 0, Math.PI * 2);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = '#17181c';
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x0 + p.x * sx, y0 + p.y * sy);
  ctx.lineTo(x0 + (p.x + Math.cos(p.angle) * 130) * sx, y0 + (p.y + Math.sin(p.angle) * 130) * sy);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.restore();
}

/** Portrait-phone title: scaled type, stacked touch instructions, no ENTER. */
function drawTitleMobile(g, ctx) {
  const { viewW: w, viewH: h } = g;
  ctx.fillStyle = 'rgba(16,20,34,0.55)';
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2;
  ctx.textAlign = 'center';
  // The layout flows down from the top and is FITTED into the space above
  // the TAP TO START button's zone: the help block used to be a fixed
  // ladder of baselines at a fixed pitch, and every feature that added a
  // line pushed the last ones underneath the button on portrait phones.
  // Now the row pitch (and, on short screens, the type) shrinks so the
  // whole block — help, saved-run line, reset note — ends above the
  // reserved button zone at the bottom of the screen.
  const compact = h < 760;
  const titleY = compact ? 82 : 104;
  let titleSize = Math.min(52, w * 0.128);
  ctx.font = `900 ${titleSize}px system-ui, sans-serif`;
  while (titleSize > 20 && ctx.measureText('THE STICK MAN').width > w - 18) {
    titleSize -= 2;
    ctx.font = `900 ${titleSize}px system-ui, sans-serif`;
  }
  ctx.fillStyle = '#ffd94d';
  ctx.lineWidth = 9;
  ctx.strokeStyle = '#17181c';
  ctx.strokeText('THE STICK MAN', cx, titleY);
  ctx.fillText('THE STICK MAN', cx, titleY);
  ctx.font = '600 14.5px system-ui, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(t('title.subtitle.mobile'), cx, titleY + 28);
  const figY = titleY + (compact ? 104 : 120);
  logoFigure(ctx, cx - 68, figY, 1.0, '#ffffff', 'grin');
  logoFigure(ctx, cx + 68, figY, 1.0, '#17181c', 'flat');
  const lines = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => t(`help.mobile.${i}`));
  const save = g.saveData;
  const jobsDone = save && Array.isArray(save.missionsDone) ? save.missionsDone.length : 0;
  const showSave = !!(save && (save.money > 0 || jobsDone > 0));
  const showReset = hasProgress(save);
  const rows = lines.length + (showSave ? 1 : 0) + (showReset ? 1 : 0);
  const helpTop = figY + 82;
  const limit = h * 0.7; // the button zone lives below this line
  const rowH = Math.min(27, Math.max(17, (limit - helpTop - 6) / Math.max(1, rows - 1)));
  const helpSize = Math.max(12.5, Math.min(15.5, rowH * 0.6));
  let y = helpTop;
  ctx.font = `500 ${helpSize}px system-ui, sans-serif`;
  ctx.fillStyle = '#e8ecf4';
  for (const line of lines) {
    ctx.fillText(line, cx, y);
    y += rowH;
  }
  if (showSave) {
    ctx.font = `700 ${Math.max(13, Math.min(16, rowH * 0.64))}px system-ui, sans-serif`;
    ctx.fillStyle = '#7dff8a';
    ctx.fillText(t('title.savedRun', { money: save.money, jobs: jobsDone }), cx, y);
    y += rowH;
  }
  if (showReset) {
    ctx.font = `500 ${Math.max(11.5, Math.min(12.5, rowH * 0.5))}px system-ui, sans-serif`;
    if (g.resetArm?.armed) {
      ctx.fillStyle = '#ff8a7a';
      ctx.fillText(t('title.resetArmed.mobile'), cx, y);
    } else {
      ctx.fillStyle = '#8b93a5';
      ctx.fillText(t('title.resetHint.mobile'), cx, y);
    }
  }
  // The footer shares the bottom-left corner with the DOM reset button;
  // when that button is up, the line would slide underneath it, so it
  // only draws on a fresh (no-progress) title.
  if (!showReset) {
    ctx.font = '500 12px system-ui, sans-serif';
    ctx.fillStyle = '#aab3c5';
    ctx.fillText(t('title.footer.mobile'), cx, h - 22);
  }
}

function drawTitle(g, ctx) {
  if (g.mobile) {
    drawTitleMobile(g, ctx);
    return;
  }
  const { viewW: w, viewH: h } = g;
  ctx.fillStyle = 'rgba(16,20,34,0.55)';
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd94d';
  ctx.font = '900 76px system-ui, sans-serif';
  ctx.lineWidth = 12;
  ctx.strokeStyle = '#17181c';
  ctx.strokeText('THE STICK MAN', cx, 128);
  ctx.fillText('THE STICK MAN', cx, 128);
  ctx.font = '600 21px system-ui, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(t('title.subtitle.desktop'), cx, 164);
  logoFigure(ctx, cx - 120, 268, 1.25, '#ffffff', 'grin');
  logoFigure(ctx, cx + 120, 268, 1.25, '#17181c', 'flat');
  ctx.font = '500 19px system-ui, sans-serif';
  ctx.fillStyle = '#e8ecf4';
  const lines = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => t(`help.desktop.${i}`));
  lines.forEach((line, i) => ctx.fillText(line, cx, 350 + i * 28));
  const save = g.saveData;
  ctx.font = '700 22px system-ui, sans-serif';
  ctx.fillStyle = '#7dff8a';
  const jobsDone = save && Array.isArray(save.missionsDone) ? save.missionsDone.length : 0;
  if (save && (save.money > 0 || jobsDone > 0)) {
    ctx.fillText(t('title.continueRun', { money: save.money, jobs: jobsDone }), cx, 350 + lines.length * 28 + 26);
  } else {
    ctx.fillText(t('title.pressEnter'), cx, 350 + lines.length * 28 + 26);
  }
  if (hasProgress(save)) {
    ctx.font = '600 16px system-ui, sans-serif';
    if (g.resetArm?.armed) {
      ctx.fillStyle = '#ff8a7a';
      ctx.fillText(t('title.resetArmed.desktop'), cx, 350 + lines.length * 28 + 58);
    } else {
      ctx.fillStyle = '#8b93a5';
      ctx.fillText(t('title.resetHint.desktop'), cx, 350 + lines.length * 28 + 58);
    }
  }
  ctx.font = '500 15px system-ui, sans-serif';
  ctx.fillStyle = '#aab3c5';
  ctx.fillText(t('title.footer.desktop'), cx, h - 26);
}

/** Word-wrap a line of text to a pixel width; returns the wrapped lines. */
function wrapText(ctx, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxW) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function drawEndScreen(g, ctx, title, color, sub) {
  const { viewW: w, viewH: h } = g;
  ctx.fillStyle = 'rgba(10,10,18,0.62)';
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  const titleSize = g.mobile ? Math.min(64, w * 0.16) : 84;
  ctx.font = `900 ${titleSize}px system-ui, sans-serif`;
  ctx.lineWidth = 13;
  ctx.strokeStyle = '#17181c';
  ctx.fillStyle = color;
  ctx.strokeText(title, w / 2, h / 2 - 30);
  ctx.fillText(title, w / 2, h / 2 - 30);
  ctx.font = `600 ${g.mobile ? 16 : 22}px system-ui, sans-serif`;
  ctx.fillStyle = '#ffffff';
  if (g.mobile) {
    wrapText(ctx, sub, w - 40).forEach((line, i) => ctx.fillText(line, w / 2, h / 2 + 16 + i * 23));
  } else {
    ctx.fillText(sub, w / 2, h / 2 + 22);
    ctx.font = '700 20px system-ui, sans-serif';
    ctx.fillStyle = '#7dff8a';
    ctx.fillText(t('end.pressEnter'), w / 2, h / 2 + 62);
  }
}

/**
 * Off-screen traffic warnings (vehicles.js fills g.trafficWarn each
 * frame, on foot only): one triangle per unseen car that is close and
 * closing, sitting on the screen edge in the car's direction and
 * pointing in at it. Amber while there is still time to step aside,
 * flashing red once the car is about to arrive; the marker grows a
 * little with urgency. A pure icon — no text, so nothing to translate.
 */
function drawTrafficWarnings(g, ctx) {
  const warns = g.trafficWarn;
  if (!warns || warns.length === 0 || g.state !== 'play') return;
  const { viewW: w, viewH: h } = g;
  const inset = g.mobile ? 15 : 24;
  const cx = w / 2;
  const cy = h / 2;
  const hx = Math.max(30, cx - inset);
  const hy = Math.max(30, cy - inset);
  for (const warn of warns) {
    const dx = Math.cos(warn.angle);
    const dy = Math.sin(warn.angle);
    // Where the ray from the screen centre along the car's screen
    // direction meets the inset rectangle: that edge point is home.
    const tx = dx !== 0 ? hx / Math.abs(dx) : Infinity;
    const ty = dy !== 0 ? hy / Math.abs(dy) : Infinity;
    const tEdge = Math.min(tx, ty);
    const ex = cx + dx * tEdge;
    const ey = cy + dy * tEdge;
    const urgent = warn.urgency > 0.62;
    const s = 11 + warn.urgency * 5;
    ctx.save();
    ctx.globalAlpha = urgent ? (Math.floor(g.time * 6) % 2 === 0 ? 1 : 0.4) : 0.9;
    ctx.translate(ex, ey);
    ctx.rotate(Math.atan2(-dy, -dx)); // the tip points back toward the centre
    ctx.beginPath();
    ctx.moveTo(s, 0);
    ctx.lineTo(-s * 0.75, s * 0.62);
    ctx.lineTo(-s * 0.75, -s * 0.62);
    ctx.closePath();
    ctx.fillStyle = urgent ? '#ff4747' : '#ffb02e';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(10,10,18,0.75)';
    ctx.stroke();
    ctx.restore();
  }
}

/** Draw everything for the current frame. */
export function drawHUD(g) {
  const ctx = g.hudCtx;
  const { viewW: w, viewH: h } = g;
  ctx.clearRect(0, 0, w, h);
  if (g.state === 'title') {
    drawTitle(g, ctx);
    return;
  }
  if (g.state === 'busted') {
    drawEndScreen(g, ctx, t('busted.title'), '#5aa2ff', t('busted.sub', { fine: g.lastFine }));
    return;
  }
  if (g.state === 'wasted') {
    drawEndScreen(g, ctx, t('wasted.title'), '#ff5a4d', t('wasted.sub', { fine: g.lastFine }));
    return;
  }

  // Money and health, top-left.
  ctx.textAlign = 'left';
  ctx.font = '800 30px system-ui, sans-serif';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(10,14,10,0.7)';
  ctx.fillStyle = '#7dff8a';
  const moneyText = `$ ${g.money.toLocaleString('en-US')}`;
  ctx.strokeText(moneyText, 18, 40);
  ctx.fillText(moneyText, 18, 40);
  // Health bar.
  const hpW = 190;
  roundRect(ctx, 18, 54, hpW, 16, 5);
  ctx.fillStyle = 'rgba(10,10,16,0.6)';
  ctx.fill();
  roundRect(ctx, 20, 56, (hpW - 4) * Math.max(0, g.player.hp / PLAYER.maxHp), 12, 4);
  ctx.fillStyle = g.player.hp > 30 ? '#51cf66' : '#ff5a4d';
  ctx.fill();
  ctx.font = '700 12px system-ui, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('HP', 24, 66);
  if (g.player.state === 'car' && g.player.car) {
    roundRect(ctx, 18, 76, hpW, 10, 4);
    ctx.fillStyle = 'rgba(10,10,16,0.55)';
    ctx.fill();
    roundRect(ctx, 20, 78, (hpW - 4) * Math.max(0, g.player.car.hp / 100), 6, 3);
    ctx.fillStyle = '#9aa3ad';
    ctx.fill();
    ctx.fillStyle = '#dfe5ee';
    ctx.fillText(t('hud.car'), 24, 85);
  }
  if (g.player.state === 'foot') {
    // Dash cooldown pip: full and gold when the burst is ready, refilling
    // while it cools. (On touch the DASH button dims the same way.)
    const cd = g.player.dashCd ?? 0;
    const frac = 1 - Math.min(1, cd / PLAYER.dashCooldown);
    roundRect(ctx, 18, 76, 92, 10, 4);
    ctx.fillStyle = 'rgba(10,10,16,0.55)';
    ctx.fill();
    roundRect(ctx, 20, 78, 88 * frac, 6, 3);
    ctx.fillStyle = frac >= 1 ? '#ffd94d' : '#8b93a5';
    ctx.fill();
    ctx.fillStyle = '#dfe5ee';
    ctx.fillText(t('hud.dash'), 24, 85);
  }
  if (g.player.hasPistol) {
    ctx.font = '700 14px system-ui, sans-serif';
    ctx.fillStyle = '#ffd94d';
    ctx.fillText(t(g.mobile ? 'hud.pistol.mobile' : 'hud.pistol.desktop'), 18, 104);
  }
  if (g.toast && g.toast.t > 0) {
    ctx.font = '800 20px system-ui, sans-serif';
    ctx.fillStyle = '#7dff8a';
    ctx.globalAlpha = Math.min(1, g.toast.t);
    ctx.fillText(g.toast.text, 18, 132);
    ctx.globalAlpha = 1;
  }

  // Wanted stars, top-right, with the heat bar under them. While the heat
  // is actively cooling (no police unit close enough to watch — police.js
  // sets g.cooling only while heat is really draining), the lit stars
  // pulse gold-to-grey: the classic "you are losing them" signal, driven
  // by the true cooling state, never by a guessed timer.
  const stars = starsFor(g.heat);
  const blinkOff = g.cooling && Math.floor(g.time * 2.6) % 2 === 1;
  for (let i = 0; i < 5; i += 1) {
    star(ctx, w - 34 - i * 38, 34, 15, true, i < stars && !blinkOff);
  }
  if (g.heat > 0) {
    const next = HEAT_THRESHOLDS[stars] ?? HEAT_THRESHOLDS[HEAT_THRESHOLDS.length - 1];
    const prev = stars > 0 ? HEAT_THRESHOLDS[stars - 1] : 0;
    const frac = Math.max(0, Math.min(1, (g.heat - prev) / (next - prev)));
    roundRect(ctx, w - 34 - 4 * 38 - 15, 56, 5 * 38 - 8, 6, 3);
    ctx.fillStyle = 'rgba(10,10,16,0.55)';
    ctx.fill();
    roundRect(ctx, w - 34 - 4 * 38 - 15, 56, (5 * 38 - 8) * frac, 6, 3);
    ctx.fillStyle = '#ffd94d';
    ctx.fill();
  }
  if (g.cooling && g.heat > 0) {
    ctx.font = '700 12.5px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,217,77,0.92)';
    ctx.textAlign = 'right';
    ctx.fillText(t('hud.losing'), w - 19, 80);
    ctx.textAlign = 'left';
  }

  // Objective, top-center (shrinks to fit narrow phone screens). When the
  // step has a place, a distance readout rides along ("… — 120m", 10 world
  // units to the metre) so the player can tell near from far at a glance.
  let objective = objectiveText(g);
  const target = objective ? objectiveTarget(g) : null;
  if (objective && target) {
    const dist = Math.hypot(g.player.x - target.x, g.player.y - target.y);
    objective = `${objective} — ${Math.round(dist / 10)}m`;
  }
  if (objective) {
    // Phones: below the money/stars row, and narrower than the screen so the
    // banner never slides under the pause button at the top-right.
    const maxTw = g.mobile ? w - 108 : w - 30;
    let objSize = 17;
    ctx.font = `600 ${objSize}px system-ui, sans-serif`;
    while (objSize > 11 && ctx.measureText(`▸ ${objective}`).width + 34 > maxTw) {
      objSize -= 1.5;
      ctx.font = `600 ${objSize}px system-ui, sans-serif`;
    }
    const tw = Math.min(maxTw, ctx.measureText(objective).width + 34);
    const oy = g.mobile ? 84 : 14;
    const ocx = g.mobile ? 12 + maxTw / 2 : w / 2;
    roundRect(ctx, ocx - tw / 2, oy, tw, 32, 9);
    ctx.fillStyle = 'rgba(12,16,26,0.72)';
    ctx.fill();
    ctx.fillStyle = '#ffd94d';
    ctx.textAlign = 'center';
    ctx.fillText(`▸ ${objective}`, ocx, oy + 22);
    ctx.textAlign = 'left';
  }

  // Bust meter under the objective.
  if (g.bustProgress > 0.04 && g.stars > 0) {
    const bw = 240;
    const by = g.mobile ? 124 : 56;
    roundRect(ctx, (w - bw) / 2, by, bw, 15, 6);
    ctx.fillStyle = 'rgba(10,10,16,0.65)';
    ctx.fill();
    roundRect(ctx, (w - bw) / 2 + 2, by + 2, (bw - 4) * (g.bustProgress / g.bustMax), 11, 5);
    ctx.fillStyle = '#5aa2ff';
    ctx.fill();
    ctx.font = '800 12px system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(t('hud.bustedMeter'), w / 2, by + 12);
    ctx.textAlign = 'left';
  }

  // Message banner.
  if (g.message && g.message.t > 0) {
    const m = g.message;
    const alpha = Math.min(1, m.t / 0.5, (m.dur - (m.dur - m.t)) / 0.001 + 1);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.textAlign = 'center';
    const mk = g.mobile ? Math.min(1, w / 760) : 1;
    // Phones: the banner drops below the minimap so the map never covers it.
    const my = g.mobile ? 266 : 138;
    ctx.font = `900 ${Math.round(40 * mk)}px system-ui, sans-serif`;
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(10,10,18,0.8)';
    ctx.fillStyle = '#ffffff';
    ctx.strokeText(m.title, w / 2, my);
    ctx.fillText(m.title, w / 2, my);
    if (m.sub) {
      ctx.font = `600 ${Math.round(19 * mk)}px system-ui, sans-serif`;
      ctx.lineWidth = 6;
      if (g.mobile) {
        wrapText(ctx, m.sub, w - 36).forEach((line, i) => {
          ctx.strokeText(line, w / 2, my + 30 + i * 20);
          ctx.fillText(line, w / 2, my + 30 + i * 20);
        });
      } else {
        ctx.strokeText(m.sub, w / 2, 168);
        ctx.fillText(m.sub, w / 2, 168);
      }
    }
    ctx.restore();
    ctx.textAlign = 'left';
  }

  // Interaction prompt, bottom-center. On phones the "E — …" prompts live on
  // the USE button instead, so only other prompts (the spray garage) draw here,
  // lifted clear of the button cluster.
  if (g.prompt && !(g.mobile && g.prompt.startsWith(PROMPT_PREFIX))) {
    ctx.font = `700 ${g.mobile ? 15.5 : 18}px system-ui, sans-serif`;
    const tw = ctx.measureText(g.prompt).width + 30;
    const py = g.mobile ? h - 178 : h - 52;
    roundRect(ctx, (w - tw) / 2, py, tw, 34, 9);
    ctx.fillStyle = 'rgba(12,16,26,0.78)';
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(g.prompt, w / 2, py + 23);
    ctx.textAlign = 'left';
  }

  drawMinimap(g, ctx);

  drawTrafficWarnings(g, ctx);

  if (g.state === 'paused') {
    ctx.fillStyle = 'rgba(10,12,20,0.6)';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.font = `900 ${g.mobile ? 42 : 54}px system-ui, sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(t('pause.title'), w / 2, h / 2 - 10);
    ctx.font = `600 ${g.mobile ? 15 : 18}px system-ui, sans-serif`;
    ctx.fillStyle = '#c8d2e0';
    ctx.fillText(
      t(g.mobile ? 'pause.hint.mobile' : 'pause.hint.desktop'),
      w / 2, h / 2 + 26,
    );
    if (hasProgress(g.saveData)) {
      ctx.font = `600 ${g.mobile ? 13 : 16}px system-ui, sans-serif`;
      if (g.resetArm?.armed) {
        ctx.fillStyle = '#ff8a7a';
        ctx.fillText(
          t(g.mobile ? 'pause.resetArmed.mobile' : 'pause.resetArmed.desktop'),
          w / 2, h / 2 + 58,
        );
      } else {
        ctx.fillStyle = '#8b93a5';
        ctx.fillText(
          t(g.mobile ? 'pause.resetHint.mobile' : 'pause.resetHint.desktop'),
          w / 2, h / 2 + 58,
        );
      }
    }
    ctx.textAlign = 'left';
  }
}
