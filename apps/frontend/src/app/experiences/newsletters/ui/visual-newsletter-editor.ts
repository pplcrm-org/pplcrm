import { CdkDrag, CdkDragHandle, CdkDragPlaceholder, CdkDropList, type CdkDragDrop } from '@angular/cdk/drag-drop';
import { CdkScrollable } from '@angular/cdk/scrolling';
import {
  Component,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  inject,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { Icon } from '@icons/icon';
import type { PcIconNameType } from '@icons/icons.index';
import { TabBar, type PcTabOption } from '@uxcommon/components/tabs/tabs';

import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { SettingsService } from '../../settings/services/settings-service';
import {
  createBlock,
  insertBlockAt,
  isEmailBlockType,
  moveBlock,
  tryImportHtmlToBlocks,
  type EmailBlockType,
} from './newsletter-block-ops';
import {
  EmailBlock,
  socialSvgPaths,
  getSocialBgColor,
  getSocialIconColor,
  getTemplateBlocks,
  compileBlocksToHtml,
  compileBlocksToPlainText,
} from './newsletter-templates';

/**
 * The block-model JSON comment the compiled document embeds. ngOnInit rebuilds the visual design
 * from it, so it must not survive a hand edit of the HTML (the send path strips it as well, in
 * lib/mail/newsletter-render.ts).
 */
const BLOCK_DATA_COMMENT_RE = /<!--\s*PPLCRM_VISUAL_BLOCKS_DATA:[\s\S]*?-->/g;

/** One merge field in the quick-insert panel; clicking the chip drops `{name}` at the caret. */
interface MergeVariable {
  name: string;
  label: string;
}

/** One palette entry: the tile in the Blocks tab and the "+" insert menu both render from this. */
interface PaletteEntry {
  type: EmailBlockType;
  label: string;
  icon: PcIconNameType;
  iconClass: string;
}

@Component({
  selector: 'pc-visual-newsletter-editor',
  imports: [Icon, TabBar, CdkDropList, CdkDrag, CdkDragHandle, CdkDragPlaceholder, CdkScrollable],
  templateUrl: './visual-newsletter-editor.html',
})
export class VisualNewsletterEditorComponent implements OnInit {
  public readonly htmlContent = model<string>('');
  public readonly plainTextContent = model<string>('');

  protected readonly blocks = signal<EmailBlock[]>([]);
  protected readonly selectedBlockId = signal<string | null>(null);
  protected readonly previewMode = signal<'desktop' | 'mobile'>('desktop');
  protected readonly editorMode = signal<'visual' | 'code'>('visual');
  protected readonly activeTab = signal<'blocks' | 'edit'>('blocks');

  /**
   * Exactly what the code view's textarea holds. Kept separate from `htmlContent` because the
   * saved HTML has the block-data comment stripped out of it (see handleRawHtmlEdit) — binding the
   * textarea to the saved value would rewrite the text under the user's cursor as they type.
   */
  protected readonly rawHtmlDraft = signal<string>('');

  /** True once the HTML has been hand-edited in the code view, so it is no longer the compiled
   * output of `blocks()` and switching back to visual would replace the user's own markup. */
  protected readonly rawHtmlEdited = signal(false);

  /** Seam index whose "+" insert picker is open, or null when closed. */
  protected readonly insertMenuIndex = signal<number | null>(null);

  /** The 7 block types: palette tiles and the "+" insert menu share this list. */
  protected readonly paletteTypes: readonly PaletteEntry[] = [
    { type: 'heading', label: 'Heading', icon: 'document-text', iconClass: 'text-primary' },
    { type: 'text', label: 'Paragraph', icon: 'document-text', iconClass: 'text-success' },
    { type: 'image', label: 'Image', icon: 'file-image', iconClass: 'text-warning' },
    { type: 'button', label: 'CTA Button', icon: 'star-filled', iconClass: 'text-info' },
    { type: 'divider', label: 'Divider', icon: 'bars-3', iconClass: 'text-neutral-content' },
    { type: 'spacer', label: 'Spacer', icon: 'arrows-pointing-out', iconClass: '' },
    { type: 'social', label: 'Social Links', icon: 'user-group', iconClass: 'text-primary' },
  ];

  protected readonly panelTabs: PcTabOption[] = [
    { id: 'blocks', label: 'Blocks' },
    { id: 'edit', label: 'Customize' },
  ];

  protected setPanelTab(tab: string): void {
    if (tab === 'blocks' || tab === 'edit') this.activeTab.set(tab);
  }

  protected readonly socialSvgPaths = socialSvgPaths;
  protected getSocialBgColor(platform: string, style: string) {
    return getSocialBgColor(platform, style);
  }
  protected getSocialIconColor(platform: string, style: string) {
    return getSocialIconColor(platform, style);
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  protected getMockVariableValue(name: string): string | undefined {
    const mocks: Record<string, string> = {
      FirstName: 'John',
      LastName: 'Doe',
      Email: 'john.doe@example.com',
      Company: 'Acme Corporation',
      JobTitle: 'Software Engineer',
      Phone: '(555) 123-4567',
    };
    const key = Object.keys(mocks).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? mocks[key] : undefined;
  }

  protected resolveVariablesForPreview(text: string | undefined, isButton = false): string {
    if (!text) return '';
    const escaped = this.escapeHtml(text);
    return escaped.replace(/\{([a-zA-Z0-9_]+)(?:\|([^}]+))?\}/g, (match, varName, fallback) => {
      const mockValue = this.getMockVariableValue(varName);
      const displayValue = mockValue !== undefined ? mockValue : fallback !== undefined ? fallback : match;
      if (isButton) {
        return `<span class="border-b border-dashed border-current font-semibold" title="Variable: ${match}">${displayValue}</span>`;
      }
      return `<span class="border-b border-dashed border-primary/60 text-primary font-semibold animate-pulse" title="Variable: ${match}">${displayValue}</span>`;
    });
  }

  /** Merge fields offered for heading/paragraph copy. */
  protected readonly textVariables: readonly MergeVariable[] = [
    { name: 'FirstName', label: 'First Name' },
    { name: 'LastName', label: 'Last Name' },
    { name: 'Email', label: 'Email' },
    { name: 'Company', label: 'Company' },
    { name: 'JobTitle', label: 'Job Title' },
    { name: 'Phone', label: 'Phone' },
  ];

  /** A CTA label only ever personalises on identity, so buttons get the first three. */
  protected readonly buttonVariables: readonly MergeVariable[] = this.textVariables.slice(0, 3);

  /** The content input/textarea of the selected block — only one is rendered at a time. */
  private readonly contentField = viewChild<ElementRef<HTMLInputElement | HTMLTextAreaElement>>('contentField');

  private readonly injector = inject(Injector);

  /**
   * Drops `{Variable}` at the caret (replacing any selection) and leaves the caret just after it.
   * The chips suppress mousedown so the field keeps focus; when it doesn't have focus — the user
   * never clicked into it — we append instead of silently writing at position 0.
   */
  protected insertVariable(block: EmailBlock, variableName: string): void {
    const token = `{${variableName}}`;
    const current = block.content ?? '';
    const field = this.contentField()?.nativeElement;
    const focused = field != null && field.ownerDocument.activeElement === field;
    const start = focused ? (field.selectionStart ?? current.length) : current.length;
    const end = focused ? (field.selectionEnd ?? start) : current.length;

    block.content = current.slice(0, start) + token + current.slice(end);
    this.updateBlocks();

    if (!field) return;
    const caret = start + token.length;
    // Angular rewrites [value] on the next render, which would push the caret to the end.
    afterNextRender(
      () => {
        field.focus();
        field.setSelectionRange(caret, caret);
      },
      { injector: this.injector },
    );
  }

  private readonly confirmDlg = inject(ConfirmDialogService);
  private readonly settingsSvc = inject(SettingsService);

  /** Org name shown in the compliance-footer preview (the server appends the real footer at send time). */
  protected readonly footerOrgName = computed(() => {
    const value = this.settingsSvc.snapshotSignal()['organization.name'];
    return typeof value === 'string' ? value.trim() : '';
  });

  /** Org address shown in the compliance-footer preview (the server appends the real one at send time). */
  protected readonly footerAddress = computed(() => {
    const value = this.settingsSvc.snapshotSignal()['organization.address'];
    return typeof value === 'string' ? value.trim() : '';
  });

  /** Tenant footer disclaimer shown in the compliance-footer preview. */
  protected readonly footerDisclaimer = computed(() => {
    const value = this.settingsSvc.snapshotSignal()['communications.footer_disclaimer'];
    return typeof value === 'string' ? value.trim() : '';
  });

  // Computed signals
  protected readonly selectedBlock = computed(() => {
    const id = this.selectedBlockId();
    if (!id) return null;
    return this.blocks().find((b) => b.id === id) ?? null;
  });

  protected readonly compiledHtml = computed(() => {
    return compileBlocksToHtml(this.blocks());
  });

  public ngOnInit(): void {
    // Best-effort fetch of the address/disclaimer for the compliance-footer preview; the
    // preview falls back to guidance copy when the snapshot is unavailable.
    this.settingsSvc.load().catch(() => undefined);

    // Check if the incoming HTML has our saved JSON blocks comment
    const matched = this.htmlContent().match(/<!-- PPLCRM_VISUAL_BLOCKS_DATA: ([\s\S]*?) -->/);
    if (matched && matched[1]) {
      try {
        const decoded = decodeURIComponent(matched[1].trim());
        const parsed = JSON.parse(decoded);
        if (Array.isArray(parsed)) {
          // Older drafts may carry a removable 'footer' block; the compliance footer is
          // appended server-side at send time now, so drop it from the design.
          const blockList = parsed.filter((b) => b?.type !== 'footer');
          this.blocks.set(blockList);
          if (blockList.length > 0) {
            this.selectedBlockId.set(blockList[0].id);
            this.activeTab.set('edit');
          }
          return;
        }
      } catch (err) {
        console.error('Failed to parse embedded visual block metadata. Defaulting to template.', err);
      }
    }

    // No embedded block model. The visual editor is the default, so try a best-effort import
    // of simple legacy HTML into blocks; fall back to raw-HTML mode only when the content
    // would not survive the round-trip. Empty content starts from the welcome template.
    const legacyHtml = this.htmlContent().trim();
    if (!legacyHtml) {
      this.loadTemplate('welcome', false);
      return;
    }
    const imported = tryImportHtmlToBlocks(legacyHtml);
    if (imported) {
      this.blocks.set(imported);
      this.selectedBlockId.set(imported[0]?.id ?? null);
      this.activeTab.set('edit');
    } else {
      // Hand-written HTML that does not survive the round-trip: show it as it is, in code view.
      this.rawHtmlDraft.set(this.htmlContent());
      this.rawHtmlEdited.set(true);
      this.editorMode.set('code');
    }
  }

  protected selectBlock(id: string, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    this.insertMenuIndex.set(null);
    this.selectedBlockId.set(id);
    this.activeTab.set('edit');
  }

  /** Toggles the "+" insert picker at the given seam index. */
  protected toggleInsertMenu(index: number, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    this.insertMenuIndex.set(this.insertMenuIndex() === index ? null : index);
  }

  protected toggleEditorMode(): void {
    if (this.editorMode() === 'visual') {
      // The code view starts from the HTML that is actually stored, not from a recompile.
      this.rawHtmlDraft.set(this.htmlContent());
      this.editorMode.set('code');
      return;
    }
    // Going back to visual recompiles the HTML from the blocks, which throws away anything typed
    // in the code view. Ask first, and name what is about to be replaced.
    if (this.rawHtmlEdited()) {
      void this.confirmReturnToVisual();
      return;
    }
    this.editorMode.set('visual');
    this.updateBlocks();
  }

  /** Confirms replacing hand-written HTML with the visual design before switching modes. */
  private async confirmReturnToVisual(): Promise<void> {
    const confirmed = await this.confirmDlg.confirm({
      title: 'Replace your HTML with the visual design?',
      message:
        'The HTML you edited by hand will be replaced by the blocks in the visual editor, and your hand-written changes will be lost. Stay in code view to keep them.',
      variant: 'warning',
      confirmText: 'Replace with the visual design',
      cancelText: 'Keep my HTML',
    });
    if (!confirmed) return;
    this.rawHtmlEdited.set(false);
    this.editorMode.set('visual');
    this.updateBlocks();
  }

  /** Click-to-add path: inserts after the selected block, or appends when nothing is selected. */
  protected addBlock(type: EmailBlockType): void {
    const selectedId = this.selectedBlockId();
    const selectedIdx = selectedId === null ? -1 : this.blocks().findIndex((b) => b.id === selectedId);
    const index = selectedIdx === -1 ? this.blocks().length : selectedIdx + 1;
    this.addBlockAt(type, index);
  }

  /** Inserts a fresh block of the given type at the given index, selects it, and closes any insert menu. */
  protected addBlockAt(type: EmailBlockType, index: number): void {
    const newBlock = createBlock(type);
    this.blocks.set(insertBlockAt(this.blocks(), newBlock, index));
    this.selectBlock(newBlock.id);
    this.updateBlocks();
  }

  /** Handles drops on the canvas: reorder within it, or copy-insert a type dragged from the palette. */
  protected onCanvasDrop(event: CdkDragDrop<EmailBlock[]>): void {
    if (event.previousContainer === event.container) {
      if (event.previousIndex === event.currentIndex) return;
      this.blocks.set(moveBlock(this.blocks(), event.previousIndex, event.currentIndex));
      this.updateBlocks();
      return;
    }
    // Palette tile dropped onto the canvas: copy semantics — the tile itself stays in the palette.
    const data: unknown = event.item.data;
    if (isEmailBlockType(data)) {
      this.addBlockAt(data, event.currentIndex);
    }
  }

  protected deleteBlock(id: string, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    const filtered = this.blocks().filter((b) => b.id !== id);
    this.blocks.set(filtered);
    if (this.selectedBlockId() === id) {
      this.selectedBlockId.set(filtered[0]?.id ?? null);
    }
    this.updateBlocks();
  }

  protected duplicateBlock(block: EmailBlock, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    const idx = this.blocks().findIndex((b) => b.id === block.id);
    if (idx === -1) return;

    const id = Math.random().toString(36).substring(2, 9);
    const clone: EmailBlock = JSON.parse(JSON.stringify(block));
    clone.id = id;

    this.blocks.set(insertBlockAt(this.blocks(), clone, idx + 1));
    this.selectBlock(id);
    this.updateBlocks();
  }

  protected moveBlockUp(idx: number, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    if (idx <= 0) return;
    this.blocks.set(moveBlock(this.blocks(), idx, idx - 1));
    this.updateBlocks();
  }

  protected moveBlockDown(idx: number, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    if (idx >= this.blocks().length - 1) return;
    this.blocks.set(moveBlock(this.blocks(), idx, idx + 1));
    this.updateBlocks();
  }

  protected updateBlocks(): void {
    const list = [...this.blocks()];
    // Trigger signal recomputation and propagation
    this.blocks.set(list);
    this.propagateChanges();
  }

  // --- Ad-hoc style/content knobs (value + input/change handlers, no forms) ---

  /** Writes a plain-text field of the block (content, urls, footer copy) from a native input/textarea event. */
  protected setBlockText(block: EmailBlock, field: EditableBlockTextField, event: Event): void {
    block[field] = eventValue(event);
    this.updateBlocks();
  }

  /** Writes a string-valued style property (colors, sizes, paddings) from a native control event. */
  protected setBlockStyle(block: EmailBlock, key: StringStyleKey, event: Event): void {
    this.ensureStyles(block)[key] = eventValue(event);
    this.updateBlocks();
  }

  protected setBlockAlign(block: EmailBlock, event: Event): void {
    const value = eventValue(event);
    if (value === 'left' || value === 'center' || value === 'right') {
      this.ensureStyles(block).textAlign = value;
      this.updateBlocks();
    }
  }

  protected setSocialIconStyle(block: EmailBlock, event: Event): void {
    const value = eventValue(event);
    if (
      value === 'circular-solid' ||
      value === 'circular-gray' ||
      value === 'simple-color' ||
      value === 'simple-gray'
    ) {
      block.socialIconStyle = value;
      this.updateBlocks();
    }
  }

  protected setSocialUrl(social: { url: string }, event: Event): void {
    social.url = eventValue(event);
    this.updateBlocks();
  }

  protected onRawHtmlInput(event: Event): void {
    this.handleRawHtmlEdit(eventValue(event));
  }

  private ensureStyles(block: EmailBlock): NonNullable<EmailBlock['styles']> {
    block.styles ??= {};
    return block.styles;
  }

  protected handleRawHtmlEdit(html: string): void {
    this.rawHtmlDraft.set(html);
    this.rawHtmlEdited.set(true);
    // The compiled document carries the block model in a JSON comment, and ngOnInit rebuilds the
    // design from that comment when the draft is reopened — which would silently discard whatever
    // was typed here. Once the HTML has been edited by hand it is no longer the output of those
    // blocks, so the comment goes with the edit and the draft stays raw HTML from now on.
    this.htmlContent.set(html.replace(BLOCK_DATA_COMMENT_RE, '').trimStart());
    // Simple text version conversion from html tags
    const text = html
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    this.plainTextContent.set(text);
  }

  protected loadTemplate(preset: 'welcome' | 'product' | 'newsletter' | 'empty', triggerPropagate = true): void {
    const tpl = getTemplateBlocks(preset);
    this.blocks.set(tpl);
    this.selectedBlockId.set(tpl[0]?.id || null);
    this.activeTab.set('edit');

    if (triggerPropagate) {
      this.propagateChanges();
    }
  }

  private propagateChanges(): void {
    const html = this.compiledHtml();
    const text = compileBlocksToPlainText(this.blocks());

    this.htmlContent.set(html);
    this.plainTextContent.set(text);
  }
}

/** Block fields that are edited as free text in the Customize panel. */
type EditableBlockTextField = 'content' | 'linkUrl' | 'imageUrl' | 'imageAlt' | 'imageWidth';

/** Style keys typed as plain strings on EmailBlock['styles'] (textAlign is handled separately). */
type StringStyleKey =
  | 'color'
  | 'backgroundColor'
  | 'fontSize'
  | 'paddingTop'
  | 'paddingBottom'
  | 'borderRadius'
  | 'borderColor'
  | 'borderWidth'
  | 'height';

/** Safely reads the string value from a native input/textarea/select event target. */
function eventValue(event: Event): string {
  const target = event.target;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return target.value;
  }
  return '';
}
