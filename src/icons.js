/*!
 * 码上动 · 三维动作创作工作台
 * 项目开发与维护署名：黄啊码
 * @author 黄啊码
 * https://github.com/huangama666/mashangdong
 */
const wrap = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  inspector: wrap('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16M17 8h1M17 12h1M17 16h1"/>'),
  cube: wrap('<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>'),
  cuboid: wrap('<path d="m8 4 13 4v10l-6 3-13-4V7Z"/><path d="m2 7 13 4 6-3M15 11v10"/>'),
  cylinder: wrap('<ellipse cx="12" cy="5.5" rx="7.5" ry="3"/><path d="M4.5 5.5v13c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-13"/><path d="M4.5 15.5c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>'),
  sphere: wrap('<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4.2" ry="9"/><path d="M3 12h18M4.7 7h14.6M4.7 17h14.6"/>'),
  film: wrap('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/><path d="m10 9 4 3-4 3Z"/>'),
  logo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12.4" cy="4.4" r="2.2"/><path d="M12 7.2v5.3"/><path d="M12 12.5 7.2 15l-1.4 4.6"/><path d="M12 12.5l4.2 2.2 1 4.9"/><path d="M12 8.5 8.6 11"/><path d="M12 8.6l3.9-1.4 2.3 2.2"/></svg>`,
  addUser: wrap('<circle cx="10" cy="8" r="3.3"/><path d="M4 19.5c0-3.1 2.7-5.5 6-5.5 1.4 0 2.7.4 3.7 1.2"/><path d="M18 13v6"/><path d="M15 16h6"/>'),
  poses: wrap('<circle cx="12" cy="4.6" r="2.1"/><path d="M12 7.4v6.2"/><path d="M12 9.4 8.3 6.9"/><path d="M12 9.4l3.3 3.1"/><path d="M12 13.6 8.6 20"/><path d="M12 13.6 15.4 20"/>'),
  camera: wrap('<path d="M4 8.5h2.6l1.4-2h8l1.4 2H20a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13.5" r="3.2"/>'),
  view: wrap('<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9"/><path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9"/><path d="M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15"/><path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/><circle cx="12" cy="12" r="2.4"/>'),
  settings: wrap('<path d="M4 7h10"/><path d="M18 7h2"/><circle cx="16" cy="7" r="2"/><path d="M4 17h4"/><path d="M12 17h8"/><circle cx="10" cy="17" r="2"/><path d="M4 12h6"/><path d="M14 12h6"/><circle cx="12" cy="12" r="1.6"/>'),
  help: wrap('<circle cx="12" cy="12" r="8.6"/><path d="M9.7 9.4a2.4 2.4 0 1 1 3.5 2.2c-.8.4-1.2 1-1.2 1.9"/><circle cx="12" cy="16.6" r=".9" fill="currentColor" stroke="none"/>'),
  undo: wrap('<path d="M9 8 4.5 12.5 9 17"/><path d="M4.5 12.5H14a5 5 0 0 1 0 10h-2"/>'),
  redo: wrap('<path d="m15 8 4.5 4.5L15 17"/><path d="M19.5 12.5H10a5 5 0 0 0 0 10h2"/>'),
  close: wrap('<path d="m6 6 12 12"/><path d="M18 6 6 18"/>'),
  duplicate: wrap('<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M15 5.5A1.5 1.5 0 0 0 13.5 4H6a2 2 0 0 0-2 2v7.5A1.5 1.5 0 0 0 5.5 15"/>'),
  trash: wrap('<path d="M4 7h16"/><path d="M9 7V4.8A.8.8 0 0 1 9.8 4h4.4a.8.8 0 0 1 .8.8V7"/><path d="m6.5 7 .8 12a1 1 0 0 0 1 .9h7.4a1 1 0 0 0 1-.9L17.5 7"/><path d="M10 11v5"/><path d="M14 11v5"/>'),
  plus: wrap('<path d="M12 5v14"/><path d="M5 12h14"/>'),
  male: wrap('<circle cx="10" cy="14" r="5"/><path d="M13.6 10.4 19 5"/><path d="M15 5h4v4"/>'),
  female: wrap('<circle cx="12" cy="9.5" r="5"/><path d="M12 14.5V21"/><path d="M9 18h6"/>'),
  boy: wrap('<circle cx="12" cy="6.4" r="2.5"/><path d="M12 8.9v5.4"/><path d="M12 10.4 9.1 12"/><path d="M12 10.4l2.9 1.6"/><path d="M12 14.3 9.9 20"/><path d="M12 14.3 14.1 20"/>'),
  lizard: wrap('<path d="M2 18c4 0 2-8 8-8h5l3-3 4 2-3 3h-5c-4 0-3 8-7 8"/><path d="m10 10-2-4-3 1m6 6-1 4 3 2m4-9 1-5 3-1m-5 8 2 4 3-1"/><circle cx="19" cy="9" r=".5"/>'),
  bird: wrap('<path d="M12 14C8 8 4 7 2 8c1 5 5 7 9 8m2-2c3-6 6-7 9-6-1 5-5 7-9 8"/><path d="m10 18 2-5 2 5m-2-5V9c0-3 4-4 5-1l2 1-3 1"/><path d="m10 18-1 3 3-1 3 1-1-3"/>'),
  check: wrap('<path d="m5 12.5 4.2 4.2L19 7"/>'),
  target: wrap('<circle cx="12" cy="12" r="7.2"/><circle cx="12" cy="12" r="2.6"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  flag: wrap('<path d="M6 21V4"/><path d="M6 4.5c3-1.6 6 1.6 9 0v7c-3 1.6-6-1.6-9 0"/>'),
  bookmark: wrap('<path d="M6.5 4.2h11a.8.8 0 0 1 .8.8v15l-6.3-4.4L5.7 20V5a.8.8 0 0 1 .8-.8Z"/>'),
  move: wrap('<path d="M12 3v18"/><path d="M3 12h18"/><path d="m9 6 3-3 3 3"/><path d="m9 18 3 3 3-3"/><path d="m6 9-3 3 3 3"/><path d="m18 9 3 3-3 3"/>'),
  rotate: wrap('<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4.2h-4.2"/>'),
};

export function mountIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    const icon = ICONS[el.getAttribute('data-icon')];
    if (icon) el.innerHTML = icon;
  });
}
