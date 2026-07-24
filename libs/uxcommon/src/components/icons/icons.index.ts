/****************************************************** */
/*
/* Look at https://heroicons.com for icons. Most of these
/* are from the Heroicons set, some are custom.
/*
/****************************************************** */
export type PcIconNameType = keyof typeof icons;

export async function loadIconSvg(name: PcIconNameType): Promise<string> {
  let cached = _cache.get(name);
  if (!cached) {
    cached = resolveIconSvg(name);
    _cache.set(name, cached);
  }
  return cached;
}

async function resolveIconSvg(name: PcIconNameType): Promise<string> {
  const svg = await fetchSvg(icons[name]);
  if (svg != null) return svg;
  // Fall back to the generic unknown glyph — but only if it itself is a real SVG.
  if (name !== UNKNOWN) {
    const fallback = await loadIconSvg(UNKNOWN);
    if (fallback) return fallback;
  }
  // Nothing usable (e.g. the assets aren't being served): render nothing rather than
  // injecting a dev-server 404 page ("Cannot GET /assets/icons/unknown.svg") as markup.
  return '';
}

/** Fetch an icon and return its text only if it is actually an SVG, else null. */
async function fetchSvg(url: string): Promise<string | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const text = await r.text();
    return text.trimStart().startsWith('<svg') ? text : null;
  } catch {
    return null;
  }
}

const UNKNOWN: PcIconNameType = 'unknown';

/** Optional: load SVG text when you need to inline it (works with Tailwind/DaisyUI) */
const _cache = new Map<PcIconNameType, Promise<string>>();

export const icons = {
  none: 'none',
  'add-company': 'assets/icons/add-company.svg',
  'add-form': 'assets/icons/add-form.svg',
  'add-group': 'assets/icons/add-group.svg',
  'add-home': 'assets/icons/add-home.svg',
  'add-issue': 'assets/icons/add-issue.svg',
  'add-label': 'assets/icons/add-label.svg',
  'add-list': 'assets/icons/add-list.svg',
  'add-newsletter': 'assets/icons/add-newsletter.svg',
  'add-notes': 'assets/icons/add-notes.svg',
  'add-schedule': 'assets/icons/add-schedule.svg',
  'add-task': 'assets/icons/add-task.svg',
  'add-ticket': 'assets/icons/add-ticket.svg',
  'add-users': 'assets/icons/add-users.svg',
  'add-volunteer': 'assets/icons/add-volunteer.svg',
  'add-fundraising': 'assets/icons/add-fundraising.svg',
  'adjustments-horizontal': 'assets/icons/adjustments-horizontal.svg',
  'archive-box': 'assets/icons/archive-box.svg',
  'archive-box-arrow-down': 'assets/icons/archive-box-arrow-down.svg',
  'arrow-down-tray': 'assets/icons/arrow-down-tray.svg',
  'arrow-left': 'assets/icons/arrow-left.svg',
  'arrow-left-start-on-rectangle': 'assets/icons/arrow-left-start-on-rectangle.svg',
  'arrow-menu-open': 'assets/icons/arrow-menu-open.svg',
  'arrow-menu-close': 'assets/icons/arrow-menu-close.svg',
  'arrow-path': 'assets/icons/arrow-path.svg',
  'arrow-right-end-on-rectangle': 'assets/icons/arrow-right-end-on-rectangle.svg',
  'arrow-right-start-on-rectangle': 'assets/icons/arrow-right-start-on-rectangle.svg',
  'arrow-top-right-on-square': 'assets/icons/arrow-top-right-on-square.svg',
  'arrow-up-tray': 'assets/icons/arrow-up-tray.svg',
  'arrow-uturn-left': 'assets/icons/arrow-uturn-left.svg',
  'arrow-uturn-right': 'assets/icons/arrow-uturn-right.svg',
  'arrows-pointing-in': 'assets/icons/arrows-pointing-in.svg',
  'arrows-pointing-out': 'assets/icons/arrows-pointing-out.svg',
  'arrows-up-down-tray': 'assets/icons/arrows-up-down-tray.svg',
  'at-symbol': 'assets/icons/at-symbol.svg',
  'attach-fat': 'assets/icons/attach-fat.svg',
  'attach-file-off': 'assets/icons/attach-file-off.svg',
  banknotes: 'assets/icons/banknotes.svg',
  'bars-3': 'assets/icons/bars-3.svg',
  'bars-4': 'assets/icons/bars-4.svg',
  bell: 'assets/icons/bell.svg',
  bookmark: 'assets/icons/bookmark.svg',
  'bookmark-plus': 'assets/icons/bookmark-plus.svg',
  'bookmark-filled': 'assets/icons/bookmark-filled.svg',
  'bookmark-slash': 'assets/icons/bookmark-slash.svg',
  'bug-ant': 'assets/icons/bug-ant.svg',
  briefcase: 'assets/icons/briefcase.svg',
  calendar: 'assets/icons/calendar.svg',
  'chart-pie': 'assets/icons/chart-pie.svg',
  'check-circle': 'assets/icons/check-circle.svg',
  'chat-bubble-bottom-center-text': 'assets/icons/chat-bubble-bottom-center-text.svg',
  'chevron-double-left': 'assets/icons/chevron-double-left.svg',
  'chevron-double-right': 'assets/icons/chevron-double-right.svg',
  'chevron-down': 'assets/icons/chevron-down.svg',
  'chevron-left': 'assets/icons/chevron-left.svg',
  'chevron-right': 'assets/icons/chevron-right.svg',
  'chevron-up': 'assets/icons/chevron-up.svg',
  'clipboard-document-list': 'assets/icons/clipboard-document-list.svg',
  clock: 'assets/icons/clock.svg',
  'cloud-arrow-up': 'assets/icons/cloud-arrow-up.svg',
  cog: 'assets/icons/cog.svg',
  'cog-6-tooth': 'assets/icons/cog-6-tooth.svg',
  'collapse-content': 'assets/icons/collapse-content.svg',
  'credit-card': 'assets/icons/credit-card.svg',
  'currency-dollar': 'assets/icons/currency-dollar.svg',
  document: 'assets/icons/document.svg',
  'document-check': 'assets/icons/document-check.svg',
  'document-currency-dollar': 'assets/icons/document-currency-dollar.svg',
  'document-duplicate': 'assets/icons/document-duplicate.svg',
  'document-text': 'assets/icons/document-text.svg',
  'ellipsis-vertical': 'assets/icons/ellipsis-vertical.svg',
  envelope: 'assets/icons/envelope.svg',
  'exclamation-circle': 'assets/icons/exclamation-circle.svg',
  'exclamation-triangle': 'assets/icons/exclamation-triangle.svg',
  'expand-content': 'assets/icons/expand-content.svg',
  eye: 'assets/icons/eye.svg',
  'eye-slash': 'assets/icons/eye-slash.svg',
  facebook: 'assets/icons/facebook.svg',
  file: 'assets/icons/file.svg',
  'file-archive': 'assets/icons/file-archive.svg',
  'file-audio': 'assets/icons/file-audio.svg',
  'file-calendar': 'assets/icons/file-calendar.svg',
  'file-code': 'assets/icons/file-code.svg',
  'file-contact': 'assets/icons/file-contact.svg',
  'file-db': 'assets/icons/file-db.svg',
  'file-design': 'assets/icons/file-design.svg',
  'file-disk': 'assets/icons/file-disk.svg',
  'file-doc': 'assets/icons/file-doc.svg',
  'file-ebook': 'assets/icons/file-ebook.svg',
  'file-email': 'assets/icons/file-email.svg',
  'file-exe': 'assets/icons/file-exe.svg',
  'file-font': 'assets/icons/file-font.svg',
  'file-image': 'assets/icons/file-image.svg',
  'file-pdf': 'assets/icons/file-pdf.svg',
  'file-sheet': 'assets/icons/file-sheet.svg',
  'file-slides': 'assets/icons/file-slides.svg',
  'file-text': 'assets/icons/file-text.svg',
  'file-video': 'assets/icons/file-video.svg',
  filter: 'assets/icons/funnel.svg',
  forward: 'assets/icons/forward.svg',
  funnel: 'assets/icons/funnel.svg',
  'globe-americas': 'assets/icons/globe-americas.svg',
  hashtag: 'assets/icons/hashtag.svg',
  home: 'assets/icons/home.svg',
  'house-modern': 'assets/icons/house-modern.svg',
  identification: 'assets/icons/identification.svg',
  inbox: 'assets/icons/inbox.svg',
  'inbox-stack': 'assets/icons/inbox-stack.svg',
  'information-circle': 'assets/icons/information-circle.svg',
  instagram: 'assets/icons/instagram.svg',
  label: 'assets/icons/label.svg',
  linkedin: 'assets/icons/linkedin.svg',
  'lock-closed': 'assets/icons/lock-closed.svg',
  'magnifying-glass': 'assets/icons/magnifying-glass.svg',
  mailbox: 'assets/icons/mailbox.svg',
  map: 'assets/icons/map.svg',
  'map-pin': 'assets/icons/map-pin.svg',
  megaphone: 'assets/icons/megaphone.svg',
  message: 'assets/icons/message.svg',
  'menu-open': 'assets/icons/menu-open.svg',
  merge: 'assets/icons/merge.svg',
  moon: 'assets/icons/moon.svg',
  notification: 'assets/icons/notification.svg',
  'paper-airplane': 'assets/icons/paper-airplane.svg',
  'paper-clip': 'assets/icons/paper-clip.svg',
  'pencil-square': 'assets/icons/pencil-square.svg',
  plus: 'assets/icons/plus.svg',
  'presentation-chart-line': 'assets/icons/presentation-chart-line.svg',
  print: 'assets/icons/print.svg',
  'queue-list': 'assets/icons/queue-list.svg',
  'rectangle-stack': 'assets/icons/rectangle-stack.svg',
  'redo-fat': 'assets/icons/redo-fat.svg',
  route: 'assets/icons/route.svg',
  reply: 'assets/icons/reply.svg',
  'reply-all': 'assets/icons/reply-all.svg',
  'restore-from-trash': 'assets/icons/restore-from-trash.svg',
  save: 'assets/icons/save.svg',
  'shield-exclamation': 'assets/icons/shield-exclamation.svg',
  'square-3-stack-3d': 'assets/icons/square-3-stack-3d.svg',
  star: 'assets/icons/star.svg',
  'star-filled': 'assets/icons/star-filled.svg',
  sun: 'assets/icons/sun.svg',
  'table-cells': 'assets/icons/table-cells.svg',
  phone: 'assets/icons/phone.svg',
  tag: 'assets/icons/tag.svg',
  task: 'assets/icons/task.svg',
  ticket: 'assets/icons/ticket.svg',
  trash: 'assets/icons/trash.svg',
  'trash-forever': 'assets/icons/trash-forever.svg',
  'undo-fat': 'assets/icons/undo-fat.svg',
  unknown: 'assets/icons/unknown.svg',
  'user-circle': 'assets/icons/user-circle.svg',
  'user-group': 'assets/icons/user-group.svg',
  'user-plus': 'assets/icons/user-plus.svg',
  users: 'assets/icons/users.svg',
  'view-column': 'assets/icons/view-column.svg',
  'view-kanban': 'assets/icons/view-kanban.svg',
  volunteer: 'assets/icons/volunteer.svg',
  'wrench-screwdriver': 'assets/icons/wrench-screwdriver.svg',
  'x-circle': 'assets/icons/x-circle.svg',
  x: 'assets/icons/x.svg',
  'x-mark': 'assets/icons/x-mark.svg',
} as const;
